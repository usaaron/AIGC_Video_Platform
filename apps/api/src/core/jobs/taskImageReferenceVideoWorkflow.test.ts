import type { GenerationTask } from '@seqora/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore, type StoredMedia } from '../../infra/store.js'
import type { MediaRepository } from '../../modules/media/repository.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { usageCollector } from '../observability/usage.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

const mediaUrl = '/api/v1/media/reference-upload'
const generatedUrl = '/api/v1/generation/tasks/reference-image/outputs/single'
const content = Buffer.from('synthetic-reference-image')
const source = { storageKey: 'reference.png', contentType: 'image/png' }

describe('video generation stored image references', () => {
  beforeEach(() => usageCollector.resetForTests())

  it.each([mediaUrl, `https://studio.example.test${mediaUrl}`, `${mediaUrl}?version=2`])(
    'inlines an uploaded image from %s instead of forwarding its authenticated URL',
    async (url) => {
      const fixture = await videoFixture([url])
      await fixture.store.mutate((state) => state.media.push(uploadedImage()))

      await fixture.run()

      expectInlineReference(fixture.submit)
    },
  )

  it.each([mediaUrl, `https://studio.example.test${mediaUrl}?version=2`])(
    'loads %s through the media repository when the worker cache is empty',
    async (url) => {
      const fixture = await videoFixture([url])
      const findSourceById = vi.fn(async () => source)

      await fixture.run({ findSourceById })

      expect(findSourceById).toHaveBeenCalledWith(
        'reference-upload',
        fixture.task.projectId,
        fixture.task.tenantId,
        'image',
      )
      expectInlineReference(fixture.submit)
    },
  )

  it.each([generatedUrl, `https://studio.example.test${generatedUrl}?version=2`])(
    'inlines a completed generated image from %s',
    async (url) => {
      const fixture = await videoFixture([url])
      await fixture.store.mutate((state) => state.tasks.push(generatedImage()))

      await fixture.run()

      expectInlineReference(fixture.submit)
    },
  )

  it.each([
    { url: mediaUrl, scope: { projectId: 'other-project' } },
    { url: mediaUrl, scope: { tenantId: 'other-tenant' } },
    { url: generatedUrl, scope: { projectId: 'other-project' } },
    { url: generatedUrl, scope: { tenantId: 'other-tenant' } },
  ])('rejects an out-of-scope image: %j', async ({ url, scope }) => {
    const fixture = await videoFixture([`https://studio.example.test${url}`])
    await fixture.store.mutate((state) => {
      state.media.push(uploadedImage(scope))
      state.tasks.push(generatedImage(scope))
    })
    const findSourceById = vi.fn(async () => null)

    await fixture.run({ findSourceById })

    expect(fixture.result()).toMatchObject({ status: 'failed', error: expect.stringContaining('读取失败') })
    expect(fixture.submit).not.toHaveBeenCalled()
    expect(fixture.storage.get).not.toHaveBeenCalled()
    if (url === mediaUrl) {
      expect(findSourceById).toHaveBeenCalledWith(
        'reference-upload',
        fixture.task.projectId,
        fixture.task.tenantId,
        'image',
      )
    }
  })

  it.each([mediaUrl, generatedUrl])('fails before submission for missing reference %s', async (url) => {
    const fixture = await videoFixture([`https://studio.example.test${url}?v=1`])

    await fixture.run({ findSourceById: vi.fn(async () => null) })

    expect(fixture.result()).toMatchObject({ status: 'failed', error: expect.stringContaining('读取失败') })
    expect(fixture.submit).not.toHaveBeenCalled()
  })

  it('rejects failed generated image tasks even when image output metadata remains', async () => {
    const fixture = await videoFixture([`https://studio.example.test${generatedUrl}`])
    await fixture.store.mutate((state) => state.tasks.push(generatedImage({ status: 'failed' })))

    await fixture.run()

    expect(fixture.result()?.status).toBe('failed')
    expect(fixture.submit).not.toHaveBeenCalled()
  })

  it('fails before submission when the reference file is empty', async () => {
    const fixture = await videoFixture([mediaUrl])
    fixture.storage.get.mockResolvedValue(Buffer.alloc(0))

    await fixture.run({ findSourceById: vi.fn(async () => source) })

    expect(fixture.result()).toMatchObject({ status: 'failed', error: expect.stringContaining('内容为空') })
    expect(fixture.submit).not.toHaveBeenCalled()
  })

  it('fails before submission when stored images cannot be read without object storage', async () => {
    const fixture = await videoFixture([`https://studio.example.test${mediaUrl}`])

    await fixture.run(null, null)

    expect(fixture.result()).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('存储服务不可用'),
    })
    expect(fixture.submit).not.toHaveBeenCalled()
  })

  it('preserves public HTTP images and authorized provider asset references', async () => {
    const urls = ['https://cdn.example.test/reference.png', 'asset://authorized-portrait']
    const fixture = await videoFixture(urls)

    await fixture.run()

    expect(fixture.submit).toHaveBeenCalledWith(
      expect.objectContaining({ images: urls.map((url) => ({ url, role: 'reference_image' })) }),
    )
    expect(fixture.storage.get).not.toHaveBeenCalled()
  })
})

async function videoFixture(images: string[]) {
  const store = new AppStore(null)
  await store.initialize()
  const task = videoTask(images)
  await store.mutate((state) => {
    state.tasks = [task]
    state.media = []
  })
  const submit = vi.fn<VideoGenerationProvider['submit']>(async () => ({
    providerTaskId: 'synthetic-video-task',
    status: 'queued',
    progress: 0,
  }))
  const videoProvider: VideoGenerationProvider = {
    submit,
    getStatus: async () => ({ status: 'running', progress: 1, error: null }),
    getContent: async () => {
      throw new Error('Unexpected video download')
    },
  }
  const storage = {
    put: async () => {},
    get: vi.fn(async () => content),
    delete: async () => {},
  }
  const result = () => store.read((state) => state.tasks.find((item) => item.id === task.id))
  const run = async (
    mediaRepository: Pick<MediaRepository, 'findSourceById'> | null = null,
    objectStorage: ObjectStorage | null = storage,
  ) => {
    await new GenerationTaskRunner(store, { videoProvider, objectStorage, mediaRepository }).tick()
    await vi.waitFor(() => {
      const current = result()
      expect(
        current?.status === 'failed' || current?.metadata.providerTaskId === 'synthetic-video-task',
      ).toBe(true)
    })
  }
  return { store, task, submit, storage, run, result }
}

function videoTask(images: string[]): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: 'reference-video',
    clientRequestId: 'reference-video-client',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-member',
    kind: 'video',
    label: 'Synthetic video reference test',
    prompt: 'Synthetic scene',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    metadata: { images },
    status: 'queued',
    progress: 0,
    estimatedCredits: 0,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}

function uploadedImage(overrides: Partial<StoredMedia> = {}): StoredMedia {
  return {
    id: 'reference-upload',
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    kind: 'image',
    name: 'synthetic-reference.png',
    contentType: source.contentType,
    storageKey: source.storageKey,
    size: content.length,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function generatedImage(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    ...videoTask([]),
    id: 'reference-image',
    kind: 'image',
    provider: 'img2',
    status: 'completed',
    metadata: { generatedOutputs: [{ ...source, view: 'single', size: content.length }] },
    ...overrides,
  }
}

function expectInlineReference(submit: ReturnType<typeof vi.fn<VideoGenerationProvider['submit']>>) {
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      images: [{ url: `data:image/png;base64,${content.toString('base64')}`, role: 'reference_image' }],
    }),
  )
}
