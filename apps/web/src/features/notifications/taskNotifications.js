export const ACTIVE_TASK_STATUSES = new Set(['queued', 'paused', 'running'])
export const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed'])

export function createTaskNotification(task, projects, read) {
  const projectName = projects.find((item) => item.id === task.projectId)?.name || '项目'
  const status = task.status === 'failed' ? 'failed' : 'completed'
  const isTrustedPortraitTask = task.metadata?.generationStage === 'trusted-portrait'
  return {
    id: task.id,
    task,
    projectId: task.projectId,
    projectName,
    label: task.label,
    status,
    title: status === 'failed' ? (isTrustedPortraitTask ? '人像资源创建失败' : '生成失败') : '生成完成',
    message: status === 'failed' ? task.error || '任务执行失败，请查看详情后重试。' : '生成结果已经保存。',
    target: isTrustedPortraitTask ? 'assets' : task.kind === 'text' ? 'script' : 'generate',
    updatedAt: task.updatedAt,
    read,
  }
}

export function reconcileTaskNotifications({
  recentTasks,
  projects,
  previousStatuses,
  currentNotifications,
  dismissedIds,
  historyReady,
  now = Date.now(),
}) {
  const nextStatuses = {}
  const recentIds = new Set(recentTasks.map((task) => task.id))
  const newlyFinished = []

  for (const task of recentTasks) {
    nextStatuses[task.id] = task.status
    const previousStatus = previousStatuses[task.id]
    const changedFromActive =
      ACTIVE_TASK_STATUSES.has(previousStatus) && TERMINAL_TASK_STATUSES.has(task.status)
    const justCompletedUnseen =
      historyReady &&
      !previousStatus &&
      TERMINAL_TASK_STATUSES.has(task.status) &&
      now - Date.parse(task.updatedAt) < 60_000
    if (changedFromActive || justCompletedUnseen) newlyFinished.push(task)
  }

  const byId = new Map(
    currentNotifications
      .filter((item) => recentIds.has(item.id) && !dismissedIds.has(item.id))
      .map((item) => [item.id, item]),
  )
  for (const task of recentTasks.filter((item) => TERMINAL_TASK_STATUSES.has(item.status)).slice(0, 30)) {
    if (dismissedIds.has(task.id)) continue
    const existing = byId.get(task.id)
    const isNew = newlyFinished.some((item) => item.id === task.id)
    byId.set(task.id, createTaskNotification(task, projects, isNew ? false : (existing?.read ?? true)))
  }

  return {
    nextStatuses,
    notifications: [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    popups: newlyFinished
      .filter((task) => !dismissedIds.has(task.id))
      .map((task) => ({ ...createTaskNotification(task, projects, false), expiresAt: now + 15_000 })),
  }
}

export function retryTaskInput(task) {
  const {
    providerName: _providerName,
    providerState: _providerState,
    providerTaskId: _providerTaskId,
    providerPolledAt: _providerPolledAt,
    providerPollErrors: _providerPollErrors,
    generatedOutputs: _generatedOutputs,
    queueHiddenAt: _queueHiddenAt,
    completedAt: _completedAt,
    failedAt: _failedAt,
    textResult: _textResult,
    ...metadata
  } = task.metadata || {}
  return {
    clientRequestId: crypto.randomUUID(),
    projectId: task.projectId,
    kind: task.kind,
    label: task.label,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    provider: task.provider,
    model: task.model || undefined,
    estimatedCredits: task.estimatedCredits,
    maxAttempts: task.maxAttempts,
    metadata,
  }
}
