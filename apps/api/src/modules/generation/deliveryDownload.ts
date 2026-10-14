import {
  deliveryContractSchema,
  deliveryDownloadReceiptSchema,
  type DeliveryContract,
  type DeliveryDownloadRequest,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { verifyFrozenDeliveryContract } from './deliveryContractFreeze.js'
import { deliveryTaskFingerprint } from './deliveryDownloadRepository.js'
import { assertDownloadActive, captureDeliveryMedia } from './deliveryDownloadStorage.js'
import { evaluateDeliveryGate } from './deliveryGate.js'
import { buildDeliveryVerificationSnapshot } from './deliveryVerification.js'
import type { GenerationTaskRepository } from './repository.js'

// Bounds retained snapshots through response completion, including slow clients.
let activeDownloads = 0
const MAX_DOWNLOADS = 2

export async function prepareDeliveryDownload(
  repository: GenerationTaskRepository,
  storage: ObjectStorage | null,
  taskId: string,
  input: DeliveryDownloadRequest,
  principal: Principal,
  signal?: AbortSignal,
) {
  const task = await repository.findById(taskId, principal)
  if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权正式下载')
  assertDownloadActive(signal)
  const parsed = deliveryContractSchema.safeParse(task.metadata.deliveryContract)
  if (
    !parsed.success ||
    !verifyFrozenDeliveryContract(parsed.data) ||
    parsed.data.contractHash !== input.contractHash
  )
    throw new AppError(409, 'DELIVERY_CONTRACT_STALE', '冻结合同不存在或已变化，请重新核验')
  assertSingleMediaScope(task, parsed.data)
  assertRequestedVersion(task, input, principal)
  if (task.status !== 'completed')
    throw new AppError(409, 'DELIVERY_GATE_BLOCKED', '任务未完成，正式下载未放行')
  if (activeDownloads >= MAX_DOWNLOADS)
    throw new AppError(429, 'DELIVERY_DOWNLOAD_BUSY', '正式下载核验繁忙，请稍后重试')
  activeDownloads += 1
  let released = false
  const release = () => {
    if (!released) {
      released = true
      activeDownloads -= 1
    }
  }
  try {
    const sourceFingerprint = deliveryTaskFingerprint(task)
    const captured = await captureDeliveryMedia(task, storage, signal)
    const checkedAt = new Date().toISOString()
    const snapshot = await buildDeliveryVerificationSnapshot(task, captured.snapshotStorage, checkedAt)
    const gate = evaluateDeliveryGate({ task, ...snapshot, verifiedAt: checkedAt })
    if (!gate.allowed) throw new AppError(409, 'DELIVERY_GATE_BLOCKED', gate.rationale)
    assertDownloadActive(signal)
    const receipt = await repository.deliveryDownloads.authorize(
      taskId,
      principal,
      task.updatedAt,
      {
        clientRequestId: input.clientRequestId,
        sourceTaskUpdatedAt: input.expectedUpdatedAt,
        contractHash: input.contractHash,
        contentType: deliveryDownloadReceiptSchema.shape.contentType.parse(captured.descriptor.contentType),
        size: captured.content.length,
        sha256: captured.descriptor.sha256,
        snapshot,
        gate,
        sourceFingerprint,
      },
      signal,
    )
    const extension = {
      'video/mp4': 'mp4',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }[receipt.contentType]
    return { content: captured.content, receipt, fileName: `seqora-${task.id}.${extension}`, release }
  } catch (error) {
    release()
    throw error
  }
}

function assertRequestedVersion(task: GenerationTask, input: DeliveryDownloadRequest, principal: Principal) {
  if (task.updatedAt === input.expectedUpdatedAt) return
  const history = Array.isArray(task.metadata.deliveryDownloads) ? task.metadata.deliveryDownloads : []
  const retry = history.some((raw) => {
    const parsed = deliveryDownloadReceiptSchema.safeParse(raw)
    if (!parsed.success) return false
    const receipt = parsed.data
    return (
      receipt.actorUserId === principal.userId &&
      receipt.clientRequestId === input.clientRequestId &&
      receipt.sourceTaskUpdatedAt === input.expectedUpdatedAt &&
      receipt.recordedTaskUpdatedAt === task.updatedAt &&
      receipt.contractHash === input.contractHash
    )
  })
  if (!retry) throw new AppError(409, 'DELIVERY_DOWNLOAD_STALE', '任务或验收已变化，请重新核验后下载')
}

function assertSingleMediaScope(task: GenerationTask, contract: DeliveryContract) {
  const shotId = typeof task.metadata.shotId === 'string' ? task.metadata.shotId : null
  const episodeId =
    typeof task.metadata.episodeId === 'string'
      ? task.metadata.episodeId
      : typeof task.metadata.scriptEpisodeId === 'string'
        ? task.metadata.scriptEpisodeId
        : null
  const shotsMatch = shotId
    ? contract.intent.shotIds.length === 1 && contract.intent.shotIds[0] === shotId
    : contract.intent.shotIds.length === 0
  // Older freeze UI used response mode for standalone videos; the one-media scope still applies.
  const legacySingleVideo =
    task.kind === 'video' && !shotId && !episodeId && contract.intent.mode === 'response'
  if (
    !['image', 'video'].includes(task.kind) ||
    task.provider === 'local-compose' ||
    contract.expectedArtifact.type !== task.kind ||
    contract.expectedArtifact.count !== 1 ||
    (!legacySingleVideo && contract.intent.mode !== (task.kind === 'video' ? 'shot' : 'asset')) ||
    contract.intent.projectId !== task.projectId ||
    contract.intent.episodeId !== episodeId ||
    !shotsMatch
  )
    throw new AppError(
      409,
      'DELIVERY_SCOPE_UNSUPPORTED',
      '正式下载仅支持范围匹配的单任务主媒体，整集与批量交付尚未开放',
    )
}
