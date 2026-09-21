import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { resolveVideoImages } from './taskVideoReferences.js'

function task(metadata: Record<string, unknown>): GenerationTask {
  return {
    id: 'video-task',
    clientRequestId: 'video-task-client',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    kind: 'video',
    label: '镜头 01',
    prompt: '生成视频',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    metadata,
    status: 'queued',
    progress: 0,
    estimatedCredits: 18,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultUrl: null,
    outputs: [],
    error: null,
  }
}

describe('video reference resolution', () => {
  it('skips a missing automatic asset reference when no manual image was selected', async () => {
    const store = new AppStore(null)
    await store.initialize()

    await expect(
      resolveVideoImages(
        task({ images: ['/api/v1/media/missing-asset'], manualReferenceImages: [] }),
        store,
        { objectStorage: null, mediaRepository: null, videoSourceUrl: null },
      ),
    ).resolves.toEqual([])
  })

  it('keeps a clear error when a selected manual image cannot be read', async () => {
    const store = new AppStore(null)
    await store.initialize()

    await expect(
      resolveVideoImages(
        task({
          images: ['/api/v1/media/missing-upload'],
          manualReferenceImages: [{ url: 'missing-upload' }],
        }),
        store,
        { objectStorage: null, mediaRepository: null, videoSourceUrl: null },
      ),
    ).rejects.toThrow('视频参考原图不存在或无权读取，请重新上传并确认人物面部')
  })

  it('never silently drops a selected character or scene when its source is unavailable', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await expect(
      resolveVideoImages(
        task({
          images: ['/api/v1/generation/tasks/confirmed-face/outputs/single'],
          referenceAssetIds: ['selected-character'],
          manualReferenceImages: [],
        }),
        store,
        { objectStorage: null, mediaRepository: null, videoSourceUrl: null },
      ),
    ).rejects.toThrow('视频参考原图不存在或无权读取')
  })

  it('allows a text-only video task to continue without reference images', async () => {
    const store = new AppStore(null)
    await store.initialize()

    await expect(
      resolveVideoImages(task({ images: [] }), store, {
        objectStorage: null,
        mediaRepository: null,
        videoSourceUrl: null,
      }),
    ).resolves.toEqual([])
  })
})
