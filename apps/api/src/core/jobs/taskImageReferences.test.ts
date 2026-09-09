import type { GenerationTask } from '@seqora/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppStore, type StoredMedia } from '../../infra/store.js'
import { findStoredReference } from './taskImageReferences.js'

const generatedUrl = '/api/v1/generation/tasks/source-image/outputs/front'
const mediaUrl = '/api/v1/media/source-media'
const generatedImage = {
  view: 'front',
  storageKey: 'test-organization/test-project/generated/source-image-front.png',
  contentType: 'image/png',
  size: 123,
}

function imageTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 'source-image',
    clientRequestId: 'source-image-client',
    projectId: 'test-project',
    tenantId: 'test-organization',
    userId: 'test-user',
    kind: 'image',
    label: 'Synthetic reference image',
    prompt: '',
    negativePrompt: '',
    provider: 'local',
    model: null,
    metadata: { generatedOutputs: [generatedImage] },
    status: 'completed',
    progress: 100,
    estimatedCredits: 0,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    resultUrl: generatedUrl,
    outputs: [{ id: 'source-output', url: generatedUrl, mediaType: 'image', view: 'front' }],
    error: null,
    ...overrides,
  }
}

function uploadedImage(overrides: Partial<StoredMedia> = {}): StoredMedia {
  return {
    id: 'source-media',
    projectId: 'test-project',
    tenantId: 'test-organization',
    kind: 'image',
    name: 'Synthetic reference image',
    contentType: 'image/webp',
    size: 123,
    storageKey: 'test-organization/test-project/media/source-media.webp',
    createdAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('findStoredReference isolation', () => {
  let store: AppStore
  const targetTask = imageTask({ id: 'target-image', status: 'queued', metadata: {}, outputs: [] })

  beforeEach(async () => {
    store = new AppStore(null, undefined, false, false)
    await store.initialize()
    await store.mutate((state) => {
      state.tasks = [imageTask()]
      state.media = [uploadedImage()]
    })
  })

  it.each([
    generatedUrl,
    `https://studio.example${generatedUrl}`,
    `https://studio.example${generatedUrl}?download=1&version=2`,
  ])('resolves a completed image in the target organization and project: %s', (url) => {
    expect(findStoredReference(store, targetTask, url)).toEqual({
      storageKey: generatedImage.storageKey,
      contentType: generatedImage.contentType,
    })
  })

  it.each([mediaUrl, `https://studio.example${mediaUrl}`, `${mediaUrl}?download=1&version=2`])(
    'resolves uploaded images in the target organization and project: %s',
    (url) => {
      const media = uploadedImage()
      expect(findStoredReference(store, targetTask, url)).toEqual({
        storageKey: media.storageKey,
        contentType: media.contentType,
      })
    },
  )

  it.each([{ tenantId: 'other-organization' }, { projectId: 'other-project' }])(
    'rejects generated images outside the target scope: %j',
    async (scope) => {
      await store.mutate((state) => {
        state.tasks = [imageTask(scope)]
      })

      expect(findStoredReference(store, targetTask, generatedUrl)).toBeNull()
    },
  )

  it.each([{ tenantId: 'other-organization' }, { projectId: 'other-project' }])(
    'rejects uploaded images outside the target scope: %j',
    async (scope) => {
      await store.mutate((state) => {
        state.media = [uploadedImage(scope)]
      })

      expect(findStoredReference(store, targetTask, mediaUrl)).toBeNull()
    },
  )

  it.each(['queued', 'paused', 'running', 'failed', 'cancelled'] as const)(
    'rejects %s source tasks even when stored image output metadata exists',
    async (status) => {
      await store.mutate((state) => {
        state.tasks = [imageTask({ status })]
      })

      expect(findStoredReference(store, targetTask, generatedUrl)).toBeNull()
    },
  )

  it.each(['video/mp4', 'audio/mpeg', 'application/octet-stream'])(
    'rejects generated output with non-image content type %s',
    async (contentType) => {
      await store.mutate((state) => {
        state.tasks = [imageTask({ metadata: { generatedOutputs: [{ ...generatedImage, contentType }] } })]
      })

      expect(findStoredReference(store, targetTask, generatedUrl)).toBeNull()
    },
  )

  it('rejects uploaded audio media', async () => {
    await store.mutate((state) => {
      state.media = [uploadedImage({ kind: 'audio', contentType: 'audio/mpeg' })]
    })

    expect(findStoredReference(store, targetTask, mediaUrl)).toBeNull()
  })

  it.each([
    'asset://source-media',
    'asset://source-image/front',
    'asset://studio.example/api/v1/media/source-media',
    'asset://studio.example/api/v1/generation/tasks/source-image/outputs/front',
  ])('does not resolve an unrecognized asset reference to stored data: %s', (url) => {
    expect(findStoredReference(store, targetTask, url)).toBeNull()
  })

  it.each([
    '/api/v1/media/missing-media',
    '/api/v1/generation/tasks/missing-task/outputs/front',
    '/api/v1/generation/tasks/source-image/outputs/back',
  ])('does not substitute another stored image for a missing reference: %s', (url) => {
    expect(findStoredReference(store, targetTask, url)).toBeNull()
  })
})
