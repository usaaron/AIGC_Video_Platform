import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import type { ProjectService } from '../../modules/projects/service.js'
import { createScriptTaskHandler } from './scriptTaskHandler.js'

describe('createScriptTaskHandler', () => {
  it('runs asset suggestions as an independent background operation', async () => {
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
      userId: 'user-creator',
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

    const result = await createScriptTaskHandler(store, service)(task)

    expect(service.suggestScriptAssets).toHaveBeenCalledWith(
      task.projectId,
      task.metadata.script,
      task.metadata.direction,
      { userId: 'user-creator', tenantId: 'tenant-seqora-demo', roles: ['creator'] },
      'glm-5.2-fast',
    )
    expect(result).toMatchObject({ summary: '建议先建立主角和核心场景', assets: [] })
  })
})
