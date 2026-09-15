import type { GenerationTask } from '@seqora/contracts'
import { QUALITY_RULE_VERSION } from '@seqora/prompting'
import { describe, expect, it, vi } from 'vitest'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { TokenAdventImageProvider } from '../generation/tokenAdventImageProvider.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

describe('image task subject quality rules', () => {
  it.each([
    { subjectType: 'human', stage: 'face', assetKind: 'character', human: true },
    { subjectType: 'human', stage: 'body', assetKind: 'character', human: true },
    { subjectType: 'human', stage: 'turnaround', assetKind: 'character', human: true },
    { subjectType: undefined, stage: 'face', assetKind: 'character', human: true },
    { subjectType: undefined, stage: 'body', assetKind: 'character', human: true },
    { subjectType: undefined, stage: 'turnaround', assetKind: 'character', human: true },
    { subjectType: undefined, stage: 'face', assetKind: undefined, attributesType: 'character', human: true },
    { subjectType: 'animal', stage: 'face', assetKind: 'character', human: false },
    { subjectType: 'animal', stage: 'body', assetKind: 'character', human: false },
    { subjectType: 'animal', stage: 'turnaround', assetKind: 'character', human: false },
    { subjectType: undefined, stage: 'scene', assetKind: 'scene', human: false },
    { subjectType: undefined, stage: 'prop', assetKind: 'prop', human: false },
    { subjectType: undefined, stage: 'costume', assetKind: 'costume', human: false },
    { subjectType: undefined, stage: 'storyboard', assetKind: 'storyboard', human: false },
    { subjectType: undefined, stage: 'face', assetKind: undefined, storedSubject: 'human', human: true },
    { subjectType: undefined, stage: 'body', assetKind: undefined, storedSubject: 'animal', human: false },
    { subjectType: undefined, stage: 'face', assetKind: 'character', storedSubject: 'animal', human: false },
    { subjectType: 'animal', stage: 'body', assetKind: undefined, storedSubject: 'human', human: false },
    { subjectType: 'human', stage: 'face', assetKind: undefined, storedSubject: 'animal', human: true },
    {
      subjectType: undefined,
      stage: 'face',
      assetKind: undefined,
      storedSubject: 'human',
      otherTenant: true,
      human: false,
    },
    {
      subjectType: undefined,
      stage: 'face',
      assetKind: undefined,
      storedSubject: 'human',
      otherProject: true,
      human: false,
    },
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
      prompt: '高级模式覆盖：一只白猫作为角色，保留羽毛装饰外套、兽耳发饰和豹纹服装',
      negativePrompt: '不要红色围巾',
      provider: 'img2',
      model: 'gpt-image-2',
      metadata: {
        assetId: 'asset-subject-quality',
        assetKind: scenario.assetKind,
        generationStage: scenario.stage,
        aspectRatio: scenario.stage === 'face' ? '1:1' : '9:16',
        turnaround: scenario.stage === 'turnaround',
        promptMode: 'advanced',
        customPromptMode: 'replace',
        // Client-supplied or stale compiled metadata must never override the floor.
        compiledPositivePrompt: '旧规则：强制动物',
        ...(scenario.subjectType || 'attributesType' in scenario
          ? {
              attributes: {
                ...(scenario.subjectType ? { subjectType: scenario.subjectType } : {}),
                ...('attributesType' in scenario ? { type: scenario.attributesType } : {}),
              },
            }
          : {}),
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
      if ('storedSubject' in scenario) {
        const attributes = defaultAssetAttributes('character')
        if (attributes.type !== 'character') throw new Error('Invalid test fixture')
        attributes.subjectType = scenario.storedSubject === 'animal' ? 'animal' : 'human'
        state.assets.push({
          id: String(task.metadata.assetId),
          projectId: 'otherProject' in scenario ? 'other-project' : task.projectId,
          tenantId: 'otherTenant' in scenario ? 'other-tenant' : task.tenantId,
          kind: 'character',
          sourceMode: 'generate',
          name: '参考角色',
          description: '',
          prompt: '',
          promptMode: 'standard',
          customPromptMode: 'replace',
          customPrompt: '',
          negativePrompt: '',
          references: [],
          attributes,
          imageUrl: null,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        })
      }
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
    const originalPrompt = task.prompt
    const runner = new GenerationTaskRunner(store, {
      imageProvider,
      objectStorage,
      mediaRepository: {
        findSourceById: vi.fn(async () => ({ storageKey: 'test-reference.png', contentType: 'image/png' })),
      },
    })
    await runner.tick()
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
      expect(request.prompt.includes('主体必须是人类角色')).toBe(scenario.human)
      expect(request.prompt).not.toContain('避免出现：不要')
      expect(request.prompt).not.toContain('旧规则：强制动物')
      if (scenario.human) {
        const positive = request.prompt.split('画面约束（')[0]!
        expect(positive).toContain('主体必须是人类角色')
        expect(positive).toContain('保留装饰设计，佩戴者仍是人类')
        expect(positive).toContain('优先于自定义描述或参考图中的物种暗示')
        if (scenario.stage === 'face') expect(positive).not.toMatch(/完整入镜|全身视图|标准站姿/)
      }
    }
    const metadata = store.read((state) => state.tasks[0]!.metadata)
    expect(metadata.qualityRuleVersion).toBe(QUALITY_RULE_VERSION)
    expect(metadata.userNegativePrompt).toBe('不要红色围巾')
    expect((metadata.qualityPresetIds as string[]).includes('human-character')).toBe(scenario.human)
    expect(String(metadata.compiledPositivePrompt).includes('主体必须是人类角色')).toBe(scenario.human)
    if ('storedSubject' in scenario && !('otherTenant' in scenario) && !('otherProject' in scenario)) {
      expect(metadata.assetKind).toBe('character')
      expect(metadata.attributes).toMatchObject({
        subjectType: scenario.subjectType ?? scenario.storedSubject,
      })
    }
    expect(store.read((state) => state.tasks[0]!.prompt)).toBe(originalPrompt)
    expect(
      submitted.every((request) => request.prompt.includes(String(metadata.compiledNegativePrompt))),
    ).toBe(true)
    if (scenario.stage === 'turnaround') {
      expect(submitted[0]!.prompt).toContain('仅生成角色正面全身视图')
      expect(submitted[1]!.prompt).toContain('仅生成角色侧面全身视图')
      expect(submitted[2]!.prompt).toContain('仅生成角色背面全身视图')
    }
    if (scenario.subjectType === 'human' && scenario.stage === 'turnaround') {
      const originalSubmissions = submitted.map((request) => ({ ...request }))
      await store.mutate((state) => {
        state.tasks[0]!.status = 'queued'
      })
      await runner.tick()
      await vi.waitFor(() => expect(submitted).toHaveLength(6))
      await vi.waitFor(() => expect(store.read((state) => state.tasks[0]!.status)).toBe('completed'))
      expect(submitted.slice(3)).toEqual(originalSubmissions)
      expect(store.read((state) => state.tasks[0]!.prompt)).toBe(originalPrompt)
    }
  })
})
