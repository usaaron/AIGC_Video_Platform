import type { GenerationTask } from '@seqora/contracts'
import { QUALITY_RULE_VERSION } from '@seqora/prompting'
import { describe, expect, it, vi } from 'vitest'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore } from '../../infra/store.js'
import { TokenAdventImageProvider } from '../generation/tokenAdventImageProvider.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

describe('image task subject quality rules', () => {
  it.each([
    { subjectType: 'human', stage: 'face', assetKind: 'character', human: true },
    { subjectType: 'human', stage: 'body', assetKind: 'character', human: true },
    { subjectType: 'human', stage: 'turnaround', assetKind: 'character', human: true },
    { subjectType: undefined, stage: 'face', assetKind: 'character', human: true },
    { subjectType: 'animal', stage: 'face', assetKind: 'character', human: false },
    { subjectType: 'animal', stage: 'body', assetKind: 'character', human: false },
    { subjectType: undefined, stage: 'scene', assetKind: 'scene', human: false },
  ])('applies $subjectType/$stage rules to the actual Provider request', async (scenario) => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const hasReference = scenario.stage === 'body' || scenario.stage === 'turnaround'
    const task: GenerationTask = {
      id: 'subject-quality-task',
      clientRequestId: 'subject-quality-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'image',
      label: 'subject-quality',
      prompt: '高级模式自定义画面，保留羽毛装饰外套',
      negativePrompt: '不要红色围巾',
      provider: 'img2',
      model: 'gpt-image-2',
      metadata: {
        assetId: 'asset-subject-quality',
        assetKind: scenario.assetKind,
        generationStage: scenario.stage,
        aspectRatio: scenario.stage === 'face' ? '1:1' : '9:16',
        turnaround: scenario.stage === 'turnaround',
        ...(scenario.subjectType ? { attributes: { subjectType: scenario.subjectType } } : {}),
        ...(hasReference
          ? { references: [{ url: '/api/v1/media/test-reference', name: 'reference.png' }] }
          : {}),
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 4,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => {
      state.tasks = [task]
    })
    const submitted: Array<{ url: string; prompt: string }> = []
    const imageProvider = new TokenAdventImageProvider({
      baseUrl: 'https://image-provider.example/',
      apiKey: 'test-key',
      model: 'gpt-image-2',
      quality: 'low',
      requestTimeoutMs: 1000,
      fetcher: (async (url, init) => {
        const body = init?.body
        submitted.push({
          url: String(url),
          prompt: body instanceof FormData ? String(body.get('prompt')) : JSON.parse(String(body)).prompt,
        })
        return Response.json({ data: [{ b64_json: Buffer.from('test-png').toString('base64') }] })
      }) as typeof fetch,
    })
    const files = new Map([['test-reference.png', Buffer.from('test-reference')]])
    const objectStorage: ObjectStorage = {
      put: async (key, content) => {
        files.set(key, content)
      },
      get: async (key) => files.get(key) ?? Buffer.alloc(0),
      delete: async (key) => {
        files.delete(key)
      },
    }
    await new GenerationTaskRunner(store, {
      imageProvider,
      objectStorage,
      mediaRepository: {
        findSourceById: vi.fn(async () => ({ storageKey: 'test-reference.png', contentType: 'image/png' })),
      },
    }).tick()
    await vi.waitFor(() => {
      expect(store.read((state) => state.tasks[0]?.status)).toBe('completed')
    })

    expect(submitted).toHaveLength(scenario.stage === 'turnaround' ? 3 : 1)
    for (const request of submitted) {
      expect(request.url).toBe(
        `https://image-provider.example/v1/images/${hasReference ? 'edits' : 'generations'}`,
      )
      expect(request.prompt).toContain(task.prompt)
      expect(request.prompt).toContain('不要红色围巾')
      expect(request.prompt.includes('不要将人类角色生成为动物')).toBe(scenario.human)
    }
    const metadata = store.read((state) => state.tasks[0]!.metadata)
    expect(metadata.qualityRuleVersion).toBe(QUALITY_RULE_VERSION)
    expect(metadata.userNegativePrompt).toBe('不要红色围巾')
    expect((metadata.qualityPresetIds as string[]).includes('human-character')).toBe(scenario.human)
    expect(
      submitted.every((request) => request.prompt.includes(String(metadata.compiledNegativePrompt))),
    ).toBe(true)
  })
})
