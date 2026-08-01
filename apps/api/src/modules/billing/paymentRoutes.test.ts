import type { BillingPaymentCheckoutInput } from './paymentProvider.js'
import type { AppConfig } from '../../config.js'
import type { BillingPaymentProvider, BillingPaymentWebhookEvent } from './paymentProvider.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { loadConfig } from '../../config.js'
import { AppError } from '../../core/errors.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let authDatabase: PostgresAuthFixture | undefined
let stripe: FakeStripeProvider

beforeAll(async () => {
  authDatabase = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await authDatabase?.reset()
  stripe = new FakeStripeProvider()
})

afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(resolve('./data/test-uploads'), { recursive: true, force: true })
})

afterAll(async () => {
  await authDatabase?.close()
})

describe('stripe sandbox billing api', { timeout: 30_000 }, () => {
  it('creates checkout sessions and reconciles subscription webhooks through the ledger', async () => {
    app = await buildPaymentApp()
    const memberCookie = await login('member@seqora.local', 'MemberPassword123!')

    const configuration = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/payment/configuration',
      headers: { cookie: memberCookie },
    })
    expect(configuration.statusCode).toBe(200)
    expect(configuration.json()).toMatchObject({
      provider: 'stripe',
      enabled: true,
      memberSubscriptionEnabled: true,
      creditPurchaseEnabled: true,
      creditPackCredits: 100,
    })

    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout/subscription',
      headers: { cookie: memberCookie },
      payload: {},
    })
    expect(checkout.statusCode).toBe(201)
    expect(checkout.json()).toMatchObject({
      provider: 'stripe',
      checkoutType: 'subscription',
      checkoutSessionId: 'cs_test_1',
      plan: 'member',
      credits: null,
      status: 'open',
      url: 'https://checkout.stripe.test/cs_test_1',
    })
    expect(stripe.createdSessions[0]).toMatchObject({
      checkoutType: 'subscription',
      membershipId: 'membership-tenant-seqora-demo-user-member',
      priceId: 'price_member_test',
    })

    const activated = await stripeWebhook(
      stripeEvent('evt_checkout_subscription', 'checkout.session.completed', '2026-08-01T00:00:00.000Z', {
        id: 'cs_test_1',
        object: 'checkout.session',
        customer: 'cus_test_1',
        subscription: 'sub_test_1',
        payment_status: 'paid',
        metadata: {
          seqoraCheckoutType: 'subscription',
          membershipId: 'membership-tenant-seqora-demo-user-member',
          tenantId: 'tenant-seqora-demo',
          userId: 'user-member',
        },
      }),
    )
    expect(activated.statusCode).toBe(200)
    expect(activated.json()).toMatchObject({
      status: 'processed',
      duplicate: false,
      internalEventType: 'subscription.activated',
      membershipId: 'membership-tenant-seqora-demo-user-member',
      plan: 'member',
      credits: 786,
      ledgerEntry: { type: 'grant', amount: 500 },
    })

    const duplicate = await stripeWebhook(
      stripeEvent('evt_checkout_subscription', 'checkout.session.completed', '2026-08-01T00:00:00.000Z', {
        id: 'cs_test_1',
        object: 'checkout.session',
        customer: 'cus_test_1',
        subscription: 'sub_test_1',
        payment_status: 'paid',
        metadata: { seqoraCheckoutType: 'subscription' },
      }),
    )
    expect(duplicate.statusCode).toBe(200)
    expect(duplicate.json()).toMatchObject({ duplicate: true, credits: null, ledgerEntry: null })

    const renewed = await stripeWebhook(
      stripeEvent('evt_invoice_paid', 'invoice.paid', '2026-09-01T00:00:00.000Z', {
        id: 'in_test_1',
        object: 'invoice',
        customer: 'cus_test_1',
        subscription: 'sub_test_1',
      }),
    )
    expect(renewed.statusCode).toBe(200)
    expect(renewed.json()).toMatchObject({
      status: 'processed',
      internalEventType: 'subscription.renewed',
      credits: 1286,
    })

    const cancelled = await stripeWebhook(
      stripeEvent('evt_subscription_deleted', 'customer.subscription.deleted', '2026-09-15T00:00:00.000Z', {
        id: 'sub_test_1',
        object: 'subscription',
        customer: 'cus_test_1',
      }),
    )
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json()).toMatchObject({
      status: 'processed',
      internalEventType: 'subscription.cancelled',
      plan: 'free',
      credits: 1286,
    })

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: memberCookie },
    })
    expect(summary.statusCode).toBe(200)
    expect(summary.json()).toMatchObject({ plan: 'free', credits: 1286 })

    const adminCookie = await login('admin@seqora.local', 'Admin123!')
    const reconciliation = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/reconciliation?membershipId=membership-tenant-seqora-demo-user-member',
      headers: { cookie: adminCookie },
    })
    expect(reconciliation.statusCode).toBe(200)
    expect(reconciliation.json()).toMatchObject({
      meta: { total: 3 },
      items: expect.arrayContaining([
        expect.objectContaining({
          provider: 'stripe',
          eventType: 'checkout.session.completed',
          status: 'processed',
          ledgerEntryId: expect.any(String),
        }),
        expect.objectContaining({
          eventType: 'invoice.paid',
          status: 'processed',
        }),
      ]),
    })
  })

  it('reconciles credit purchases and refunds without frontend plan mutation', async () => {
    app = await buildPaymentApp()
    const memberCookie = await login('member@seqora.local', 'MemberPassword123!')

    const rejectedPlanChange = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/plan',
      headers: { cookie: memberCookie },
      payload: { plan: 'member' },
    })
    expect(rejectedPlanChange.statusCode).toBe(403)

    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout/credits',
      headers: { cookie: memberCookie },
      payload: { credits: 100 },
    })
    expect(checkout.statusCode).toBe(201)
    expect(checkout.json()).toMatchObject({
      checkoutType: 'credits',
      checkoutSessionId: 'cs_test_1',
      credits: 100,
      plan: null,
    })
    expect(stripe.createdSessions[0]).toMatchObject({
      checkoutType: 'credits',
      priceId: 'price_credits_test',
      credits: 100,
    })

    const purchased = await stripeWebhook(
      stripeEvent('evt_checkout_credits', 'checkout.session.completed', '2026-08-01T00:00:00.000Z', {
        id: 'cs_test_1',
        object: 'checkout.session',
        customer: 'cus_test_2',
        payment_intent: 'pi_test_1',
        payment_status: 'paid',
        amount_total: 2000,
        currency: 'usd',
        metadata: {
          seqoraCheckoutType: 'credits',
          membershipId: 'membership-tenant-seqora-demo-user-member',
          tenantId: 'tenant-seqora-demo',
          userId: 'user-member',
          credits: '100',
        },
      }),
    )
    expect(purchased.statusCode).toBe(200)
    expect(purchased.json()).toMatchObject({
      internalEventType: 'credits.purchased',
      credits: 386,
      ledgerEntry: { type: 'grant', amount: 100 },
    })

    const refunded = await stripeWebhook(
      stripeEvent('evt_charge_refunded', 'charge.refunded', '2026-08-02T00:00:00.000Z', {
        id: 'ch_test_1',
        object: 'charge',
        payment_intent: 'pi_test_1',
        amount: 2000,
        amount_refunded: 2000,
        currency: 'usd',
      }),
    )
    expect(refunded.statusCode).toBe(200)
    expect(refunded.json()).toMatchObject({
      internalEventType: 'payment.refunded',
      credits: 286,
      ledgerEntry: { type: 'adjustment', amount: -100 },
    })

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: memberCookie },
    })
    expect(summary.statusCode).toBe(200)
    expect(summary.json()).toMatchObject({ plan: 'free', credits: 286 })
    expect(summary.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'payment-stripe-evt_checkout_credits',
          amount: 100,
          description: 'Stripe credit purchase',
        }),
        expect.objectContaining({
          id: 'refund-stripe-evt_charge_refunded',
          amount: -100,
          description: 'Stripe credit purchase refund',
        }),
      ]),
    )

    const adminCookie = await login('admin@seqora.local', 'Admin123!')
    const consoleSnapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/console?limit=20',
      headers: { cookie: adminCookie },
    })
    expect(consoleSnapshot.statusCode).toBe(200)
    expect(consoleSnapshot.json().billingPaymentReconciliation).toMatchObject({
      meta: { total: 2 },
      items: expect.arrayContaining([
        expect.objectContaining({ eventType: 'charge.refunded', status: 'processed', credits: 100 }),
      ]),
    })
  })
})

