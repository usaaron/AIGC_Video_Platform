import Stripe from 'stripe'
import { AppError } from '../../core/errors.js'

export type BillingPaymentCheckoutType = 'subscription' | 'credits'

export type BillingPaymentCheckoutInput = {
  checkoutType: BillingPaymentCheckoutType
  membershipId: string
  tenantId: string
  userId: string
  email: string | null
  successUrl: string
  cancelUrl: string
  priceId: string
  credits?: number
}

export type BillingPaymentCheckoutSession = {
  id: string
  url: string
  status: 'open' | 'completed' | 'expired' | 'cancelled' | 'refunded'
  customerId: string | null
  subscriptionId: string | null
  paymentIntentId: string | null
  amountTotal: number | null
  currency: string | null
  metadata: Record<string, string>
}

export type BillingPaymentWebhookEvent = {
  id: string
  type: string
  createdAt: string
  data: unknown
}

export interface BillingPaymentProvider {
  readonly provider: 'stripe'
  createCheckoutSession(input: BillingPaymentCheckoutInput): Promise<BillingPaymentCheckoutSession>
  constructWebhookEvent(rawBody: string | Buffer, signature: string): BillingPaymentWebhookEvent
}

export class StripeBillingPaymentProvider implements BillingPaymentProvider {
  readonly provider = 'stripe' as const
  private readonly stripe: Stripe

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey)
  }

  async createCheckoutSession(input: BillingPaymentCheckoutInput): Promise<BillingPaymentCheckoutSession> {
    const metadata = checkoutMetadata(input)
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: input.checkoutType === 'subscription' ? 'subscription' : 'payment',
      client_reference_id: input.membershipId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: [{ price: input.priceId, quantity: 1 }],
      metadata,
    }
    if (input.email) params.customer_email = input.email
    if (input.checkoutType === 'subscription') {
      params.subscription_data = { metadata }
    } else {
      params.payment_intent_data = { metadata }
    }
    const session = await this.stripe.checkout.sessions.create(params)
    return checkoutSessionFromStripe(session)
  }

  constructWebhookEvent(rawBody: string | Buffer, signature: string): BillingPaymentWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret)
    return {
      id: event.id,
      type: event.type,
      createdAt: new Date(event.created * 1000).toISOString(),
      data: event.data.object,
    }
  }
}

function checkoutMetadata(input: BillingPaymentCheckoutInput): Record<string, string> {
  return {
    seqoraCheckoutType: input.checkoutType,
    membershipId: input.membershipId,
    tenantId: input.tenantId,
    userId: input.userId,
    ...(input.credits ? { credits: String(input.credits) } : {}),
  }
}

function checkoutSessionFromStripe(session: Stripe.Checkout.Session): BillingPaymentCheckoutSession {
  if (!session.url) {
    throw new AppError(502, 'PAYMENT_CHECKOUT_URL_MISSING', 'Payment provider did not return a checkout URL')
  }
  return {
    id: session.id,
    url: session.url,
    status: checkoutSessionStatus(session.status),
    customerId: idFromStripeValue(session.customer),
    subscriptionId: idFromStripeValue(session.subscription),
    paymentIntentId: idFromStripeValue(session.payment_intent),
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    metadata: stringMetadata(session.metadata),
  }
}

function checkoutSessionStatus(
  status: Stripe.Checkout.Session.Status | null,
): BillingPaymentCheckoutSession['status'] {
  if (status === 'complete') return 'completed'
  if (status === 'expired') return 'expired'
  return 'open'
}

function idFromStripeValue(value: string | { id?: string } | null): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  return value.id ?? null
}

function stringMetadata(value: Stripe.Metadata | null): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}
