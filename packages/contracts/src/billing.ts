import { z } from 'zod'
import { planSchema } from './account.js'

export const SCRIPT_OPERATION_CREDITS = {
  generate: 3,
  enrich: 5,
  review: 3,
} as const

export const NOVEL_OPERATION_CREDITS = {
  chapterSummaryBatch: 4,
  boundaryNotes: 2,
  storyBible: 6,
  chapterAdaptation: 4,
} as const

export const ledgerEntrySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  amount: z.number().int(),
  balance: z.number().int().nonnegative(),
  type: z.enum(['grant', 'generation', 'adjustment']),
  description: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
})

export const monthlyUsageSchema = z.object({
  periodStart: z.string().datetime(),
  consumedCredits: z.number().int().nonnegative(),
  refundedCredits: z.number().int().nonnegative(),
  netCredits: z.number().int().nonnegative(),
  generationCount: z.number().int().nonnegative(),
  includedCredits: z.number().int().nonnegative(),
})

export const billingSummarySchema = z.object({
  plan: planSchema,
  credits: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  planSelfServiceEnabled: z.boolean(),
  monthlyUsage: monthlyUsageSchema,
  entries: z.array(ledgerEntrySchema),
})

export const updatePlanSchema = z.object({ plan: planSchema })

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>
export type MonthlyUsage = z.infer<typeof monthlyUsageSchema>
export type BillingSummary = z.infer<typeof billingSummarySchema>
