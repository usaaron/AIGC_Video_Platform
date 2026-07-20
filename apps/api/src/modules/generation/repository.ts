import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { StateStore } from '../../infra/store.js'

const PROVIDER_RETRY_METADATA_KEYS = new Set([
  'providerName',
  'providerState',
  'providerTaskId',
  'providerPolledAt',
  'providerPollErrors',
])

export type CreateReservedTaskResult =
  { task: GenerationTask } | { error: 'account-not-found' | 'insufficient-credits' | 'project-not-found' }

export interface GenerationTaskStore {
  createWithCredit(input: CreateGenerationTask, principal: Principal): Promise<CreateReservedTaskResult>
  listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]>
  findById(taskId: string, principal: Principal): Promise<GenerationTask | null>
  retry(taskId: string, principal: Principal): Promise<GenerationTask | null>
  clearCompleted(projectId: string, principal: Principal): Promise<number>
}

export class GenerationTaskRepository implements GenerationTaskStore {
  constructor(private readonly store: StateStore) {}

  async canCreate(projectId: string, principal: Principal): Promise<boolean> {
    return this.store.read((state) =>
      state.projects.some(
        (project) =>
          project.id === projectId &&
          project.tenantId === principal.tenantId &&
          project.ownerId === principal.userId,
      ),
    )
  }

  async createWithCredit(
    input: CreateGenerationTask,
    principal: Principal,
  ): Promise<CreateReservedTaskResult> {
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: randomUUID(),
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
    return this.store.mutate((state) => {
      const existing = state.tasks.find(
        (item) =>
          item.clientRequestId === input.clientRequestId &&
          item.userId === principal.userId &&
          item.tenantId === principal.tenantId,
      )
      if (existing) return { task: existing }

      const project = state.projects.find(
        (item) =>
          item.id === input.projectId &&
          item.tenantId === principal.tenantId &&
          item.ownerId === principal.userId,
      )
      if (!project) return { error: 'project-not-found' }

      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) return { error: 'account-not-found' }

      const ledgerId = `generation-${input.clientRequestId}`
      const existingLedger = state.ledger.some((entry) => entry.id === ledgerId && entry.userId === user.id)
      if (!existingLedger) {
        if (user.credits < input.estimatedCredits) return { error: 'insufficient-credits' }
        user.credits -= input.estimatedCredits
        state.ledger.unshift({
          id: ledgerId,
          userId: user.id,
          tenantId: user.tenantId,
          amount: -input.estimatedCredits,
          balance: user.credits,
          type: 'generation',
          description: input.label,
          createdAt: now,
        })
      }

      state.tasks.unshift(task)
      return { task }
    })
  }

  async listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]> {
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

  async findById(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
    return this.store.read(
      (state) =>
        state.tasks.find(
          (task) =>
            task.id === taskId &&
            task.tenantId === principal.tenantId &&
            (canReadAll || task.userId === principal.userId),
        ) ?? null,
    )
  }

  async retry(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
    return this.store.mutate((state) => {
      const task = state.tasks.find(
        (item) =>
          item.id === taskId &&
          item.tenantId === principal.tenantId &&
          (canReadAll || item.userId === principal.userId),
      )
      if (!task) return null

      task.metadata = Object.fromEntries(
        Object.entries(task.metadata).filter(([key]) => !PROVIDER_RETRY_METADATA_KEYS.has(key)),
      )
      task.status = 'queued'
      task.progress = 0
      task.error = null
      task.resultUrl = null
      task.outputs = []
      task.updatedAt = new Date().toISOString()
      return task
    })
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
