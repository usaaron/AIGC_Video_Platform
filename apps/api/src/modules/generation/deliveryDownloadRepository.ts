import { createHash, randomUUID } from 'node:crypto'
import {
  deliveryDownloadReceiptSchema,
  type DeliveryDownloadReceipt,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { insertAuditLog } from '../../core/audit/auditLog.js'
import { AppError } from '../../core/errors.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import { verifyFrozenDeliveryContract } from './deliveryContractFreeze.js'
import { evaluateDeliveryGate } from './deliveryGate.js'
import { findControlledTaskInDatabase, updateGenerationTaskLifecycle } from './taskLifecyclePersistence.js'
import { findControlledTask } from './taskStateHelpers.js'

export type DeliveryDownloadDraft = Pick<
  DeliveryDownloadReceipt,
  | 'clientRequestId'
  | 'sourceTaskUpdatedAt'
  | 'contractHash'
  | 'contentType'
  | 'size'
  | 'sha256'
  | 'snapshot'
  | 'gate'
> & { sourceFingerprint: string }

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  return value
}

/** Excludes only the receipt write itself; all review, media and task facts remain bound. */
export function deliveryTaskFingerprint(task: GenerationTask): string {
  const { updatedAt: _updatedAt, metadata, ...fields } = task
  const { deliveryDownloads: _downloads, ...sourceMetadata } = metadata
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ ...fields, metadata: sourceMetadata })))
    .digest('hex')
}

function conflict(code: string, message: string): never {
  throw new AppError(409, code, message)
}

function receiptsFor(task: GenerationTask): DeliveryDownloadReceipt[] {
  const history = task.metadata.deliveryDownloads
  if (history === undefined) return []
  if (!Array.isArray(history) || history.length > 50)
    conflict('DELIVERY_DOWNLOAD_HISTORY_INVALID', '下载授权记录无效，请联系管理员')
  return history.map((value: unknown) => {
    const receipt = deliveryDownloadReceiptSchema.safeParse(value)
    if (!receipt.success) conflict('DELIVERY_DOWNLOAD_HISTORY_INVALID', '下载授权记录无效，请联系管理员')
    return receipt.data
  })
}

function assertVerifiedDraft(task: GenerationTask, expectedUpdatedAt: string, draft: DeliveryDownloadDraft) {
  if (deliveryTaskFingerprint(task) !== draft.sourceFingerprint)
    conflict('DELIVERY_DOWNLOAD_STALE', '任务或验收内容已变化，请刷新后重新下载')
  const contract = draft.snapshot.contract
  const persisted = task.metadata.deliveryContract as { contractHash?: unknown } | undefined
  if (
    !verifyFrozenDeliveryContract(persisted) ||
    !verifyFrozenDeliveryContract(contract) ||
    persisted?.contractHash !== draft.contractHash ||
    contract?.contractHash !== draft.contractHash
  )
    conflict('DELIVERY_DOWNLOAD_CONTRACT_MISMATCH', '冻结合同已变化，请刷新后重新核验')
  if (
    draft.snapshot.taskId !== task.id ||
    !draft.snapshot.evidence.length ||
    draft.snapshot.evidence.some(
      ({ scope }) =>
        scope.tenantId !== task.tenantId ||
        scope.projectId !== task.projectId ||
        scope.taskId !== task.id ||
        scope.taskUpdatedAt !== expectedUpdatedAt,
    )
  )
    conflict('DELIVERY_DOWNLOAD_STALE', '下载证据与当前任务范围不一致')
  const media = draft.snapshot.evidence.find((item) => item.kind === 'asset')
  const proof = media?.details.storageProof as Record<string, unknown> | undefined
  if (
    media?.status !== 'passed' ||
    proof?.status !== 'passed' ||
    proof.contentType !== draft.contentType ||
    proof.expectedSize !== draft.size ||
    proof.actualSize !== draft.size ||
    proof.expectedSha256 !== draft.sha256 ||
    proof.actualSha256 !== draft.sha256
  )
    conflict('DELIVERY_DOWNLOAD_PROOF_MISMATCH', '文件与本次完整存储核验结果不一致')
  const gate = evaluateDeliveryGate({
    task,
    contract,
    evidence: draft.snapshot.evidence,
    verification: draft.snapshot.verification,
    verifiedAt: draft.gate.verifiedAt,
  })
  if (
    !gate.allowed ||
    !draft.gate.allowed ||
    draft.gate.status !== 'allowed' ||
    draft.gate.reasonCodes.length
  )
    conflict('DELIVERY_DOWNLOAD_BLOCKED', '当前证据尚未通过正式下载门禁')
}

