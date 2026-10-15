import { textCompletionSnapshotSchema } from '@seqora/contracts'

const SCOPE_FIELDS = ['taskId', 'projectId', 'tenantId', 'taskStatus', 'taskUpdatedAt']
const TASK_STATUSES = ['queued', 'paused', 'running', 'completed', 'failed', 'cancelled']

function hasCompleteScope(scope) {
  return (
    scope !== null &&
    typeof scope === 'object' &&
    !Array.isArray(scope) &&
    Object.keys(scope).length === SCOPE_FIELDS.length &&
    SCOPE_FIELDS.every(
      (key) => Object.hasOwn(scope, key) && typeof scope[key] === 'string' && scope[key].trim().length > 0,
    ) &&
    TASK_STATUSES.includes(scope.taskStatus) &&
    Number.isFinite(Date.parse(scope.taskUpdatedAt))
  )
}

export function canInspectTextCompletion(job) {
  return (
    job?.kind === 'text' &&
    job.provider === 'text' &&
    typeof job.projectId === 'string' &&
    job.projectId.trim().length > 0 &&
    !job.projectId.startsWith('sm-standalone-')
  )
}

function taskScope(job) {
  return {
    taskId: job?.id,
    projectId: job?.projectId,
    tenantId: job?.tenantId,
    taskStatus: job?.status,
    taskUpdatedAt: job?.updatedAt,
  }
}

export function isTextCompletionDialogCurrent(dialog, jobs, projectId, tenantId) {
  if (
    !hasCompleteScope(dialog?.scope) ||
    !projectId ||
    !tenantId ||
    dialog.projectId !== projectId ||
    dialog.tenantId !== tenantId ||
    dialog.scope.projectId !== projectId ||
    dialog.scope.tenantId !== tenantId
  )
    return false
  const job = jobs.find((candidate) => candidate.id === dialog.scope.taskId)
  if (!canInspectTextCompletion(job) || typeof job.metadata?.queueHiddenAt === 'string') return false
  const current = taskScope(job)
  return SCOPE_FIELDS.every((key) => current[key] === dialog.scope[key])
}

export function parseTextCompletionSnapshot(value, scope) {
  const parsed = textCompletionSnapshotSchema.safeParse(value)
  if (!parsed.success) throw new Error('服务器返回的来源记录格式无效，未采信任何回执。')
  const snapshot = parsed.data
  if (!hasCompleteScope(scope) || SCOPE_FIELDS.some((key) => snapshot[key] !== scope[key])) {
    throw new Error('任务范围或版本已变化，未采信此来源记录。请关闭后重新打开。')
  }
  return snapshot
}

export function createTextCompletionInspection({ onState, timeoutMs = 15_000 }) {
  let active = null
  const cancel = () => {
    const previous = active
    active = null
    previous?.controller.abort()
  }
  return {
    cancel,
    async run({ job, projectId, tenantId, inspect }) {
      cancel()
      const controller = new AbortController()
      const request = {
        job: { id: job?.id, label: job?.label },
        scope: taskScope(job),
        projectId,
        tenantId,
        controller,
        status: 'loading',
        snapshot: null,
        error: '',
      }
      active = request
      onState(request)
      let timer
      let rejectAborted
      try {
        if (
          !canInspectTextCompletion(job) ||
          !hasCompleteScope(request.scope) ||
          !projectId ||
          !tenantId ||
          job.projectId !== projectId ||
          job.tenantId !== tenantId ||
          typeof job.metadata?.queueHiddenAt === 'string' ||
          typeof inspect !== 'function'
        ) {
          throw new Error('当前任务范围信息不完整，请刷新任务后重试。')
        }
        const aborted = new Promise((_, reject) => {
          rejectAborted = () => reject(new Error('来源查询已超时，请重试。'))
          controller.signal.addEventListener('abort', rejectAborted, { once: true })
        })
        timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
        const value = await Promise.race([inspect(job, { signal: controller.signal }), aborted])
        if (active !== request || controller.signal.aborted) return
        const snapshot = parseTextCompletionSnapshot(value, request.scope)
        onState({ ...request, status: 'ready', snapshot })
      } catch (error) {
        if (active === request) {
          onState({
            ...request,
            status: 'error',
            error: error?.message || '暂时无法读取文本来源，请重试。',
          })
        }
      } finally {
        globalThis.clearTimeout(timer)
        if (rejectAborted) controller.signal.removeEventListener('abort', rejectAborted)
      }
    },
  }
}
