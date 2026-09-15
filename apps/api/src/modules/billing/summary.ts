import type {
  LedgerEntry,
  Plan,
  BillingScope,
  OrganizationBillingPool,
  BillingSummary,
} from '@seqora/contracts'
export const monthlyGrantCredits = 500

export function buildSummaryFromEntries(
  entries: readonly LedgerEntry[],
  plan: Plan,
  credits: number,
  planSelfServiceEnabled: boolean,
  options: {
    billingScope?: BillingScope
    organizationPool?: OrganizationBillingPool
  } = {},
): BillingSummary {
  const periodStart = startOfChinaMonth()
  const orderedEntries = orderLedgerEntries(entries)
  const monthlyEntries = orderedEntries.filter((entry) => entry.createdAt >= periodStart)
  const generationEntries = monthlyEntries.filter((entry) => entry.type === 'generation' && entry.amount < 0)
  const consumedCredits = generationEntries.reduce((total, entry) => total - entry.amount, 0)
  const refundedCredits = monthlyEntries
    .filter((entry) => entry.type === 'adjustment' && entry.amount > 0 && entry.id.startsWith('refund-'))
    .reduce((total, entry) => total + entry.amount, 0)

  return {
    plan,
    credits,
    billingScope: options.billingScope ?? 'membership',
    ...(options.organizationPool ? { organizationPool: options.organizationPool } : {}),
    concurrency: plan === 'member' ? 3 : 1,
    unlimitedConcurrency: false,
    planSelfServiceEnabled,
    monthlyUsage: {
      periodStart,
      consumedCredits,
      refundedCredits,
      netCredits: Math.max(0, consumedCredits - refundedCredits),
      generationCount: generationEntries.length,
      includedCredits:
        options.billingScope === 'organization' ? 0 : plan === 'member' ? monthlyGrantCredits : 0,
    },
    entries: orderedEntries.slice(0, 30),
  }
}

export function orderLedgerEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((left, right) => {
    const createdAtOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    if (createdAtOrder !== 0) return createdAtOrder
    return right.id.localeCompare(left.id)
  })
}

export function startOfChinaMonth(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs,
  ).toISOString()
}
