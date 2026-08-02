import type { Plan } from '@seqora/contracts'

export const DEMO_UNLIMITED_CONCURRENCY = 100

export function generationConcurrencyFor(plan: Plan, demoUnlimited = false): number {
  if (demoUnlimited) return DEMO_UNLIMITED_CONCURRENCY
  return plan === 'member' ? 3 : 1
}
