import type { GenerationTask } from '@seqora/contracts'
import { writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { usageCollector } from '../observability/usage.js'
import {
  createFfmpegCompositionArgs,
  createFfmpegConcatArgs,
  createFfmpegConcatManifest,
  FilmPreviewComposer,
} from './filmPreviewComposer.js'

describe('FilmPreviewComposer', () => {
  beforeEach(() => {
    usageCollector.resetForTests()
  })

  it('downloads shot videos and stores one normalized preview MP4', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const sources = [sourceTask('source-1', 'provider-1'), sourceTask('source-2', 'provider-2')]
    sources[1].metadata.generatedOutputs = [
      {
        view: 'single',
        storageKey: 'cached/source-2.mp4',
        contentType: 'video/mp4',
        size: 21,
      },
    ]
    const preview = previewTask(sources.map((task) => task.id))
    await store.mutate((state) => {
      state.tasks.unshift(preview, ...sources)
    })

    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => {
        throw new Error('not used')
      }),
      getStatus: vi.fn(async () => {
        throw new Error('not used')
      }),
      getContent: vi.fn(async (providerTaskId) => ({
        stream: Readable.from(Buffer.from(`video-${providerTaskId}`)),
        contentType: 'video/mp4',
        contentLength: null,
        statusCode: 200,
        acceptRanges: null,
        contentRange: null,
      })),
    }
    const stored = new Map<string, Buffer>([['cached/source-2.mp4', Buffer.from('cached-video-source-2')]])
    const storage: ObjectStorage = {
      put: vi.fn(async (key, content) => {
        stored.set(key, content)
      }),
      get: vi.fn(async (key) => stored.get(key) || Buffer.alloc(0)),
      delete: vi.fn(async (key) => {
        stored.delete(key)
      }),
    }
    let target: { width: number; height: number } | null = null
    const onStateChange = vi.fn(async () => {})
    const composer = new FilmPreviewComposer(store, provider, storage, 'ffmpeg', 60_000, 'aideos-seedance', {
      onStateChange,
      composeRunner: async (inputPaths, outputPath, nextTarget) => {
        expect(inputPaths).toHaveLength(2)
        expect(usageCollector.snapshot({ userId: preview.userId })).toMatchObject({
          jobConcurrency: 1,
          jobCount: 0,
        })
        target = nextTarget
        await writeFile(outputPath, Buffer.from('merged-video'))
      },
    })

    const started = await composer.start(preview)
    expect(started.status).toBe('running')
    expect(started).toMatchObject({
      attempts: 1,
      maxAttempts: 3,
      leaseOwnerId: expect.any(String),
      leaseToken: expect.any(String),
      leaseAcquiredAt: expect.any(String),
      leaseHeartbeatAt: expect.any(String),
      leaseExpiresAt: expect.any(String),
    })
    await vi.waitFor(() => {
      expect(store.read((state) => state.tasks.find((task) => task.id === preview.id)?.status)).toBe(
        'completed',
      )
    })

    const completed = store.read((state) => state.tasks.find((task) => task.id === preview.id)!)
    expect(target).toEqual({ width: 1080, height: 1920 })
    expect(provider.getContent).toHaveBeenCalledTimes(1)
    expect(completed).toMatchObject({
      progress: 100,
      resultUrl: `/api/v1/generation/tasks/${preview.id}/content`,
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      metadata: {
        providerState: 'completed',
        previewContentType: 'video/mp4',
        previewSize: 12,
      },
    })
    expect(stored.get(String(completed.metadata.previewStorageKey))?.toString()).toBe('merged-video')
    expect(onStateChange).toHaveBeenCalled()
    expect(onStateChange).toHaveBeenCalledWith(preview.id)
    expect(usageCollector.snapshot({ userId: preview.userId })).toMatchObject({
      jobConcurrency: 0,
      jobCount: 1,
      jobFailedCount: 0,
      jobFailureRate: 0,
      creditsUsed: 0,
    })
  })

  it('marks an interrupted local composition as failed during startup recovery', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task = {
      ...previewTask(['source-1']),
      status: 'running' as const,
      leaseOwnerId: 'old-composer',
      leaseToken: 'old-token',
      leaseAcquiredAt: now,
      leaseHeartbeatAt: now,
      leaseExpiresAt: now,
    }
    await store.mutate((state) => {
      state.tasks.unshift(task)
    })
    const composer = new FilmPreviewComposer(
      store,
      {} as VideoGenerationProvider,
      {} as ObjectStorage,
      'ffmpeg',
      60_000,
    )

    await composer.recoverInterrupted()

    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'failed',
      error: '完整预览合成被服务重启中断，请重新合成',
      leaseOwnerId: null,
      leaseToken: null,
      leaseAcquiredAt: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
    })
    expect(usageCollector.snapshot({ userId: task.userId })).toMatchObject({
      jobConcurrency: 0,
      jobCount: 1,
      jobFailedCount: 1,
      jobFailureRate: 1,
      creditsUsed: 0,
    })
  })

  it('does not recover a composition whose lease is still active', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = {
      ...previewTask(['source-1']),
      status: 'running' as const,
      leaseOwnerId: 'active-composer',
      leaseToken: 'active-token',
      leaseAcquiredAt: new Date().toISOString(),
      leaseHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    await store.mutate((state) => {
      state.tasks.unshift(task)
    })

    const composer = new FilmPreviewComposer(
      store,
      {} as VideoGenerationProvider,
      {} as ObjectStorage,
      'ffmpeg',
      60_000,
    )

    await composer.recoverInterrupted()

    expect(store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'running',
      progress: 0,
      leaseOwnerId: 'active-composer',
      leaseToken: 'active-token',
    })
  })

  it('fails a composition when a shot stream stops producing data', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const source = sourceTask('source-stalled', 'provider-stalled')
    const preview = previewTask([source.id])
    await store.mutate((state) => {
      state.tasks.unshift(preview, source)
    })

    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => {
        throw new Error('not used')
      }),
      getStatus: vi.fn(async () => {
        throw new Error('not used')
      }),
      getContent: vi.fn(async () => ({
        stream: new Readable({ read() {} }),
        contentType: 'video/mp4',
        contentLength: null,
        statusCode: 200,
        acceptRanges: null,
        contentRange: null,
      })),
    }
    const composer = new FilmPreviewComposer(
      store,
      provider,
      {
        put: vi.fn(async () => {}),
        get: vi.fn(async () => Buffer.alloc(0)),
        delete: vi.fn(async () => {}),
      },
      'ffmpeg',
      60_000,
      'aideos-seedance',
      { ioTimeoutMs: 20, stateChangeTimeoutMs: 20, leaseTtlMs: 1_000 },
    )

    await composer.start(preview)
    await vi.waitFor(
      () => {
        const task = store.read((state) => state.tasks.find((item) => item.id === preview.id))
        expect(task?.status).toBe('failed')
        expect(task?.error).toContain('写入第 1 个镜头视频超时')
      },
      { timeout: 1_000 },
    )
  })

  it('keeps audio streams and supplies silence for clips without audio', () => {
    const args = createFfmpegCompositionArgs(
      ['shot-1.mp4', 'shot-2.mp4'],
      'preview.mp4',
      { width: 1920, height: 1080 },
      [
        { duration: 3, hasAudio: true },
        { duration: 4, hasAudio: false },
      ],
    )
    const filter = args[args.indexOf('-filter_complex') + 1]

    expect(args).not.toContain('-an')
    expect(args).toContain('anullsrc=r=48000:cl=stereo')
    expect(args).toContain('[outa]')
    expect(filter).toContain('concat=n=2:v=1:a=1[outv][outa]')
    expect(filter).toContain('[2:a]')
  })

  it('adds exact advertisement text as a post-composition overlay', () => {
    const args = createFfmpegCompositionArgs(
      ['shot-1.mp4'],
      'preview.mp4',
      { width: 1920, height: 1080 },
      [{ duration: 4, hasAudio: true }],
      ['/tmp/overlay-001.txt'],
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    )
    const filter = args[args.indexOf('-filter_complex') + 1]

    expect(filter).toContain('drawtext=fontfile=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
    expect(filter).toContain('textfile=/tmp/overlay-001.txt')
    expect(filter).toContain('boxcolor=black@0.58')
  })

  it('limits decoder and filter threads for each composition batch', () => {
    const args = createFfmpegCompositionArgs(
      Array.from({ length: 6 }, (_, index) => `shot-${index + 1}.mp4`),
      'batch.mp4',
      { width: 1920, height: 1080 },
      Array.from({ length: 6 }, () => ({ duration: 5, hasAudio: true })),
    )

    expect(args.filter((value) => value === '-threads')).toHaveLength(7)
    expect(args).toContain('-filter_complex_threads')
    expect(args[args.indexOf('-filter_complex_threads') + 1]).toBe('2')
  })

  it('creates a stream-copy manifest for a 29-shot composition split into batches', () => {
    const batchPaths = Array.from(
      { length: Math.ceil(29 / 6) },
      (_, index) => `C:\\temp\\composition-batch-${String(index + 1).padStart(3, '0')}.mp4`,
    )
    const manifest = createFfmpegConcatManifest(batchPaths)
    const args = createFfmpegConcatArgs('C:\\temp\\composition-batches.txt', 'film-preview.mp4')

    expect(manifest.trim().split('\n')).toHaveLength(5)
    expect(manifest).toContain("file 'C:/temp/composition-batch-005.mp4'")
    expect(args).toEqual([
      '-hide_banner',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'C:\\temp\\composition-batches.txt',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      'film-preview.mp4',
    ])
  })
})

function sourceTask(id: string, providerTaskId: string): GenerationTask {
  return task(id, 'seedance', 'completed', { shotId: `shot-${id}`, providerTaskId })
}

function previewTask(sourceVideoTaskIds: string[]): GenerationTask {
  return task('film-preview-task', 'local-compose', 'queued', {
    generationStage: 'film-preview',
    sourceVideoTaskIds,
    aspectRatio: '9:16',
  })
}

function task(
  id: string,
  provider: string,
  status: GenerationTask['status'],
  metadata: GenerationTask['metadata'],
): GenerationTask {
  const now = new Date().toISOString()
  return {
    id,
    clientRequestId: `client-${id}`,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'video',
    label: id,
    prompt: '',
    negativePrompt: '',
    provider,
    model: null,
    metadata,
    status,
    progress: status === 'completed' ? 100 : 0,
    estimatedCredits: provider === 'local-compose' ? 0 : 18,
    createdAt: now,
    updatedAt: now,
    resultUrl: status === 'completed' ? `/api/v1/generation/tasks/${id}/content` : null,
    outputs: [],
    error: null,
  }
}
