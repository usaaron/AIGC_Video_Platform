import type { Principal } from '@seqora/contracts'
import type { CreditLedger } from './creditLedger.js'
import type { BillingLedgerRepository } from './repository.js'
import type { AppStore } from '../../infra/store.js'
import { AppError } from '../../core/errors.js'
type ScriptBillingMode = 'direct' | 'prepaid'

export async function reserveRecoverable(
  ledger: Pick<CreditLedger, 'reserve'>,
  repository: BillingLedgerRepository | null,
  store: AppStore | null,
  principal: Principal,
  credits: number,
  referenceId: string,
  description: string,
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const reference = attempt ? `${referenceId}:retry:${attempt}` : referenceId
    const refundId = `refund-${reference}`
    const refunded = repository
      ? await repository.hasEntryId(refundId, principal.userId, principal.tenantId)
      : store!.read((state) =>
          state.ledger.some(
            (entry) =>
              entry.id === refundId &&
              entry.userId === principal.userId &&
              entry.tenantId === principal.tenantId,
          ),
        )
    if (refunded) continue
    await ledger.reserve(principal, credits, reference, description)
    return reference
  }
  throw new AppError(409, 'EPISODE_RETRY_LIMIT', '本集重试次数过多，请重新确认分集计划')
}

export async function runBillableScriptOperation<T>(
  creditLedger: CreditLedger | null,
  principal: Principal,
  referenceId: string,
  credits: number,
  description: string,
  operation: () => Promise<T>,
  billingMode: ScriptBillingMode = 'direct',
  recoverable = false,
  refundGuard?: (() => Promise<void>) | undefined,
): Promise<T> {
  if (!creditLedger || billingMode === 'prepaid') return operation()
  const recoveredReference =
    recoverable && creditLedger.reserveRecoverable
      ? await creditLedger.reserveRecoverable(principal, credits, referenceId, description)
      : null
  if (recoveredReference) referenceId = recoveredReference
  const reserved =
    recoveredReference || (await creditLedger.reserve(principal, credits, referenceId, description))
  if (!reserved) {
    throw new AppError(409, 'DUPLICATE_REQUEST', '该请求已处理，请勿重复提交')
  }
  try {
    return await operation()
  } catch (error) {
    try {
      await refundGuard?.()
    } catch (guardError) {
      if (guardError instanceof AppError && guardError.code === 'TASK_LEASE_LOST') throw error
    }
    await creditLedger.refundReservation(principal, referenceId, `${description} · 失败退款`)
    throw error
  }
}
