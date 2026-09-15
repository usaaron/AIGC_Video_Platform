import type { Asset, GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { VideoGenerationRequest } from '../generation/videoProvider.js'
import { GenerationService } from '../../modules/generation/service.js'
import type { GenerationTaskRepository } from '../../modules/generation/repository.js'
import type { TaskDispatcher } from './taskDispatcher.js'
import { createPublicMediaToken, verifyPublicMediaToken } from '../media/publicMediaToken.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

async function fixture(groupType = 'AIGC', mediaTenant = 'tenant-seqora-demo') {
  const store = new AppStore(null)
  await store.initialize()
  const task = await store.mutate((state) => {
    const project = state.projects.find((item) => item.id === 'project-midnight-film')!
    const shot = state.shots.find((item) => item.projectId === project.id)!
    const face = { id: 'test-face', url: '/api/v1/media/test-face', name: 'AI face' }
    const asset = {
      id: 'test-actor',
      projectId: project.id,
      tenantId: project.tenantId,
      kind: 'character',
      name: '验收人物',
      description: '',
      imageUrl: face.url,
      references: [face],
      attributes: {
        type: 'character',
        subjectType: 'human',
        portraitSource: groupType === 'AIGC' ? 'ai-virtual' : 'authorized-real',
        visualStyle: 'photorealistic',
        faceStatus: 'approved',
        faceReference: face,
        trustedPortrait: { assetId: 'maas-ai', groupType, status: 'active', faceReferenceId: face.id },
      },
    } as Asset
    state.assets.push(asset)
    state.media.push({
      id: face.id,
      tenantId: mediaTenant,
      projectId: project.id,
      userId: 'user-member',
      storageKey: 'private-face.png',
      fileName: 'face.png',
      contentType: 'image/png',
      size: 7,
      url: face.url,
      createdAt: new Date().toISOString(),
    } as (typeof state.media)[number])
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'portrait-video-test',
      clientRequestId: 'portrait-video-test',
      projectId: project.id,
      tenantId: project.tenantId,
      userId: 'user-member',
      kind: 'video',
      label: '人物视频',
      prompt: '验收人物微笑',
      negativePrompt: '',
      provider: 'seedance',
      model: null,
      metadata: {
        shotId: shot.id,
        referenceAssetIds: [asset.id],
        images: [face.url],
        duration: 5,
        generateAudio: true,
        aspectRatio: '16:9',
        resolution: '480p',
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 50,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
      maxAttempts: 1,
    }
    state.tasks = [task]
    return task
  })
  return { store, task }
}

describe('DoraRouter portrait worker integration', () => {
  it('sends an expiring image link instead of embedding a large production image', async () => {
    const { store } = await fixture()
    const submit = vi.fn(async (_request: VideoGenerationRequest) => ({
      providerTaskId: 'remote-test',
      status: 'queued' as const,
      progress: 0,
    }))
    const storage = { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as ObjectStorage
    const expiresAt = Date.now() + 60_000
    await new GenerationTaskRunner(store, {
      videoProvider: {
        submit,
        getStatus: vi.fn(async () => ({ status: 'running' as const, progress: 5, error: null })),
        getContent: vi.fn(),
      },
      videoProviderName: 'dora-router-seedance',
      objectStorage: storage,
      videoSourceUrl: (source) =>
        `https://app.example/api/v1/trusted-assets/source/${createPublicMediaToken(source, 'test-secret', expiresAt)}`,
    }).tick()
    const request = submit.mock.calls[0]?.[0] as unknown as { images: { url: string }[] }
    const url = request.images[0]!.url
    expect(url).toMatch(/^https:\/\/app.example\/api\/v1\/trusted-assets\/source\//)
    const token = url.split('/').at(-1)!
    expect(verifyPublicMediaToken(token, 'test-secret')).toMatchObject({
      storageKey: 'private-face.png',
      expiresAt,
    })
    expect(verifyPublicMediaToken(token, 'test-secret', expiresAt + 1)).toBeNull()
    expect(verifyPublicMediaToken(token, 'wrong-secret')).toBeNull()
    expect(storage.get).not.toHaveBeenCalled()
  })
  it.each([
    ['AIGC', 'tenant-seqora-demo', true],
    ['LivenessFace', 'tenant-seqora-demo', false],
    ['AIGC', 'another-tenant', false],
    ['AIGC', 'postgres', true],
    ['AIGC', 'postgres-denied', false],
  ] as const)('resolves %s with source tenant %s', async (groupType, tenant, allowed) => {
    const { store, task } = await fixture(groupType, tenant)
    const mediaRepository = tenant.startsWith('postgres')
      ? {
          findSourceById: vi.fn(async () =>
            tenant === 'postgres' ? { storageKey: 'private-face.png', contentType: 'image/png' } : null,
          ),
        }
      : null
    if (mediaRepository)
      await store.mutate((state) => {
        state.media = []
      })
    const provider = {
      submit: vi.fn(async () => ({ providerTaskId: 'remote-test', status: 'queued' as const, progress: 0 })),
      getStatus: vi.fn(async () => ({ status: 'running' as const, progress: 5, error: null })),
      getContent: vi.fn(),
    }
    const storage = {
      get: vi.fn(async () => Buffer.from('AI face')),
      put: vi.fn(),
      delete: vi.fn(),
    } as ObjectStorage
    await new GenerationTaskRunner(store, {
      videoProvider: provider,
      videoProviderName: 'dora-router-seedance',
      objectStorage: storage,
      mediaRepository,
    }).tick()
    if (mediaRepository)
      expect(mediaRepository.findSourceById).toHaveBeenCalledWith(
        'test-face',
        task.projectId,
        task.tenantId,
        'image',
      )
    if (allowed) {
      expect(provider.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [{ url: 'data:image/png;base64,QUkgZmFjZQ==', role: 'reference_image' }],
          generateAudio: true,
        }),
      )
    } else {
      expect(provider.submit).not.toHaveBeenCalled()
      expect(storage.get).not.toHaveBeenCalled()
      expect(store.read((state) => state.tasks.find((item) => item.id === task.id)?.status)).toBe('failed')
    }
  })

  it('rejects unsupported real-person resources before charging', async () => {
    const { store, task } = await fixture('LivenessFace')
    const context = store.read((state) => ({
      project: state.projects.find((item) => item.id === task.projectId)!,
      shot: state.shots.find((item) => item.id === task.metadata.shotId)!,
      shots: state.shots.filter((item) => item.projectId === task.projectId),
      assets: state.assets.filter((item) => item.projectId === task.projectId),
    }))
    const repository = {
      canCreate: vi.fn(async () => true),
      storyboardVideoContext: vi.fn(async () => context),
      createWithCharge: vi.fn(),
    } as unknown as GenerationTaskRepository
    const dispatcher = { dispatch: vi.fn() } as unknown as TaskDispatcher
    const service = new GenerationService(repository, dispatcher, null, 'dora-router-seedance')
    await expect(
      service.createTask(task, { userId: task.userId, tenantId: task.tenantId, roles: ['member'] }),
    ).rejects.toMatchObject({ code: 'REAL_PORTRAIT_VIDEO_UNSUPPORTED' })
    expect(repository.createWithCharge).not.toHaveBeenCalled()
  })
})
