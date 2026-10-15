import type { GenerationTask } from '@seqora/contracts'

export type TaskResourceLockKind =
  | 'video-shot'
  | 'video-chain'
  | 'character-asset-stage'
  | 'novel-summary-queue'
  | 'task'

export type TaskResourceLock = {
  kind: TaskResourceLockKind
  key: string
}

export function resourceLockForTask(task: GenerationTask): TaskResourceLock {
  const documentId = stringValue(task.metadata.documentId)
  const queueId = stringValue(task.metadata.queueId)
  if (documentId && queueId) {
    return resourceLock('novel-summary-queue', task, [documentId, queueId])
  }

  const assetId = stringValue(task.metadata.assetId)
  const assetKind = stringValue(task.metadata.assetKind)
  const stage = characterAssetStageFor(task)
  if (task.kind === 'image' && assetId && stage && (!assetKind || assetKind === 'character')) {
    return resourceLock('character-asset-stage', task, [assetId, stage])
  }

  const chainRoot = stringValue(task.metadata.chainRoot)
  const previousShotId = stringValue(task.metadata.previousShotId)
  if (task.kind === 'video' && (chainRoot || previousShotId)) {
    return resourceLock('video-chain', task, [chainRoot ? `root:${chainRoot}` : `previous:${previousShotId}`])
  }

  const shotId = stringValue(task.metadata.shotId)
  if (task.kind === 'video' && shotId) {
    return resourceLock('video-shot', task, [shotId])
  }

  return resourceLock('task', task, [task.id])
}

export function cancellationResourceLockForTask(task: GenerationTask): TaskResourceLock {
  const metadataKey = stringValue(task.metadata.cancelResourceLockKey)
  const metadataKind = taskResourceLockKindValue(task.metadata.cancelResourceLockKind)
  if (metadataKey && metadataKind) return { kind: metadataKind, key: metadataKey }
  const lock = resourceLockForTask(task)
  return { kind: metadataKind ?? lock.kind, key: metadataKey ?? lock.key }
}

export function cancellationResourceLockMetadataFor(task: GenerationTask): {
  cancelResourceLockKind: TaskResourceLockKind
  cancelResourceLockKey: string
} {
  const lock = cancellationResourceLockForTask(task)
  return {
    cancelResourceLockKind: lock.kind,
    cancelResourceLockKey: lock.key,
  }
}

function resourceLock(
  kind: TaskResourceLockKind,
  task: GenerationTask,
  parts: string[],
): TaskResourceLock {
  return {
    kind,
    key: [kind, task.tenantId, task.projectId, ...parts].join(':'),
  }
}

function characterAssetStageFor(task: GenerationTask): string | null {
  const stage = stringValue(task.metadata.generationStage)
  if (stage === 'face' || stage === 'body' || stage === 'turnaround') return stage
  return task.metadata.turnaround === true ? 'turnaround' : null
}

function taskResourceLockKindValue(value: unknown): TaskResourceLockKind | null {
  if (
    value === 'video-shot' ||
    value === 'video-chain' ||
    value === 'character-asset-stage' ||
    value === 'novel-summary-queue' ||
    value === 'task'
  ) {
    return value
  }
  return null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
