import {
  adminAdjustCreditsSchema,
  adminGrantCreditsSchema,
  PERMISSIONS,
  type AdminOverview,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { AppStore } from '../../infra/store.js'
import type { CreditLedger } from '../billing/creditLedger.js'

const billingMembershipParams = z.object({ membershipId: z.string().min(1).max(512) })

export async function registerAdminRoutes(
  app: FastifyInstance,
  store: AppStore,
  ledger: CreditLedger | null = null,
): Promise<void> {
  app.get(
    '/admin/overview',
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DASHBOARD_READ) },
    async () => {
      const today = startOfChinaDay()
      const creditsConsumedToday = ledger
        ? await ledger.consumedCreditsSince(today)
        : store.read((state) =>
            Math.abs(
              state.ledger
                .filter((entry) => entry.type === 'generation' && entry.createdAt >= today)
                .reduce((total, entry) => total + entry.amount, 0),
            ),
          )
      const overview: AdminOverview = {
        users: store.read((state) => state.users.length),
        activeTasks: store.read(
          (state) =>
            state.tasks.filter((task) => task.status === 'queued' || task.status === 'running').length,
        ),
        creditsConsumedToday,
        generatedAt: new Date().toISOString(),
      }
      return overview
    },
  )

  app.post(
    '/admin/billing/grants',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const input = parse(adminGrantCreditsSchema, request.body)
      return await requireLedger(ledger).grantCredits(request.principal!, input.amount, input.reason)
    },
  )

  app.post(
    '/admin/billing/memberships/:membershipId/adjustments',
    { preHandler: requirePermission(PERMISSIONS.BILLING_MANAGE) },
    async (request) => {
      const { membershipId } = parse(billingMembershipParams, request.params)
      const input = parse(adminAdjustCreditsSchema, request.body)
      return await requireLedger(ledger).adjustCredits(
        request.principal!,
        membershipId,
        input.amount,
        input.reason,
      )
    },
  )
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}

function requireLedger(ledger: CreditLedger | null): CreditLedger {
  if (!ledger) throw new AppError(503, 'BILLING_LEDGER_REQUIRED', 'Billing ledger is required')
  return ledger
}

function startOfChinaDay(now = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  return new Date(
    Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - chinaOffsetMs,
  ).toISOString()
}
