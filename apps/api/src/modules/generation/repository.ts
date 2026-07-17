import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'

export interface GenerationTaskRepository {
  create(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask>
  listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]>
}

export class InMemoryGenerationTaskRepository implements GenerationTaskRepository {
  private readonly tasks = new Map<string, GenerationTask>()

  async create(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    const task: GenerationTask = {
      id: randomUUID(),
      clientRequestId: input.clientRequestId,
      projectId: input.projectId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      kind: input.kind,
      label: input.label,
      status: 'queued',
      progress: 0,
      estimatedCredits: input.estimatedCredits,
      createdAt: new Date().toISOString(),
    }
    this.tasks.set(task.id, task)
    return task
  }

  async listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return [...this.tasks.values()].filter(
      (task) => task.projectId === projectId && task.tenantId === principal.tenantId,
    )
  }
}
