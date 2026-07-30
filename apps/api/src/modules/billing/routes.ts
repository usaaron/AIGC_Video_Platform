import { PERMISSIONS, updatePlanSchema } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { CreditLedger } from './creditLedger.js'

export async function registerBillingRoutes(app: FastifyInstance, ledger: CreditLedger): Promise<void> {
  app.get('/billing/summary', { preHandler: requirePermission(PERMISSIONS.BILLING_READ_SELF) }, async (request) =>
    await ledger.billingSummary(request.principal!),
  )
  app.put('/billing/plan', { preHandler: requirePermission(PERMISSIONS.BILLING_READ_SELF) }, (request) => {
    const parsed = updatePlanSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
    return ledger.updatePlan(request.principal!, parsed.data.plan)
  })
}
