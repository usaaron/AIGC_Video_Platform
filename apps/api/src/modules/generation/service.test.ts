import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'

const principal: Principal = {
  userId: 'user-creator',
  tenantId: 'tenant-seqora-demo',
  roles: ['creator'],
}

describe('GenerationService task creation', () => {
  it('uses charged repository creation and does not reserve credits separately', async () => {
    const input: CreateGenerationTask = {
      clientRequestId: 'service-atomic-create',
      projectId: 'project-midnight-film',
      kind: 'image',
      label: 'Service atomic task',
      provider: 'local',
      estimatedCredits: 6,
    }
    const task = generationTask(input)
    const repository = {
      canCreate: vi.fn(() => true),
      blockedPortraitNames: vi.fn(() => []),
      stringXPortraitNames: vi.fn(() => []),
      createWithCharge: vi.fn(async () => task),
    } as unknown as GenerationTaskRepository
    const dispatcher = {
      dispatch: vi.fn(async () => undefined),
    } as unknown as TaskDispatcher
    const service = new GenerationService(repository, dispatcher)

    await expect(service.createTask(input, principal)).resolves.toMatchObject({ id: task.id })

    expect(repository.createWithCharge).toHaveBeenCalledWith(input, principal)
    expect(dispatcher.dispatch).toHaveBeenCalledWith(task)
  })
})

function generationTask(input: CreateGenerationTask): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: 'task-service-atomic-create',
    clientRequestId: input.clientRequestId,
    projectId: input.projectId,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: input.kind,
    label: input.label,
    prompt: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    provider: input.provider,
    model: input.model ?? null,
    metadata: input.metadata ?? {},
    status: 'queued',
    progress: 0,
    estimatedCredits: input.estimatedCredits,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}
