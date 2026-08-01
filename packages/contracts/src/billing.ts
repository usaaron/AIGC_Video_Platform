import { z } from 'zod'
import { planSchema } from './account.js'

export const SCRIPT_OPERATION_CREDITS = {
  generate: 3,
  enrich: 5,
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
export const billingCheckoutTypeSchema = z.enum(['subscription', 'credits'])
export const billingPaymentProviderSchema = z.enum(['stripe'])
export const billingPaymentConfigurationSchema = z.object({
  provider: billingPaymentProviderSchema.nullable(),
  enabled: z.boolean(),
  memberSubscriptionEnabled: z.boolean(),
  creditPurchaseEnabled: z.boolean(),
  creditPackCredits: z.number().int().positive().nullable(),
})
export const billingCheckoutSessionSchema = z.object({
  provider: billingPaymentProviderSchema,
  checkoutType: billingCheckoutTypeSchema,
  checkoutSessionId: z.string().min(1),
  url: z.string().url(),
  status: z.enum(['open', 'completed', 'expired', 'cancelled', 'refunded']),
  plan: planSchema.nullable(),
  credits: z.number().int().positive().nullable(),
})
export const createCreditCheckoutSchema = z.object({
  credits: z.number().int().positive().max(1_000_000).optional(),
})
export const billingReconciliationAlertStatusSchema = z.enum(['open', 'acknowledged', 'resolved'])
export const billingReconciliationAlertSeveritySchema = z.enum(['warning', 'critical'])
export const billingReconciliationAlertSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  providerEventId: z.string().min(1),
  eventType: z.string().min(1),
  paymentSessionId: z.string().min(1).nullable(),
  reconciliationItemId: z.string().min(1).nullable(),
  tenantId: z.string().min(1).nullable(),
  organizationId: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  membershipId: z.string().min(1).nullable(),
  alertType: z.string().min(1),
  severity: billingReconciliationAlertSeveritySchema,
  status: billingReconciliationAlertStatusSchema,
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  notifiedAt: z.string().datetime().nullable(),
  acknowledgedByUserId: z.string().min(1).nullable(),
  acknowledgedAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export const billingReconciliationAlertListSchema = z.object({
  items: z.array(billingReconciliationAlertSchema),
  meta: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
})
export const billingWebhookEventTypeSchema = z.enum([
  'subscription.activated',
  'subscription.renewed',
  'subscription.cancelled',
  'subscription.expired',
  'credits.purchased',
  'payment.refunded',
])
export const billingWebhookEventSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    type: billingWebhookEventTypeSchema,
    membershipId: z.string().min(1).max(512).optional(),
    tenantId: z.string().min(1).max(256).optional(),
    userId: z.string().min(1).max(256).optional(),
    plan: planSchema.optional(),
    credits: z.coerce.number().int().positive().max(1_000_000).optional(),
    referenceId: z.string().min(1).max(300).optional(),
    description: z.string().min(1).max(200).optional(),
    occurredAt: z.string().datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((input, context) => {
    if (!input.membershipId && (!input.tenantId || !input.userId)) {
      context.addIssue({
        code: 'custom',
        path: ['membershipId'],
        message: 'membershipId or tenantId + userId is required',
      })
    }
    if (
      (input.type === 'credits.purchased' || input.type === 'payment.refunded') &&
      input.credits === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['credits'],
        message: 'credits is required for credit purchase and refund events',
      })
    }
  })
export const adminGrantCreditsSchema = z.object({
  amount: z.coerce.number().int().positive().max(1_000_000),
  reason: z.string().min(1).max(200),
})
export const adminAdjustCreditsSchema = z.object({
  amount: z.coerce
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((amount) => amount !== 0, { message: 'Adjustment amount cannot be zero' }),
  reason: z.string().min(1).max(200),
})

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>
export type MonthlyUsage = z.infer<typeof monthlyUsageSchema>
export type BillingSummary = z.infer<typeof billingSummarySchema>
export type BillingCheckoutType = z.infer<typeof billingCheckoutTypeSchema>
export type BillingPaymentProvider = z.infer<typeof billingPaymentProviderSchema>
export type BillingPaymentConfiguration = z.infer<typeof billingPaymentConfigurationSchema>
export type BillingCheckoutSession = z.infer<typeof billingCheckoutSessionSchema>
export type CreateCreditCheckoutInput = z.infer<typeof createCreditCheckoutSchema>
export type BillingReconciliationAlertStatus = z.infer<typeof billingReconciliationAlertStatusSchema>
export type BillingReconciliationAlertSeverity = z.infer<typeof billingReconciliationAlertSeveritySchema>
export type BillingReconciliationAlert = z.infer<typeof billingReconciliationAlertSchema>
export type BillingReconciliationAlertList = z.infer<typeof billingReconciliationAlertListSchema>
export type BillingWebhookEvent = z.infer<typeof billingWebhookEventSchema>
export type BillingWebhookEventType = z.infer<typeof billingWebhookEventTypeSchema>
export type AdminGrantCreditsInput = z.infer<typeof adminGrantCreditsSchema>
export type AdminAdjustCreditsInput = z.infer<typeof adminAdjustCreditsSchema>
