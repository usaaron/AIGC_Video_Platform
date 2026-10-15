import { DEFAULT_SCRIPT_DIRECTION, type GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors.js'
import { AppStore } from '../../infra/store.js'
import type { ProjectService } from '../../modules/projects/service.js'
import { createScriptTaskHandler } from './scriptTaskHandler.js'
import type { TextTaskWriteGuard } from './textTaskExecutionGuard.js'

function handlerFixture(operation: 'generate' | 'enrich' | 'suggest-assets') {
  const user = { id: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
  const read = vi.fn((reader: (state: { users: (typeof user)[] }) => unknown) => reader({ users: [user] }))
  const store = { read } as unknown as AppStore
  const methods = {
    generateScript: vi.fn(async () => ({ script: 'generated' })),
    enrichScript: vi.fn(async () => ({ script: 'enriched' })),
    suggestScriptAssets: vi.fn(async () => ({ assets: [] })),
  }
  const service = methods as unknown as ProjectService
  const task = {
    id: 'script-task',
    clientRequestId: 'script-client',
    projectId: 'project-1',
    tenantId: user.tenantId,
    userId: user.id,
    kind: 'text',
    label: '剧本生成',
    prompt: '',
    negativePrompt: '',
    provider: 'text',
    model: 'seqora-5.6',
    metadata: {
      scriptOperation: operation,
      draft: '林晚回家。',
      script: '林晚回家。',
      direction: DEFAULT_SCRIPT_DIRECTION,
      mode: 'quick',
      episodeId: 'episode-1',
    },
    status: 'running',
    progress: 12,
    estimatedCredits: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultUrl: null,
    outputs: [],
    error: null,
  } satisfies GenerationTask
  return { read, service, methods, task, handler: createScriptTaskHandler(store, service) }
}

describe('createScriptTaskHandler', () => {
  it.each(['generate', 'enrich', 'suggest-assets'] as const)(
    'rejects inactive %s tasks before reading the account or calling the service',
    async (operation) => {
      const f = handlerFixture(operation)
      const assertActive = vi.fn(async () => {
        throw new AppError(409, 'TASK_LEASE_LOST', '执行权失效')
      })
      await expect(f.handler(f.task, { assertActive })).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' })
      expect(assertActive).toHaveBeenCalledOnce()
      expect(f.read).not.toHaveBeenCalled()
      for (const method of Object.values(f.methods)) expect(method).not.toHaveBeenCalled()
    },
  )

  it.each(['generate', 'enrich'] as const)(
    'awaits startup validation and forwards the %s execution context unchanged',
    async (operation) => {
      const f = handlerFixture(operation)
      let release!: () => void
      const assertActive = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      const taskWriteGuard = Object.freeze({ marker: 'private-write-guard' }) as unknown as TextTaskWriteGuard
      const context = { assertActive, taskWriteGuard, onTextProgress: vi.fn(), onTextTiming: vi.fn() }
      const pending = f.handler(f.task, context)
      await vi.waitFor(() => expect(assertActive).toHaveBeenCalledOnce())
      expect(f.read).not.toHaveBeenCalled()
      for (const method of Object.values(f.methods)) expect(method).not.toHaveBeenCalled()
      release()
      await pending
      const method =
        operation === 'generate' ? vi.mocked(f.service.generateScript) : vi.mocked(f.service.enrichScript)
      expect(method).toHaveBeenCalledOnce()
      expect(method.mock.calls[0]?.[operation === 'generate' ? 17 : 14]).toBe(context)
      expect(method.mock.calls[0]?.[operation === 'generate' ? 15 : 13]).toBe('episode-1')
    },
  )

  it('does not let a queued task override the asset suggestion model', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const service = {
      suggestScriptAssets: vi.fn(async () => ({
        summary: '建议先建立主角和核心场景',
        assets: [],
        generatedAt: new Date().toISOString(),
        warnings: [],
      })),
    } as unknown as ProjectService
    const task = {
      id: 'script-asset-suggestions-task',
      clientRequestId: 'script-asset-suggestions-client',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      kind: 'text',
      label: '资产建议',
      prompt: '',
      negativePrompt: '',
      provider: 'text',
      model: 'glm-5.2-fast',
      metadata: {
        generationStage: 'script-asset-suggestions',
        scriptOperation: 'suggest-assets',
        script: '场次：1｜场景：雨夜车站｜角色：林夏',
        direction: {
          style: 'cinematic-cg',
          composition: 'rule-of-thirds',
          lighting: 'low-key',
          camera: 'restrained',
          focus: 'character',
        },
      },
      status: 'running',
      progress: 12,
      estimatedCredits: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resultUrl: null,
      outputs: [],
      error: null,
    } satisfies GenerationTask

    const onTextProgress = vi.fn()
    const onTextTiming = vi.fn()
    const result = await createScriptTaskHandler(store, service)(task, { onTextProgress, onTextTiming })

    expect(service.suggestScriptAssets).toHaveBeenCalledWith(
      task.projectId,
      task.metadata.script,
      task.metadata.direction,
      { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] },
      onTextProgress,
      onTextTiming,
    )
    expect(result).toMatchObject({ summary: '建议先建立主角和核心场景', assets: [] })
  })
})
