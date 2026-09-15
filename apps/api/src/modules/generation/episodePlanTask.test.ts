import { describe, expect, it, vi } from 'vitest'
import { createProjectSchema, createGenerationTaskSchema, type Principal } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from '../projects/repository.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'

describe('episode batch submission', () => {
  it('deduplicates concurrent submissions, uses server billing, and retries a hidden failure once', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
    const project = await new ProjectRepository(store).create(
      createProjectSchema.parse({ name: '批量任务', contentType: 'short-drama', aspectRatio: '9:16' }),
      principal,
    )
    const repository = new GenerationTaskRepository(store)
    const dispatcher = { dispatch: vi.fn(async () => {}) } as unknown as TaskDispatcher
    const service = new GenerationService(repository, dispatcher, null, undefined, null, null, {
      generate: vi.fn(),
    })
    const input = createGenerationTaskSchema.parse({
      projectId: project.id,
      clientRequestId: 'batch-ui-1',
      kind: 'text',
      provider: 'text',
      label: '分集',
      estimatedCredits: 6,
      metadata: {
        scriptOperation: 'generate',
        episodePlan: {
          id: '7c3763e5-0ea7-46ef-b8b6-de95107ec675',
          episodes: [
            { title: '回家', source: '林晚回家。' },
            { title: '出发', source: '林晚出发。' },
          ],
        },
      },
    })
    const [first, duplicate] = await Promise.all([
      service.createTask(input, principal),
      service.createTask({ ...input, clientRequestId: 'batch-ui-2' }, principal),
    ])
    expect(first.id).toBe(duplicate.id)
    expect(first.estimatedCredits).toBe(0)
    expect(first.metadata.billingMode).toBe('direct')
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === first.id)!
      task.status = 'failed'
      task.metadata.queueHiddenAt = new Date().toISOString()
    })
    const retry = await service.createTask(input, principal)
    expect(retry.id).not.toBe(first.id)
    expect((await service.createTask(input, principal)).id).toBe(retry.id)
  })
})
