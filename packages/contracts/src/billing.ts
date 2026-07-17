import { z } from 'zod'
import { planSchema } from './account.js'

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

export const billingSummarySchema = z.object({
  plan: planSchema,
  credits: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  entries: z.array(ledgerEntrySchema),
})

export const updatePlanSchema = z.object({ plan: planSchema })

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>
export type BillingSummary = z.infer<typeof billingSummarySchema>
