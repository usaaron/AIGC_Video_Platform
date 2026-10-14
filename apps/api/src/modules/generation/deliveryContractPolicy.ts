import {
  deliveryContractRequiresProviderCompletion,
  DELIVERY_REQUIREMENT_IDS,
  type DeliveryContract,
  type GenerationTask,
} from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'

/** A conditional write rejection cannot become a successful freeze or a cache-only contract. */
export function requirePersistedDeliveryContract(task: GenerationTask | null): GenerationTask {
  if (!task) {
    throw new AppError(
      409,
      'DELIVERY_CONTRACT_WRITE_CONFLICT',
      '任务或交付证据状态已变化，合同未保存，请刷新任务后重试',
    )
  }
  return task
}

/** Applies only at the new-freeze boundary, after task authorization and version checks. */
export function assertNewDeliveryContractPolicy(task: GenerationTask, contract: DeliveryContract): void {
  if (
    deliveryContractRequiresProviderCompletion(task) &&
    !contract.must.some((requirement) => requirement.id === DELIVERY_REQUIREMENT_IDS.providerCompleted)
  ) {
    throw new AppError(
      400,
      'DELIVERY_PROVIDER_COMPLETION_REQUIRED',
      '新的 Seedance 视频或 Image2 图片交付合同必须包含 Provider 完成回执要求，请更新并重新审阅合同草稿',
    )
  }
}

export function freezeTaskDeliveryContract(
  task: GenerationTask | null | undefined,
  contract: DeliveryContract,
  expectedUpdatedAt: string,
): GenerationTask {
  if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权冻结合同')
  if (task.status === 'cancelled') {
    throw new AppError(409, 'DELIVERY_CONTRACT_NOT_FREEZABLE', '已取消任务不能冻结交付合同')
  }
  if (contract.intent.projectId !== task.projectId) {
    throw new AppError(409, 'DELIVERY_CONTRACT_SCOPE_MISMATCH', '交付合同必须属于当前项目')
  }
  if (task.updatedAt !== expectedUpdatedAt) {
    throw new AppError(409, 'DELIVERY_CONTRACT_STALE', '任务已变化，请刷新后重新冻结合同')
  }
  if (task.metadata.deliveryContract !== undefined) {
    throw new AppError(409, 'DELIVERY_CONTRACT_ALREADY_FROZEN', '当前任务已经冻结交付合同')
  }
  assertNewDeliveryContractPolicy(task, contract)
  const frozenAt = new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString()
  const frozen = freezeDeliveryContract(contract, frozenAt)
  task.metadata = { ...task.metadata, deliveryContract: frozen }
  task.updatedAt = frozenAt
  return task
}
