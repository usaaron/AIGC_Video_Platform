import type { Asset, CreateGenerationTask, GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { GenerationService } from '../../modules/generation/service.js'
import type { GenerationTaskRepository } from '../../modules/generation/repository.js'
import { DoraRouterSeedanceProvider } from '../generation/doraRouterSeedanceProvider.js'
import { GenerationTaskRunner, type TaskDispatcher } from './taskDispatcher.js'

async function fixture(continuity = false, missing = false) {
  const store = new AppStore(null)
  await store.initialize()
  const context = await store.mutate((state) => {
    const project = state.projects[0]!
    const shot = state.shots.find((item) => item.projectId === project.id)!
    shot.prompt = '角色参考【图1】，场景参考【图2】，人物转身。'
    shot.referenceImages = [{ url: '/api/v1/media/outfit', name: '服装图' }, { url: '/api/v1/media/scene' }]
    const face = { id: 'face', url: '/api/v1/media/face', name: '面部' }
    const asset = {
      id: 'numbered-actor',
      name: '测试人物',
      kind: 'character',
      projectId: project.id,
      tenantId: project.tenantId,
      imageUrl: shot.referenceImages[0]!.url,
      prompt: '',
      description: '',
      references: [],
      attributes: {
        type: 'character',
        subjectType: 'human',
        portraitSource: 'ai-virtual',
        visualStyle: 'photorealistic',
        faceStatus: 'approved',
        faceReference: face,
        bodyReference: { ...face, id: 'outfit', url: '/api/v1/media/outfit' },
        trustedPortrait: {
          assetId: 'trusted-actor',
          status: 'active',
          groupType: 'AIGC',
          faceReferenceId: face.id,
        },
      },
    } as Asset
    state.assets = [asset]
    state.media = ['outfit', 'scene', 'face'].map((id) => ({
      id,
      url: `/api/v1/media/${id}`,
      projectId: project.id,
      tenantId: missing && id === 'outfit' ? 'foreign-tenant' : project.tenantId,
      userId: project.ownerId,
      storageKey: `${id}.png`,
      fileName: `${id}.png`,
      contentType: 'image/png',
      size: 20,
      createdAt: new Date().toISOString(),
    }))
    state.tasks = []
    return { project, shot, shots: [shot], assets: [asset] }
  })
  const makeTask = (input: CreateGenerationTask): GenerationTask => ({
    ...input,
    id: input.clientRequestId,
    tenantId: context.project.tenantId,
    userId: context.project.ownerId,
    prompt: input.prompt || '',
    negativePrompt: input.negativePrompt || '',
    model: null,
    metadata: input.metadata || {},
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultUrl: null,
    outputs: [],
    error: null,
    maxAttempts: 1,
  })
  if (continuity)
    await store.mutate((state) => {
      state.tasks.push({
        ...makeTask({
          clientRequestId: 'previous',
          projectId: context.project.id,
          kind: 'video',
          provider: 'seedance',
          estimatedCredits: 0,
          label: '前镜',
        }),
        status: 'completed',
        metadata: {
          generatedOutputs: [
            { view: 'last-frame', storageKey: 'tail.png', contentType: 'image/png', size: 20 },
          ],
        },
      })
    })
  const repository = {
    canCreate: vi.fn(async () => true),
    storyboardVideoContext: vi.fn(async () => context),
    blockedPortraitNames: vi.fn(async () => []),
    stringXPortraitNames: vi.fn(async () => []),
    createWithCharge: vi.fn(async (input: CreateGenerationTask) => {
      const task = makeTask(input)
      await store.mutate((state) => {
        state.tasks.push(structuredClone(task))
      })
      return task
    }),
  } as unknown as GenerationTaskRepository
  const dispatcher = { dispatch: vi.fn() } as unknown as TaskDispatcher
  const service = new GenerationService(repository, dispatcher, null, 'dora-router-seedance')
  const input: CreateGenerationTask = {
    clientRequestId: 'numbered-task',
    projectId: context.project.id,
    kind: 'video',
    label: '多图镜头',
    provider: 'seedance',
    estimatedCredits: 18,
    metadata: {
      shotId: context.shot.id,
      referenceAssetIds: ['numbered-actor'],
      images: ['https://stale.example/wrong.png'],
      manualReferenceImages: [{ url: 'https://stale.example/wrong.png' }],
      continuityMode: continuity ? 'continue' : 'independent',
      ...(continuity ? { continuitySourceTaskId: 'previous' } : {}),
    },
  }
  const create = () =>
    service.createTask(input, {
      tenantId: context.project.tenantId,
      userId: context.project.ownerId,
      roles: ['member'],
    })
  return { store, context, repository, create, input }
}

describe('shot editor references through API snapshot, worker and Dora payload', () => {
  it.each([false, true])(
    'rejects an inconsistent tail-frame offset before charging, continuity=%s',
    async (continuity) => {
      const { input, repository, create } = await fixture(continuity)
      if (continuity) delete input.metadata!.continuitySourceTaskId
      else input.metadata!.continuitySourceTaskId = 'previous'
      await expect(create()).rejects.toMatchObject({ code: 'INVALID_SHOT_CONTINUITY' })
      expect(repository.createWithCharge).not.toHaveBeenCalled()
    },
  )
  it.each([false, true])(
    'preserves numbered images and submitted prompt with continuity=%s',
    async (continuity) => {
      const { store, context, create } = await fixture(continuity)
      const task = await create()
      expect(task.metadata.images).toEqual([
        '/api/v1/media/outfit',
        '/api/v1/media/scene',
        '/api/v1/media/face',
      ])
      await store.mutate((state) => {
        const shot = state.shots.find((item) => item.id === context.shot.id)!
        shot.referenceImages = [{ url: 'https://later.example/edit.png' }]
        shot.prompt = '排队后修改的提示词'
      })
      const requests: Record<string, unknown>[] = []
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') requests.push(JSON.parse(String(init.body)))
        return Response.json({ id: 'remote', status: 'running', progress: 5 })
      })
      const provider = new DoraRouterSeedanceProvider({
        baseUrl: 'https://test.invalid',
        apiKey: 'fake',
        defaultModel: 'fake',
        requestTimeoutMs: 1000,
        fetcher: fetcher as typeof fetch,
      })
      const storage = {
        get: vi.fn(async (key: string) => Buffer.from(key)),
        put: vi.fn(),
        delete: vi.fn(),
      } as ObjectStorage
      await new GenerationTaskRunner(store, {
        videoProvider: provider,
        videoProviderName: 'dora-router-seedance',
        objectStorage: storage,
      }).tick()
      expect(requests).toHaveLength(1)
      const content = requests[0]!.content as { text?: string; image_url?: { url: string } }[]
      const expected = [...(continuity ? ['tail.png'] : []), 'outfit.png', 'scene.png', 'face.png']
      expect(content.slice(1).map((item) => item.image_url?.url)).toEqual(
        expected.map((key) => `data:image/png;base64,${Buffer.from(key).toString('base64')}`),
      )
      expect(content[0]!.text).toContain(
        continuity ? '角色参考【图2】，场景参考【图3】' : '角色参考【图1】，场景参考【图2】',
      )
      expect(content[0]!.text).not.toContain('排队后修改')
    },
  )
  it('fails missing or foreign references instead of dropping an image and shifting later slots', async () => {
    const { store, create } = await fixture(false, true)
    await create()
    const provider = { submit: vi.fn(), getStatus: vi.fn(), getContent: vi.fn() }
    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      videoProviderName: 'stringx-seedance',
      objectStorage: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as ObjectStorage,
    }).tick()
    expect(provider.submit).not.toHaveBeenCalled()
    expect(store.read((state) => state.tasks.find((task) => task.id === 'numbered-task')?.status)).toBe(
      'failed',
    )
  })
  it('keeps the approved face when the shot has no manual image', async () => {
    const { store, context, create } = await fixture(false, true)
    context.shot.referenceImages = []
    context.shot.prompt = '角色出现并走过场景。'
    await create()
    const provider = {
      submit: vi.fn(async () => ({ providerTaskId: 'remote-auto-reference', status: 'queued', progress: 0 })),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    const storage = {
      get: vi.fn(async (key: string) => Buffer.from(key)),
      put: vi.fn(),
      delete: vi.fn(),
    } as ObjectStorage

    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      videoProviderName: 'dora-router-seedance',
      objectStorage: storage,
    }).tick()

    expect(provider.submit).toHaveBeenCalledOnce()
    expect(provider.submit.mock.calls[0]?.[0].images).toEqual([
      { url: `data:image/png;base64,${Buffer.from('face.png').toString('base64')}`, role: 'reference_image' },
    ])
  })
  it('submits both the approved face and full-body look without replacing the body with the face', async () => {
    const { store, context, create } = await fixture()
    context.shot.referenceImages = []
    context.shot.prompt = '测试人物转身走过场景。'
    const asset = context.assets[0]!
    if (asset.attributes.type !== 'character') throw new Error('Expected character')
    asset.attributes.bodyStatus = 'approved'
    await store.mutate((state) => {
      state.assets = [structuredClone(asset)]
    })
    const task = await create()
    expect(task.metadata.images).toEqual(['/api/v1/media/face', '/api/v1/media/outfit'])
    const provider = {
      submit: vi.fn(async () => ({ providerTaskId: 'remote-with-look', status: 'queued', progress: 0 })),
      getStatus: vi.fn(),
      getContent: vi.fn(),
    }
    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      videoProviderName: 'dora-router-seedance',
      objectStorage: {
        get: vi.fn(async (key: string) => Buffer.from(key)),
        put: vi.fn(),
        delete: vi.fn(),
      } as ObjectStorage,
    }).tick()
    expect(provider.submit).toHaveBeenCalledOnce()
    expect(provider.submit.mock.calls[0]?.[0].images).toEqual(
      ['face.png', 'outfit.png'].map((key) => ({
        url: `data:image/png;base64,${Buffer.from(key).toString('base64')}`,
        role: 'reference_image',
      })),
    )
    expect(
      store.read(
        (state) => state.tasks.find((item) => item.id === task.id)?.metadata.providerReferenceImageCount,
      ),
    ).toBe(2)
  })
  it.each(['dangling', 'overflow'])('rejects %s before charging', async (failure) => {
    const { context, repository, create } = await fixture(true)
    if (failure === 'dangling') context.shot.prompt = '使用【图3】'
    else context.shot.referenceImages = Array.from({ length: 9 }, (_, i) => ({ url: `/api/v1/media/${i}` }))
    await expect(create()).rejects.toMatchObject({ code: 'INVALID_SHOT_REFERENCES' })
    expect(repository.createWithCharge).not.toHaveBeenCalled()
  })
})
