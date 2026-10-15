import type { CreateGenerationTask, GenerationTask, GenerationTaskLog, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { cancellationResourceLockMetadataFor } from '../../core/jobs/taskResourceLock.js'
import { appendTaskLogToMetadata, taskLogsFromMetadata } from '../../core/jobs/taskLog.js'
import type { StateStore } from '../../infra/store.js'

const PROVIDER_RETRY_METADATA_KEYS = new Set([
  'providerName',
  'providerState',
  'providerTaskId',
  'providerPolledAt',
  'providerPollErrors',
  'cancelRequestedAt',
  'cancelledAt',
  'deleteRequestedAt',
  'cancelResourceLockKind',
  'cancelResourceLockKey',
  'cancelClaimedAt',
  'cancelLeaseExpiresAt',
  'refundCredits',
  'refundPolicy',
  'providerCancelError',
])

export type CreateReservedTaskResult =
  { task: GenerationTask } | { error: 'account-not-found' | 'insufficient-credits' | 'project-not-found' }
export type TaskMutationResult =
  | { task: GenerationTask }
  | {
      error:
        | 'account-not-found'
        | 'insufficient-credits'
        | 'task-not-cancellable'
        | 'task-not-deletable'
        | 'task-not-found'
        | 'task-not-pausable'
        | 'task-not-resumable'
    }
export type TaskDeleteResult =
  { deleted: true } | { task: GenerationTask } | Extract<TaskMutationResult, { error: string }>

export interface GenerationTaskStore {
  createWithCredit(input: CreateGenerationTask, principal: Principal): Promise<CreateReservedTaskResult>
  listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]>
  findById(taskId: string, principal: Principal): Promise<GenerationTask | null>
  listLogs(taskId: string, principal: Principal): Promise<GenerationTaskLog[] | null>
  retry(taskId: string, principal: Principal): Promise<TaskMutationResult>
  pause(taskId: string, principal: Principal): Promise<TaskMutationResult>
  resume(taskId: string, principal: Principal): Promise<TaskMutationResult>
  cancel(taskId: string, principal: Principal): Promise<TaskMutationResult>
  delete(taskId: string, principal: Principal): Promise<TaskDeleteResult>
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
          canAccessProject(state, projectId, principal, 'edit'),
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
          canAccessProject(state, item.id, principal, 'edit'),
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

      task.metadata = appendTaskLogToMetadata(task.metadata, task, {
        level: 'info',
        event: 'task.created',
        message: 'Generation task created and credits reserved',
        details: {
          provider: task.provider,
          kind: task.kind,
          estimatedCredits: task.estimatedCredits,
        },
        createdAt: now,
      })
      state.tasks.unshift(task)
      return { task }
    })
  }

  async listByProject(projectId: string, principal: Principal): Promise<GenerationTask[]> {
    return this.store.read((state) =>
      state.tasks.filter((task) => {
        const project = state.projects.find(
          (item) => item.id === projectId && item.tenantId === principal.tenantId,
        )
        return Boolean(
          project &&
          task.projectId === projectId &&
          task.tenantId === principal.tenantId &&
          canAccessProject(state, projectId, principal, 'read'),
        )
      }),
    )
  }

  async findById(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    return this.store.read((state) => {
      const task = state.tasks.find((item) => item.id === taskId && item.tenantId === principal.tenantId)
      if (!task) return null
      return canAccessProject(state, task.projectId, principal, 'read') ? task : null
    })
  }

  async listLogs(taskId: string, principal: Principal): Promise<GenerationTaskLog[] | null> {
    const task = await this.findById(taskId, principal)
    return task ? taskLogsFromMetadata(task.metadata) : null
  }

  async retry(taskId: string, principal: Principal): Promise<TaskMutationResult> {
    return this.store.mutate((state) => {
      const task = state.tasks.find(
        (item) =>
          item.id === taskId &&
          item.tenantId === principal.tenantId &&
          canAccessProject(state, item.projectId, principal, 'edit'),
      )
      if (!task) return { error: 'task-not-found' }
      if (task.status === 'queued' || task.status === 'running') return { task }
      if (task.status === 'completed') return { error: 'task-not-cancellable' }

      const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
      if (!user) return { error: 'account-not-found' }
      const refundedCredits = numberValue(task.metadata.refundCredits, 0)
      if (task.status === 'cancelled' && refundedCredits > 0) {
        if (user.credits < task.estimatedCredits) return { error: 'insufficient-credits' }
        user.credits -= task.estimatedCredits
        state.ledger.unshift({
          id: `retry-${task.id}-${numberValue(task.metadata.retryAttempt, 0) + 1}`,
          userId: user.id,
          tenantId: user.tenantId,
          amount: -task.estimatedCredits,
          balance: user.credits,
          type: 'generation',
          description: `Retry generation task: ${task.label}`,
          createdAt: new Date().toISOString(),
        })
      }

      const metadata = Object.fromEntries(
        Object.entries(task.metadata).filter(([key]) => !PROVIDER_RETRY_METADATA_KEYS.has(key)),
      )
      metadata.retryAttempt = numberValue(task.metadata.retryAttempt, 0) + 1
      task.metadata = appendTaskLogToMetadata(metadata, task, {
        level: 'info',
        event: 'task.retried',
        message: 'Task returned to the queue for retry',
        details: {
          retryAttempt: metadata.retryAttempt,
          reservedCredits: task.status === 'cancelled' && refundedCredits > 0 ? task.estimatedCredits : 0,
        },
      })
      task.status = 'queued'
      task.progress = 0
      task.error = null
      task.resultUrl = null
      task.outputs = []
      task.updatedAt = new Date().toISOString()
      return { task }
    })
  }

  async pause(taskId: string, principal: Principal): Promise<TaskMutationResult> {
    return this.store.mutate((state) => {
      const task = editableTask(state, taskId, principal)
      if (!task) return { error: 'task-not-found' }
      if (task.status === 'paused') return { task }
      if (task.status !== 'queued') return { error: 'task-not-pausable' }

      const now = new Date().toISOString()
      task.status = 'paused'
      task.metadata = appendTaskLogToMetadata({ ...task.metadata, pausedAt: now }, task, {
        level: 'info',
        event: 'task.paused',
        message: 'Task paused before provider submission',
        createdAt: now,
      })
      task.updatedAt = now
      return { task }
    })
  }

  async resume(taskId: string, principal: Principal): Promise<TaskMutationResult> {
    return this.store.mutate((state) => {
      const task = editableTask(state, taskId, principal)
      if (!task) return { error: 'task-not-found' }
      if (task.status !== 'paused') return { error: 'task-not-resumable' }

      const now = new Date().toISOString()
      const metadata = { ...task.metadata }
      delete metadata.pausedAt
      metadata.resumedAt = now
      task.status = 'queued'
      task.metadata = appendTaskLogToMetadata(metadata, task, {
        level: 'info',
        event: 'task.resumed',
        message: 'Task resumed and returned to the queue',
        createdAt: now,
      })
      task.updatedAt = now
      return { task }
    })
  }

  async cancel(taskId: string, principal: Principal): Promise<TaskMutationResult> {
    return this.store.mutate((state) => {
      const task = editableTask(state, taskId, principal)
      if (!task) return { error: 'task-not-found' }
      if (task.status === 'cancelled') return { task }
      if (!isCancellable(task)) return { error: 'task-not-cancellable' }

      if (task.status === 'running' && hasProviderTaskId(task)) {
        const now = new Date().toISOString()
        const lock = cancellationResourceLockMetadataFor(task)
        task.error = 'Cancellation requested'
        task.metadata = appendTaskLogToMetadata(
          {
            ...task.metadata,
            cancelRequestedAt: stringValue(task.metadata.cancelRequestedAt, now),
            providerState: 'cancelling',
            ...lock,
          },
          task,
          {
            level: 'warn',
            event: 'task.cancel_requested',
            message: 'Cancellation requested; worker will finalize provider task',
            details: { providerTaskId: task.metadata.providerTaskId, ...lock },
            createdAt: now,
          },
        )
        task.updatedAt = now
        return { task }
      }

      const refundCredits = refundableCreditsFor(task)
      const now = new Date().toISOString()
      if (refundCredits > 0) {
        const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
        if (!user) return { error: 'account-not-found' }
        const refundId = refundLedgerIdFor(task)
        if (!state.ledger.some((entry) => entry.id === refundId)) {
          user.credits += refundCredits
          state.ledger.unshift({
            id: refundId,
            userId: user.id,
            tenantId: user.tenantId,
            amount: refundCredits,
            balance: user.credits,
            type: 'adjustment',
            description: `Refund cancelled task: ${task.label}`,
            createdAt: now,
          })
        }
      }

      task.status = 'cancelled'
      task.progress = 100
      task.error = 'Task cancelled by user'
      task.metadata = {
        ...task.metadata,
        cancelledAt: now,
        refundCredits,
        refundPolicy: refundCredits > 0 ? 'full-before-provider-start' : 'no-refund-provider-started',
      }
      task.metadata = appendTaskLogToMetadata(task.metadata, task, {
        level: 'warn',
        event: 'task.cancelled',
        message: 'Task cancelled by user',
        details: {
          refundCredits,
          refundPolicy: task.metadata.refundPolicy,
        },
        createdAt: now,
      })
      task.updatedAt = now
      return { task }
    })
  }

  async delete(taskId: string, principal: Principal): Promise<TaskDeleteResult> {
    return this.store.mutate((state) => {
      const task = editableTask(state, taskId, principal)
      if (!task) return { error: 'task-not-found' }

      if (task.status === 'running' && hasProviderTaskId(task)) {
        const now = new Date().toISOString()
        const lock = cancellationResourceLockMetadataFor(task)
        task.error = 'Deletion requested'
        task.metadata = appendTaskLogToMetadata(
          {
            ...task.metadata,
            cancelRequestedAt: stringValue(task.metadata.cancelRequestedAt, now),
            deleteRequestedAt: now,
            providerState: 'cancelling',
            ...lock,
          },
          task,
          {
            level: 'warn',
            event: 'task.delete_requested',
            message: 'Delete requested; worker will cancel provider task first',
            details: { providerTaskId: task.metadata.providerTaskId, ...lock },
            createdAt: now,
          },
        )
        task.updatedAt = now
        return { task }
      }

      if (!isDeletableWithoutProvider(task)) return { error: 'task-not-deletable' }

      const refundCredits = refundableCreditsFor(task)
      if (refundCredits > 0) {
        const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
        if (!user) return { error: 'account-not-found' }
        const refundId = refundLedgerIdFor(task)
        if (!state.ledger.some((entry) => entry.id === refundId)) {
          const now = new Date().toISOString()
          user.credits += refundCredits
          state.ledger.unshift({
            id: refundId,
            userId: user.id,
            tenantId: user.tenantId,
            amount: refundCredits,
            balance: user.credits,
            type: 'adjustment',
            description: `Refund deleted task: ${task.label}`,
            createdAt: now,
          })
        }
      }

      state.tasks = state.tasks.filter((item) => item.id !== task.id)
      return { deleted: true }
    })
  }

  async clearCompleted(projectId: string, principal: Principal): Promise<number> {
    return this.store.mutate((state) => {
      if (!canAccessProject(state, projectId, principal, 'edit')) return 0
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

function refundableCreditsFor(task: GenerationTask): number {
  if (task.status === 'queued' || task.status === 'paused') return task.estimatedCredits
  if (task.status === 'running' && !task.metadata.providerTaskId) return task.estimatedCredits
  return 0
}

function refundLedgerIdFor(task: GenerationTask): string {
  return `refund-${task.id}-${numberValue(task.metadata.retryAttempt, 0)}`
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function editableTask(
  state: Parameters<typeof canAccessProject>[0] & { tasks: GenerationTask[] },
  taskId: string,
  principal: Principal,
): GenerationTask | undefined {
  return state.tasks.find(
    (item) =>
      item.id === taskId &&
      item.tenantId === principal.tenantId &&
      canAccessProject(state, item.projectId, principal, 'edit'),
  )
}

function isCancellable(task: GenerationTask): boolean {
  return task.status === 'queued' || task.status === 'paused' || task.status === 'running'
}

function isDeletableWithoutProvider(task: GenerationTask): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'paused' ||
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    (task.status === 'running' && !hasProviderTaskId(task))
  )
}

function hasProviderTaskId(task: GenerationTask): boolean {
  return typeof task.metadata.providerTaskId === 'string' && task.metadata.providerTaskId.length > 0
}

function canAccessProject(
  state: {
    users: Array<{ id: string; tenantId: string; email: string }>
    projects: Array<{ id: string; tenantId: string; ownerId: string }>
    projectShares: Array<{
      projectId: string
      tenantId: string
      sharedWithUserId: string | null
      sharedWithEmail: string | null
      status: string
      permission: 'view' | 'comment' | 'edit'
    }>
  },
  projectId: string,
  principal: Principal,
  mode: 'read' | 'edit',
): boolean {
  if (principal.roles.some((role) => role === 'admin' || role === 'owner')) return true
  const project = state.projects.find((item) => item.id === projectId && item.tenantId === principal.tenantId)
  if (!project) return false
  if (project.ownerId === principal.userId) return true
  const email =
    state.users
      .find((item) => item.id === principal.userId && item.tenantId === principal.tenantId)
      ?.email.toLowerCase() ?? ''
  const share = state.projectShares.find(
    (item) =>
      item.projectId === projectId &&
      item.tenantId === principal.tenantId &&
      item.status === 'active' &&
      (item.sharedWithUserId === principal.userId ||
        Boolean(item.sharedWithEmail && item.sharedWithEmail.toLowerCase() === email)),
  )
  if (!share) return false
  return mode === 'read' ? true : share.permission === 'edit'
}
