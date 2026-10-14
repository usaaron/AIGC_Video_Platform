import { DELIVERY_REQUIREMENT_IDS, type DeliveryRequirement } from './delivery.js'

/** New Seedance video contracts require completion even when legacy metadata is incomplete. */
export function deliveryContractRequiresProviderCompletion(task: {
  kind?: string
  provider?: string
}): boolean {
  return task.kind === 'video' && task.provider === 'seedance'
}

/** Shared drafting text; the persisted contract is never silently rewritten to add this requirement. */
export const DELIVERY_PROVIDER_COMPLETION_REQUIREMENT = Object.freeze({
  id: DELIVERY_REQUIREMENT_IDS.providerCompleted,
  source: 'provider',
  statement: '必须具备服务端观察 Provider 完成并完整保存当前主视频的可信回执',
} satisfies DeliveryRequirement)
