import type { GenerationTask } from '@seqora/contracts'
import { writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { FilmPreviewComposer } from './filmPreviewComposer.js'

describe('FilmPreviewComposer', () => {
  it('downloads shot videos and stores one normalized preview MP4', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const sources = [sourceTask('source-1', 'provider-1'), sourceTask('source-2', 'provider-2')]
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
    const stored = new Map<string, Buffer>()
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
    const composer = new FilmPreviewComposer(
      store,
      provider,
      storage,
      'ffmpeg',
      60_000,
      'stringx-seedance',
      async (inputPaths, outputPath, nextTarget) => {
        expect(inputPaths).toHaveLength(2)
        target = nextTarget
        await writeFile(outputPath, Buffer.from('merged-video'))
      },
    )

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
    expect(provider.getContent).toHaveBeenCalledTimes(2)
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
