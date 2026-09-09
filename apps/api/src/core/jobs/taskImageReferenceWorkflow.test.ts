import type { GenerationTask } from '@seqora/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import type { ImageGenerationProvider } from '../generation/imageProvider.js'
import { usageCollector } from '../observability/usage.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

describe('image generation references', () => {
  beforeEach(() => usageCollector.resetForTests())

  it.each(['/api/v1/media/uploaded-face', 'https://app.example.test/api/v1/media/uploaded-face?v=1'])(
    'loads the uploaded reference %s from the media repository before calling Img2',
    async (referenceUrl) => {
      const store = new AppStore(null)
      await store.initialize()
      const task = imageTask('body-from-upload', {
        references: [{ url: referenceUrl, name: 'face.png' }],
      })
      await store.mutate((state) => state.tasks.unshift(task))
      const imageProvider = successfulImageProvider()
      const objectStorage = memoryObjectStorage()
      await objectStorage.put('media/uploaded-face.png', Buffer.from('uploaded-face-content'), 'image/png')
      const mediaRepository = {
        findSourceById: vi.fn(async () => ({
          storageKey: 'media/uploaded-face.png',
          contentType: 'image/png',
        })),
      }

      await new GenerationTaskRunner(store, { imageProvider, mediaRepository, objectStorage }).tick()

      await waitForTaskStatus(store, task.id, 'completed')
      expect(mediaRepository.findSourceById).toHaveBeenCalledWith(
        'uploaded-face',
        task.projectId,
        task.tenantId,
        'image',
      )
      expect(imageProvider.generate).toHaveBeenCalledOnce()
      expect(imageProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'img2-default',
          references: [
            expect.objectContaining({
              name: 'face.png',
              contentType: 'image/png',
              content: Buffer.from('uploaded-face-content'),
            }),
          ],
        }),
      )
    },
  )

  it('loads a completed face output as the body image reference', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const face = imageTask('generated-face-reference', {
      generationStage: 'face',
      generatedOutputs: [{ view: 'single', storageKey: 'face.png', contentType: 'image/png', size: 14 }],
    })
    face.status = 'completed'
    const body = imageTask('body-from-face', {
      references: [
        {
          url: `https://app.example.test/api/v1/generation/tasks/${face.id}/outputs/single?v=1`,
          name: 'confirmed-face.png',
        },
      ],
    })
    await store.mutate((state) => state.tasks.push(face, body))
    const imageProvider = successfulImageProvider()
    const storage = memoryObjectStorage()
    await storage.put('face.png', Buffer.from('confirmed-face'), 'image/png')

    await new GenerationTaskRunner(store, { imageProvider, objectStorage: storage }).tick()

    await waitForTaskStatus(store, body.id, 'completed')
    expect(imageProvider.generate).toHaveBeenCalledOnce()
    expect(imageProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({
            name: 'confirmed-face.png',
            contentType: 'image/png',
            content: Buffer.from('confirmed-face'),
          }),
        ],
      }),
    )
  })

  it('fails without calling the image provider when the requested face reference is missing', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const task = imageTask('body-from-missing-face', {
      references: [{ url: '/api/v1/media/missing-face', name: 'face.png' }],
    })
    await store.mutate((state) => state.tasks.unshift(task))
    const imageProvider: ImageGenerationProvider = { generate: vi.fn() }

    await new GenerationTaskRunner(store, {
      imageProvider,
      mediaRepository: { findSourceById: vi.fn(async () => null) },
      objectStorage: memoryObjectStorage(),
    }).tick()

    await waitForTaskStatus(store, task.id, 'failed')
    expect(store.read((state) => state.tasks.find((item) => item.id === task.id)?.error)).toContain(
      '参考图读取失败',
    )
    expect(imageProvider.generate).not.toHaveBeenCalled()
  })
})

function imageTask(id: string, metadata: GenerationTask['metadata']): GenerationTask {
  const now = new Date().toISOString()
  return {
    id,
    clientRequestId: `${id}-client`,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'image',
    label: id,
    prompt: '人物全身完整入镜',
    negativePrompt: '',
    provider: 'img2',
    model: 'img2-default',
    metadata: {
      assetId: 'character-1',
      assetKind: 'character',
      generationStage: 'body',
      aspectRatio: '9:16',
      ...metadata,
    },
    status: 'queued',
    progress: 0,
    estimatedCredits: 6,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}

function successfulImageProvider(): ImageGenerationProvider {
  return {
    generate: vi.fn(async () => [
      { view: 'single', contentType: 'image/png', content: Buffer.from('generated-body') },
    ]),
  }
}

function memoryObjectStorage(): ObjectStorage {
  const files = new Map<string, Buffer>()
  return {
    put: async (key, content) => {
      files.set(key, content)
    },
    get: async (key) => files.get(key) ?? Buffer.alloc(0),
    delete: async (key) => {
      files.delete(key)
    },
  }
}

async function waitForTaskStatus(
  store: AppStore,
  taskId: string,
  status: GenerationTask['status'],
): Promise<void> {
  await vi.waitFor(() =>
    expect(store.read((state) => state.tasks.find((task) => task.id === taskId)?.status)).toBe(status),
  )
}
