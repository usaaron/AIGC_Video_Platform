import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { AppStore } from '../../infra/store.js'

export class GenerationTaskRepository {
  constructor(private readonly store: AppStore) {}

  canCreate(projectId: string, principal: Principal): boolean {
    return this.store.read((state) =>
      state.projects.some(
        (project) =>
          project.id === projectId &&
          project.tenantId === principal.tenantId &&
          project.ownerId === principal.userId,
      ),
    )
  }

  async create(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    const now = new Date().toISOString()
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
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      error: null,
    }
    return this.store.mutate((state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing
      state.tasks.unshift(task)
      return task
    })
  }

  listByProject(projectId: string, principal: Principal): GenerationTask[] {
    const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
    return this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.tenantId === principal.tenantId &&
          (canReadAll || task.userId === principal.userId),
      ),
    )
  }

  async clearCompleted(projectId: string, principal: Principal): Promise<number> {
    return this.store.mutate((state) => {
      const before = state.tasks.length
      state.tasks = state.tasks.filter(
        (task) =>
          !(
            task.projectId === projectId &&
            task.userId === principal.userId &&
            (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
          ),
      )
      return before - state.tasks.length
    })
  }
}
