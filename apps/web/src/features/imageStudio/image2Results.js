export function groupImage2Batches(tasks, projectId) {
  const groups = new Map()
  for (const task of tasks) {
    const batchId = typeof task.metadata?.image2BatchId === 'string' ? task.metadata.image2BatchId : null
    if (!batchId || task.projectId !== projectId || typeof task.metadata?.queueHiddenAt === 'string') continue
    if (!groups.has(batchId)) groups.set(batchId, [])
    groups.get(batchId).push(task)
  }
  const batches = [...groups.entries()]
    .map(([batchId, batchTasks]) => summarizeBatch(batchId, batchTasks))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  const labelsByBatchId = createBatchLabelsByDay(batches)
  return batches.map((batch) => ({
    ...batch,
    label: labelsByBatchId.get(batch.batchId) || '生成记录',
  }))
}

export function mergeImage2Tasks(liveTasks, cachedResults, projectId) {
  const tasksById = new Map()
  for (const result of cachedResults) {
    if (result.projectId !== projectId) continue
    const task = cachedTask(result)
    if (task) tasksById.set(task.id, task)
  }
  for (const task of liveTasks) {
    if (task.projectId === projectId) tasksById.set(task.id, task)
  }
  return [...tasksById.values()]
}

export function image2ResultCacheRecords(tasks, projectId) {
  return tasks.flatMap((task, index) => {
    const batchId = typeof task.metadata?.image2BatchId === 'string' ? task.metadata.image2BatchId : null
    const url = imageUrlForTask(task)
    if (!batchId || task.projectId !== projectId || task.status !== 'completed' || !url) return []
    const batchIndex = positiveInteger(task.metadata?.batchIndex) || index + 1
    return [
      {
        id: task.id,
        projectId,
        batchId,
        url,
        alt: `生图大师结果 ${batchIndex}`,
        fileName: `生图大师-结果-${batchIndex}.png`,
        savedAt: Date.parse(task.updatedAt) || Date.now(),
        task: taskSnapshot(task, url),
      },
    ]
  })
}

export function imageUrlForTask(task) {
  return task.outputs?.find((output) => output.mediaType === 'image')?.url || task.resultUrl || ''
}

function summarizeBatch(batchId, tasks) {
  const sortedTasks = [...tasks].sort((left, right) => {
    const leftIndex = Number(left.metadata?.batchIndex ?? 0)
    const rightIndex = Number(right.metadata?.batchIndex ?? 0)
    return leftIndex - rightIndex
  })
  const latest = sortedTasks.reduce((current, task) =>
    Date.parse(task.updatedAt) > Date.parse(current.updatedAt) ? task : current,
  )
  const prompt = batchPromptFromTasks(sortedTasks, latest)
  const originalPrompt = batchOriginalPromptFromTasks(sortedTasks, latest)
  const totalCount = Number(sortedTasks[0]?.metadata?.batchSize ?? sortedTasks.length)
  const completedCount = sortedTasks.filter((task) => task.status === 'completed').length
  const runningCount = sortedTasks.filter((task) => task.status === 'running').length
  const queuedCount = sortedTasks.filter(
    (task) => task.status === 'queued' || task.status === 'paused',
  ).length
  const failedCount = sortedTasks.filter(
    (task) => task.status === 'failed' || task.status === 'cancelled',
  ).length
  return {
    batchId,
    tasks: sortedTasks,
    label: '生成记录',
    prompt,
    originalPrompt,
    totalCount,
    completedCount,
    runningCount,
    queuedCount,
    failedCount,
    estimatedCredits: sortedTasks.reduce((total, task) => total + (task.estimatedCredits || 0), 0),
    updatedAt: latest.updatedAt,
  }
}

function batchPromptFromTasks(tasks, fallbackTask) {
  for (const task of tasks) {
    const snapshotPrompt = cleanText(task?.metadata?.generationSnapshot?.prompt)
    if (snapshotPrompt) return snapshotPrompt
  }
  for (const task of tasks) {
    const prompt = cleanText(task?.prompt)
    if (prompt) return prompt
  }
  return cleanText(fallbackTask?.metadata?.originalPrompt) || cleanText(fallbackTask?.prompt)
}

function batchOriginalPromptFromTasks(tasks, fallbackTask) {
  for (const task of tasks) {
    const originalPrompt = cleanText(task?.metadata?.generationSnapshot?.originalPrompt)
    if (originalPrompt) return originalPrompt
  }
  for (const task of tasks) {
    const originalPrompt = cleanText(task?.metadata?.originalPrompt)
    if (originalPrompt) return originalPrompt
  }
  return cleanText(fallbackTask?.metadata?.originalPrompt) || cleanText(fallbackTask?.prompt)
}

function cachedTask(result) {
  if (!result.task || typeof result.task !== 'object') return null
  const url = result.cachedUrl || result.url
  const outputs = Array.isArray(result.task.outputs)
    ? result.task.outputs.map((output) => (output?.mediaType === 'image' ? { ...output, url } : output))
    : []
  return {
    ...result.task,
    id: result.id,
    projectId: result.projectId,
    status: 'completed',
    progress: 100,
    resultUrl: url,
    outputs: outputs.length
      ? outputs
      : [{ id: `${result.id}-cached`, url, mediaType: 'image', view: 'single' }],
  }
}

function taskSnapshot(task, url) {
  return {
    id: task.id,
    projectId: task.projectId,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    metadata: task.metadata,
    status: 'completed',
    progress: 100,
    estimatedCredits: task.estimatedCredits,
    updatedAt: task.updatedAt,
    resultUrl: url,
    outputs: task.outputs,
  }
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function createBatchLabelsByDay(batches) {
  const labelsByBatchId = new Map()
  const batchesByDay = new Map()
  for (const batch of batches) {
    const dayKey = dayKeyForTimestamp(batch.updatedAt)
    if (!batchesByDay.has(dayKey)) batchesByDay.set(dayKey, [])
    batchesByDay.get(dayKey).push(batch)
  }

  for (const dayBatches of batchesByDay.values()) {
    dayBatches
      .slice()
      .sort((left, right) => {
        const leftUpdatedAt = Date.parse(left.updatedAt) || 0
        const rightUpdatedAt = Date.parse(right.updatedAt) || 0
        if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt - rightUpdatedAt
        return left.batchId.localeCompare(right.batchId)
      })
      .forEach((batch, index) => {
        labelsByBatchId.set(batch.batchId, `第 ${index + 1} 次生成`)
      })
  }

  return labelsByBatchId
}

function dayKeyForTimestamp(value) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'invalid-date'
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
