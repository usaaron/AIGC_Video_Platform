import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { AppStore } from '../../infra/store.js'
import { AppError } from '../../core/errors.js'
import { normalizeGenerationTaskLifecycle, releaseGenerationTaskLease } from '../../core/jobs/taskLease.js'
import { cancellationResourceLockForTask } from '../../core/jobs/taskResourceLock.js'
import type { CreditLedger } from '../billing/creditLedger.js'

export class GenerationTaskRepository {
  constructor(
    private readonly store: AppStore,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

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

  blockedPortraitNames(input: CreateGenerationTask, principal: Principal): string[] {
    if (input.kind !== 'video' || !Array.isArray(input.metadata?.referenceAssetIds)) return []
    const referenceIds = input.metadata.referenceAssetIds.filter(
      (value): value is string => typeof value === 'string',
    )
    return this.store.read((state) =>
      state.assets
        .filter(
          (asset) =>
            referenceIds.includes(asset.id) &&
            asset.projectId === input.projectId &&
            asset.tenantId === principal.tenantId &&
            asset.attributes.type === 'character' &&
            asset.attributes.subjectType === 'human' &&
            (asset.attributes.portraitSource === 'authorized-real' ||
              asset.attributes.visualStyle === 'photorealistic') &&
            asset.attributes.trustedPortrait?.status !== 'active',
        )
        .map((asset) => asset.name),
    )
  }

  stringXPortraitNames(input: CreateGenerationTask, principal: Principal): string[] {
    if (input.kind !== 'video' || !Array.isArray(input.metadata?.referenceAssetIds)) return []
    const referenceIds = input.metadata.referenceAssetIds.filter(
      (value): value is string => typeof value === 'string',
    )
    return this.store.read((state) =>
      state.assets
        .filter(
          (asset) =>
            referenceIds.includes(asset.id) &&
            asset.projectId === input.projectId &&
            asset.tenantId === principal.tenantId &&
            asset.attributes.type === 'character' &&
            asset.attributes.trustedPortrait?.status === 'active' &&
            asset.attributes.trustedPortrait.assetId.startsWith('maas-'),
        )
        .map((asset) => asset.name),
    )
  }

  async create(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      const shotId = metadataString(input.metadata, 'shotId')
      if (input.kind === 'video' && shotId) {
        const activeTask = state.tasks.find(
          (item) =>
            item.projectId === input.projectId &&
            item.tenantId === principal.tenantId &&
            item.kind === 'video' &&
            item.metadata.shotId === shotId &&
            ['queued', 'paused', 'running'].includes(item.status) &&
            typeof item.metadata.queueHiddenAt !== 'string',
        )
        if (activeTask) {
          throw new AppError(
            409,
            'VIDEO_SHOT_BATCH_CONFLICT',
            '该镜头已有一个生成任务正在处理，请先在生成队列暂停或删除它，再重新选择生成策略。',
          )
        }
      }

      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now)
      state.tasks.unshift(task)
      return task
    })
  }

  async createWithCharge(input: CreateGenerationTask, principal: Principal): Promise<GenerationTask> {
    const creditLedger = this.creditLedger
    if (!creditLedger) {
      return this.store.transaction((state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      const shotId = metadataString(input.metadata, 'shotId')
      if (input.kind === 'video' && shotId) {
        const activeTask = state.tasks.find(
          (item) =>
            item.projectId === input.projectId &&
            item.tenantId === principal.tenantId &&
            item.kind === 'video' &&
            item.metadata.shotId === shotId &&
            ['queued', 'paused', 'running'].includes(item.status) &&
            typeof item.metadata.queueHiddenAt !== 'string',
        )
        if (activeTask) {
          throw new AppError(
            409,
            'VIDEO_SHOT_BATCH_CONFLICT',
            '璇ラ暅澶村凡鏈変竴涓敓鎴愪换鍔℃鍦ㄥ鐞嗭紝璇峰厛鍦ㄧ敓鎴愰槦鍒楁殏鍋滄垨鍒犻櫎瀹冿紝鍐嶉噸鏂伴€夋嫨鐢熸垚绛栫暐銆?',
          )
        }
      }

      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '璐﹀彿涓嶅瓨鍦?')
      if (user.credits < input.estimatedCredits) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', '绉垎涓嶈冻')
      }

      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now)
      user.credits -= input.estimatedCredits
      state.ledger.unshift({
        id: `generation-${input.clientRequestId}`,
        userId: user.id,
        tenantId: user.tenantId,
        amount: -input.estimatedCredits,
        balance: user.credits,
        type: 'generation',
        description: input.label,
        createdAt: now,
      })
      state.tasks.unshift(task)
      return task
    })
    }

    return this.store.transaction(async (state) => {
      const existing = state.tasks.find(
        (item) => item.clientRequestId === input.clientRequestId && item.userId === principal.userId,
      )
      if (existing) return existing

      const shotId = metadataString(input.metadata, 'shotId')
      if (input.kind === 'video' && shotId) {
        const activeTask = state.tasks.find(
          (item) =>
            item.projectId === input.projectId &&
            item.tenantId === principal.tenantId &&
            item.kind === 'video' &&
            item.metadata.shotId === shotId &&
            ['queued', 'paused', 'running'].includes(item.status) &&
            typeof item.metadata.queueHiddenAt !== 'string',
        )
        if (activeTask) {
          throw new AppError(
            409,
            'VIDEO_SHOT_BATCH_CONFLICT',
            '鐠囥儵鏆呮径鏉戝嚒閺堝绔存稉顏嗘晸閹存劒鎹㈤崝鈩冾劀閸︺劌顦╅悶鍡礉鐠囧嘲鍘涢崷銊ф晸閹存劙妲﹂崚妤佹畯閸嬫粍鍨ㄩ崚鐘绘珟鐎瑰喛绱濋崘宥夊櫢閺備即鈧瀚ㄩ悽鐔稿灇缁涙牜鏆愰妴?',
          )
        }
      }

      const user = state.users.find(
        (item) => item.id === principal.userId && item.tenantId === principal.tenantId,
      )
      if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', '鐠愶箑褰挎稉宥呯摠閸?')
      if (user.credits < input.estimatedCredits) {
        throw new AppError(402, 'INSUFFICIENT_CREDITS', '缁夘垰鍨庢稉宥堝喕')
      }

      const now = new Date().toISOString()
      const task = buildQueuedGenerationTask(input, principal, now)
      await creditLedger.reserveCreditsInState(
        state,
        principal,
        input.estimatedCredits,
        input.clientRequestId,
        input.label,
      )
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

  filmPreviewPlan(projectId: string, principal: Principal) {
    return this.store.read((state) => {
      const project = state.projects.find(
        (item) =>
          item.id === projectId &&
          item.tenantId === principal.tenantId &&
          (item.ownerId === principal.userId ||
            principal.roles.some((role) => role === 'admin' || role === 'owner')),
      )
      if (!project) return null
      const shots = state.shots
        .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
        .sort((left, right) => left.order - right.order)
      const sources = shots.map((shot) => ({
        shot,
        task: state.tasks.find(
          (task) =>
            task.projectId === projectId &&
            task.tenantId === principal.tenantId &&
            task.kind === 'video' &&
            task.provider === 'seedance' &&
            task.status === 'completed' &&
            task.metadata.shotId === shot.id &&
            typeof task.metadata.providerTaskId === 'string',
        ),
      }))
      return { project, shots, sources }
    })
  }

  findById(taskId: string, principal: Principal): GenerationTask | null {
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

  async clearCompleted(projectId: string, principal: Principal): Promise<number> {
    return this.store.mutate((state) => {
      const now = new Date().toISOString()
      const terminalTasks = state.tasks.filter(
        (task) =>
          task.projectId === projectId &&
          task.userId === principal.userId &&
          (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
          typeof task.metadata.queueHiddenAt !== 'string',
      )
      terminalTasks.forEach((task) => {
        task.metadata = { ...task.metadata, queueHiddenAt: now }
      })
      return terminalTasks.length
    })
  }

  async pause(
    taskId: string,
    principal: Principal,
  ): Promise<{
    outcome: 'not_found' | 'paused' | 'already_paused' | 'not_pausable'
    task: GenerationTask | null
  }> {
    return this.store.mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null }
      if (task.status === 'paused') return { outcome: 'already_paused' as const, task }
      if (task.status !== 'queued' || typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'not_pausable' as const, task }
      }
      const now = new Date().toISOString()
      task.status = 'paused'
      task.metadata = { ...task.metadata, pausedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'paused' as const, task }
    })
  }

  async resume(
    taskId: string,
    principal: Principal,
  ): Promise<{ outcome: 'not_found' | 'resumed' | 'not_resumable'; task: GenerationTask | null }> {
    return this.store.mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null }
      if (task.status !== 'paused' || typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'not_resumable' as const, task }
      }
      const now = new Date().toISOString()
      const { pausedAt: _pausedAt, ...metadata } = task.metadata
      task.status = 'queued'
      task.progress = 0
      task.error = null
      task.metadata = { ...metadata, resumedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'resumed' as const, task }
    })
  }

  async deleteFromQueue(
    taskId: string,
    principal: Principal,
  ): Promise<{
    outcome: 'not_found' | 'deleted' | 'already_deleted' | 'not_deletable'
    task: GenerationTask | null
    refund: boolean
  }> {
    return this.store.mutate((state) => {
      const task = findControlledTask(state.tasks, taskId, principal)
      if (!task) return { outcome: 'not_found' as const, task: null, refund: false }
      if (typeof task.metadata.queueHiddenAt === 'string') {
        return { outcome: 'already_deleted' as const, task, refund: false }
      }
      if (task.status === 'running') {
        const now = new Date().toISOString()
        const lock = cancellationResourceLockForTask(task)
        task.status = 'cancelled'
        task.progress = 100
        task.error = null
        task.metadata = {
          ...task.metadata,
          cancelResourceLockKind: lock.kind,
          cancelResourceLockKey: lock.key,
          providerCancelRequestedAt: now,
          cancelledAt: now,
          deletedAt: now,
          queueHiddenAt: now,
        }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        return { outcome: 'deleted' as const, task, refund: false }
      }
      const now = new Date().toISOString()
      const refund = task.status === 'queued' || task.status === 'paused'
      if (task.status === 'queued') {
        task.status = 'paused'
        task.progress = 0
        task.metadata = { ...task.metadata, pausedAt: now }
      }
      task.metadata = { ...task.metadata, queueHiddenAt: now, deletedAt: now }
      releaseGenerationTaskLease(task)
      task.updatedAt = now
      return { outcome: 'deleted' as const, task, refund }
    })
  }

  async cancelRunning(taskId: string, principal: Principal): Promise<GenerationTask | null> {
    return this.deleteFromQueue(taskId, principal).then((result) => result.task)
  }
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function buildQueuedGenerationTask(
  input: CreateGenerationTask,
  principal: Principal,
  now: string,
): GenerationTask {
  return normalizeGenerationTaskLifecycle({
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
    tier: input.tier ?? null,
    metadata: input.metadata ?? {},
    status: 'queued',
    progress: 0,
    estimatedCredits: input.estimatedCredits,
    maxAttempts: input.maxAttempts,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  })
}

function findControlledTask(
  tasks: GenerationTask[],
  taskId: string,
  principal: Principal,
): GenerationTask | undefined {
  const canControlAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
  return tasks.find(
    (task) =>
      task.id === taskId &&
      task.tenantId === principal.tenantId &&
      (canControlAll || task.userId === principal.userId),
  )
}
