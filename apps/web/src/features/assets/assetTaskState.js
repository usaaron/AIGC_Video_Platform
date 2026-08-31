const ACTIVE_TASK_STATUSES = new Set(['queued', 'paused', 'running'])

export function activeAssetImageTask(asset, tasks = []) {
  return tasks
    .filter(
      (task) =>
        task.metadata?.assetId === asset.id &&
        task.kind === 'image' &&
        ACTIVE_TASK_STATUSES.has(task.status) &&
        task.metadata?.generationStage !== 'trusted-portrait',
    )
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))[0]
}

export function characterAssetStatus(asset) {
  if (asset.attributes?.trustedPortrait?.status === 'active') return '可信人像可用'
  if (asset.attributes?.trustedPortrait?.status === 'processing') return '人像同步中'
  if (asset.attributes?.faceStatus !== 'approved') return '待确认面部'
  if (asset.attributes?.bodyStatus !== 'approved') return '面部已确认'
  return '全身已确认'
}

function taskTimestamp(task) {
  const value = Date.parse(task.updatedAt || task.createdAt || '')
  return Number.isFinite(value) ? value : 0
}
