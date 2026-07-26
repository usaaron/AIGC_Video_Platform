import type { GenerationTask } from '@seqora/contracts'

export type TaskResourceLockKind =
  'video-shot' | 'video-chain' | 'character-asset-stage' | 'novel-summary-queue' | 'task'

export type TaskResourceLock = {
  kind: TaskResourceLockKind
  key: string
}

export function cancellationResourceLockForTask(task: GenerationTask): TaskResourceLock {
  if (task.kind === 'video') {
    const chainRoot =
      metadataString(task.metadata, 'chainRoot') ?? metadataString(task.metadata, 'chainRootShotId')
    if (chainRoot) return { kind: 'video-chain', key: `chainRoot:${chainRoot}` }

    const previousShotId =
      metadataString(task.metadata, 'previousShotId') ??
      metadataString(task.metadata, 'continuitySourceTaskId')
    if (previousShotId) return { kind: 'video-chain', key: `previousShotId:${previousShotId}` }

    const shotId = metadataString(task.metadata, 'shotId')
    if (shotId) return { kind: 'video-shot', key: `shotId:${shotId}` }
  }

  if (task.kind === 'image') {
    const assetId = metadataString(task.metadata, 'assetId')
    if (assetId) {
      const stage = metadataString(task.metadata, 'stage') ?? metadataString(task.metadata, 'generationStage')
      if (stage) return { kind: 'character-asset-stage', key: `assetId:${assetId}|stage:${stage}` }
    }
  }

  return { kind: 'task', key: `taskId:${task.id}` }
}

export function novelSummaryQueueResourceLock(documentId: string, queueId: string): TaskResourceLock {
  return { kind: 'novel-summary-queue', key: `documentId:${documentId}|queueId:${queueId}` }
}

export function taskResourceLockId(lock: TaskResourceLock): string {
  return `${lock.kind}:${lock.key}`
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