async function buildPaymentApp() {
  return await buildApp({
    config: localAuthConfig(),
    startWorker: false,
    paymentProvider: stripe,
  })
}

function localAuthConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    DATABASE_URL: authDatabase.connectionString,
    DATA_FILE: ':memory:',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: resolve('./data/test-uploads'),
    PAYMENT_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_seqora',
    STRIPE_WEBHOOK_SECRET: 'whsec_seqora',
    STRIPE_MEMBER_PRICE_ID: 'price_member_test',
    STRIPE_CREDIT_PRICE_ID: 'price_credits_test',
    STRIPE_CREDIT_PACK_CREDITS: '100',
    ...overrides,
  })
}

async function login(email: string, password: string): Promise<string> {
  if (!app) throw new Error('App is not ready')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  })
  expect(response.statusCode).toBe(200)
  return cookieValue(response)
}

async function stripeWebhook(event: TestStripeEvent) {
  if (!app) throw new Error('App is not ready')
  return await app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhooks/stripe',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 'test-signature',
    },
    payload: JSON.stringify(event),
  })
}

function stripeEvent(
  id: string,
  type: string,
  createdAt: string,
  data: Record<string, unknown>,
): TestStripeEvent {
  return { id, type, createdAt, data }
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}

type TestStripeEvent = {
  id: string
  type: string
  createdAt: string
  data: Record<string, unknown>
}

class FakeStripeProvider implements BillingPaymentProvider {
  readonly provider = 'stripe' as const
  readonly createdSessions: BillingPaymentCheckoutInput[] = []

  async createCheckoutSession(
    input: BillingPaymentCheckoutInput,
  ): Promise<Awaited<ReturnType<BillingPaymentProvider['createCheckoutSession']>>> {
    this.createdSessions.push(input)
    const id = `cs_test_${this.createdSessions.length}`
    return {
      id,
      url: `https://checkout.stripe.test/${id}`,
      status: 'open',
      customerId: null,
      subscriptionId: null,
      paymentIntentId: null,
      amountTotal: input.checkoutType === 'credits' ? 2000 : 12000,
      currency: 'usd',
      metadata: {
        seqoraCheckoutType: input.checkoutType,
        membershipId: input.membershipId,
        tenantId: input.tenantId,
        userId: input.userId,
        ...(input.credits ? { credits: String(input.credits) } : {}),
      },
    }
  }

  constructWebhookEvent(rawBody: string | Buffer, signature: string): BillingPaymentWebhookEvent {
    if (signature !== 'test-signature') {
      throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature')
    }
    const parsed = JSON.parse(
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
    ) as TestStripeEvent
    return {
      id: parsed.id,
      type: parsed.type,
      createdAt: parsed.createdAt,
      data: parsed.data,
    }
  }
}
