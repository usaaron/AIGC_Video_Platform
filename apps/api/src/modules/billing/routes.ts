import { billingWebhookEventSchema, PERMISSIONS } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { requirePermission } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import type { CreditLedger } from './creditLedger.js'

const webhookProviderParams = z.object({
  provider: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i),
})

export async function registerBillingRoutes(
  app: FastifyInstance,
  ledger: CreditLedger,
  options: { webhookSecret?: string } = {},
): Promise<void> {
  app.get('/billing/summary', { preHandler: requirePermission(PERMISSIONS.BILLING_READ_SELF) }, async (request) =>
    await ledger.billingSummary(request.principal!),
  )
  app.put('/billing/plan', { preHandler: requirePermission(PERMISSIONS.BILLING_READ_SELF) }, () => {
    throw new AppError(403, 'PLAN_CHANGE_REQUIRES_BILLING_WEBHOOK', 'Plan changes require a payment webhook')
  })
  app.post('/billing/webhooks/:provider', { config: { rateLimit: false } }, async (request, reply) => {
    const { provider } = parse(webhookProviderParams, request.params)
    verifyWebhookSignature(options.webhookSecret, request.headers['x-seqora-signature'], request.body)
    const input = parse(billingWebhookEventSchema, request.body)
    const result = await ledger.processBillingWebhook(provider, input)
    reply.header('Cache-Control', 'no-store')
    return result
  })
}

function verifyWebhookSignature(
  webhookSecret: string | undefined,
  headerValue: string | string[] | undefined,
  body: unknown,
): void {
  if (!webhookSecret) {
    throw new AppError(503, 'BILLING_WEBHOOK_NOT_CONFIGURED', 'Billing webhook is not configured')
  }
  const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!signature) throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature')
  const expected = createHmac('sha256', webhookSecret).update(canonicalJson(body)).digest('hex')
  const received = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature
  const expectedBuffer = Buffer.from(expected, 'hex')
  const receivedBuffer = Buffer.from(received, 'hex')
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature')
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value)) ?? ''
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  )
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}