/** Commits authorization and its audit before any verified bytes are sent. */
export class DeliveryDownloadRepository {
  constructor(
    private readonly store: AppStore | null,
    private readonly database: AccountDatabase | null = null,
    private readonly mirrorTask: (task: GenerationTask) => Promise<void> = async () => {},
  ) {}

  async authorize(
    taskId: string,
    principal: Principal,
    expectedCurrentUpdatedAt: string,
    draft: DeliveryDownloadDraft,
    signal?: AbortSignal,
  ): Promise<DeliveryDownloadReceipt> {
    const apply = (task: GenerationTask | null | undefined) => {
      if (signal?.aborted) throw new AppError(499, 'DELIVERY_DOWNLOAD_ABORTED', '下载请求已取消')
      if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权正式下载')
      const history = receiptsFor(task)
      const previous = history.find(
        (item) => item.actorUserId === principal.userId && item.clientRequestId === draft.clientRequestId,
      )
      assertVerifiedDraft(task, expectedCurrentUpdatedAt, draft)
      if (previous) {
        if (
          previous.sourceTaskUpdatedAt !== draft.sourceTaskUpdatedAt ||
          previous.contractHash !== draft.contractHash ||
          previous.sha256 !== draft.sha256 ||
          previous.contentType !== draft.contentType ||
          previous.size !== draft.size ||
          task.updatedAt !== previous.recordedTaskUpdatedAt ||
          ![previous.sourceTaskUpdatedAt, previous.recordedTaskUpdatedAt].includes(expectedCurrentUpdatedAt)
        )
          conflict('DELIVERY_DOWNLOAD_REQUEST_CONFLICT', '下载请求已使用或任务已变化，请刷新后重试')
        return { task, receipt: previous, created: false }
      }
      if (task.updatedAt !== expectedCurrentUpdatedAt || draft.sourceTaskUpdatedAt !== task.updatedAt)
        conflict('DELIVERY_DOWNLOAD_STALE', '任务版本已变化，请刷新后重新下载')
      if (history.length >= 50)
        conflict('DELIVERY_DOWNLOAD_HISTORY_LIMIT', '当前任务下载授权记录已达上限，请联系管理员')
      const now = new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString()
      const receipt = deliveryDownloadReceiptSchema.parse({
        ...draft,
        version: 'seqora.delivery-download.v1',
        id: randomUUID(),
        taskId: task.id,
        tenantId: task.tenantId,
        projectId: task.projectId,
        actorUserId: principal.userId,
        recordedTaskUpdatedAt: now,
        authorizedAt: now,
      })
      task.metadata = { ...task.metadata, deliveryDownloads: [...history, receipt] }
      task.updatedAt = now
      return { task, receipt, created: true }
    }
    if (this.database) {
      const result = await this.database.transaction(async (client) => {
        const result = apply(await findControlledTaskInDatabase(client, taskId, principal))
        if (!result.created) return result
        const saved = await updateGenerationTaskLifecycle(client, result.task)
        if (!saved) conflict('DELIVERY_DOWNLOAD_STALE', '下载授权写入冲突，请刷新后重试')
        await insertAuditLog(client, {
          tenantId: principal.tenantId,
          userId: result.task.userId,
          actorUserId: principal.userId,
          action: 'generation.delivery.download_authorized',
          resourceType: 'generation_task',
          resourceId: taskId,
          ipAddress: null,
          userAgent: null,
          metadata: {
            receiptId: result.receipt.id,
            clientRequestId: result.receipt.clientRequestId,
            sourceTaskUpdatedAt: result.receipt.sourceTaskUpdatedAt,
            recordedTaskUpdatedAt: result.receipt.recordedTaskUpdatedAt,
            contractHash: result.receipt.contractHash,
            contentType: result.receipt.contentType,
            size: result.receipt.size,
            sha256: result.receipt.sha256,
          },
        })
        return { ...result, task: saved }
      })
      await this.mirrorTask(result.task)
      return structuredClone(result.receipt)
    }
    if (!this.store) throw new Error('Delivery download persistence is unavailable')
    return this.store.mutate((state) => apply(findControlledTask(state.tasks, taskId, principal)).receipt)
  }
}
