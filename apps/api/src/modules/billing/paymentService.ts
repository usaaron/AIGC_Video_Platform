import type {
  BillingCheckoutSession,
  BillingPaymentConfiguration,
  BillingWebhookEvent,
  CreateCreditCheckoutInput,
  Plan,
  Principal,
} from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { Mailer } from '../../core/email/mailer.js'
import type { CreditLedger } from './creditLedger.js'
import type { BillingPaymentProvider, BillingPaymentWebhookEvent } from './paymentProvider.js'
import type {
  BillingPaymentReconciliationAlertInput,
  BillingPaymentRepository,
  BillingPaymentSessionRecord,
} from './paymentRepository.js'

type BillingPaymentServiceOptions = {
  successUrl: string
  cancelUrl: string
  memberPriceId: string
  creditPriceId: string
  creditPackCredits: number
  alertEmails: string[]
}

export class BillingPaymentService {
  constructor(
    private readonly repository: BillingPaymentRepository,
    private readonly ledger: CreditLedger,
    private readonly provider: BillingPaymentProvider,
    private readonly options: BillingPaymentServiceOptions,
    private readonly mailer: Mailer | null = null,
  ) {}

  configuration(): BillingPaymentConfiguration {
    return {
      provider: this.provider.provider,
      enabled: true,
      memberSubscriptionEnabled: Boolean(this.options.memberPriceId),
      creditPurchaseEnabled: Boolean(this.options.creditPriceId),
      creditPackCredits: this.options.creditPackCredits,
    }
  }

  async createMemberSubscriptionCheckout(principal: Principal): Promise<BillingCheckoutSession> {
    const membership = await this.requireMembership(principal)
    const session = await this.provider.createCheckoutSession({
      checkoutType: 'subscription',
      membershipId: membership.membershipId,
      tenantId: membership.tenantId,
      userId: membership.userId,
      email: membership.email,
      successUrl: this.options.successUrl,
      cancelUrl: this.options.cancelUrl,
      priceId: this.options.memberPriceId,
    })
    return await this.repository.createCheckoutSession({
      provider: this.provider.provider,
      providerSessionId: session.id,
      checkoutType: 'subscription',
      tenantId: membership.tenantId,
      userId: membership.userId,
      membershipId: membership.membershipId,
      providerCustomerId: session.customerId,
      providerSubscriptionId: session.subscriptionId,
      providerPaymentIntentId: session.paymentIntentId,
      status: session.status,
      plan: 'member',
      credits: null,
      amountTotal: session.amountTotal,
      currency: session.currency,
      checkoutUrl: session.url,
      metadata: session.metadata,
    })
  }

  async createCreditCheckout(
    principal: Principal,
    input: CreateCreditCheckoutInput = {},
  ): Promise<BillingCheckoutSession> {
    const credits = input.credits ?? this.options.creditPackCredits
    if (credits !== this.options.creditPackCredits) {
      throw new AppError(400, 'UNSUPPORTED_CREDIT_PACK', 'Configured sandbox only supports one credit pack')
    }
    const membership = await this.requireMembership(principal)
    const session = await this.provider.createCheckoutSession({
      checkoutType: 'credits',
      membershipId: membership.membershipId,
      tenantId: membership.tenantId,
      userId: membership.userId,
      email: membership.email,
      successUrl: this.options.successUrl,
      cancelUrl: this.options.cancelUrl,
      priceId: this.options.creditPriceId,
      credits,
    })
    return await this.repository.createCheckoutSession({
      provider: this.provider.provider,
      providerSessionId: session.id,
      checkoutType: 'credits',
      tenantId: membership.tenantId,
      userId: membership.userId,
      membershipId: membership.membershipId,
      providerCustomerId: session.customerId,
      providerSubscriptionId: session.subscriptionId,
      providerPaymentIntentId: session.paymentIntentId,
      status: session.status,
      plan: null,
      credits,
      amountTotal: session.amountTotal,
      currency: session.currency,
      checkoutUrl: session.url,
      metadata: session.metadata,
    })
  }

  async processWebhook(rawBody: string | Buffer, signature: string): Promise<PaymentWebhookResult> {
    const event = this.provider.constructWebhookEvent(rawBody, signature)
    try {
      if (event.type === 'checkout.session.completed') {
        return await this.processCheckoutCompleted(event)
      }
      if (event.type === 'checkout.session.expired') {
        return await this.processCheckoutExpired(event)
      }
      if (event.type === 'invoice.paid') {
        return await this.processSubscriptionRenewed(event)
      }
      if (event.type === 'invoice.payment_failed') {
        return await this.processInvoicePaymentFailed(event)
      }
      if (event.type === 'customer.subscription.deleted') {
        return await this.processSubscriptionCancelled(event)
      }
      if (event.type === 'charge.refunded') {
        return await this.processChargeRefunded(event)
      }
      await this.repository.recordReconciliation({
        provider: this.provider.provider,
        providerEventId: event.id,
        eventType: event.type,
        status: 'ignored',
        message: 'Stripe event type is not part of the Seqora billing lifecycle',
        metadata: { stripeObject: safeEventObject(event.data) },
      })
      return ignoredPaymentWebhookResult(event)
    } catch (error) {
      await this.repository.recordReconciliation({
        provider: this.provider.provider,
        providerEventId: event.id,
        eventType: event.type,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        metadata: { stripeObject: safeEventObject(event.data) },
      })
      await this.raiseReconciliationAlert({
        provider: this.provider.provider,
        providerEventId: event.id,
        eventType: event.type,
        alertType: 'webhook.processing_failed',
        severity: 'critical',
        message: error instanceof Error ? error.message : String(error),
        metadata: {
          stripeObject: safeEventObject(event.data),
          errorName: error instanceof Error ? error.name : typeof error,
        },
      })
      throw error
    }
  }

  private async processCheckoutCompleted(event: BillingPaymentWebhookEvent): Promise<PaymentWebhookResult> {
    const session = objectRecord(event.data)
    const metadata = metadataFromObject(session)
    const checkoutType = metadata.seqoraCheckoutType
    const providerSessionId = stringValue(session.id)
    if (!providerSessionId || (checkoutType !== 'subscription' && checkoutType !== 'credits')) {
      await this.recordIgnored(event, null, 'Checkout session is missing Seqora billing metadata')
      await this.raiseReconciliationAlert({
        provider: this.provider.provider,
        providerEventId: event.id,
        eventType: event.type,
        alertType: 'checkout.metadata_missing',
        severity: 'critical',
        message: 'Checkout session is missing Seqora billing metadata',
        metadata: { stripeObject: safeEventObject(session) },
      })
      return ignoredPaymentWebhookResult(event)
    }

    const completed = await this.repository.markCheckoutCompleted({
      provider: this.provider.provider,
      providerSessionId,
      providerCustomerId: stripeId(session.customer),
      providerSubscriptionId: stripeId(session.subscription),
      providerPaymentIntentId: stripeId(session.payment_intent),
      amountTotal: numberValue(session.amount_total),
      currency: stringValue(session.currency),
      metadata,
      completedAt: event.createdAt,
    })
    if (!completed) {
      throw new AppError(409, 'PAYMENT_SESSION_NOT_FOUND', 'Checkout session was not created by this API')
    }

    if (checkoutType === 'credits' && stringValue(session.payment_status) !== 'paid') {
      await this.recordIgnored(event, completed, 'Credit checkout is not paid yet')
      return ignoredPaymentWebhookResult(event, completed)
    }

    const webhookPayload =
      checkoutType === 'subscription'
        ? subscriptionActivatedPayload(event, completed, session)
        : creditsPurchasedPayload(event, completed, session)
    const result = await this.ledger.processBillingWebhook(this.provider.provider, webhookPayload)
    await this.recordProcessed(event, completed, result.ledgerEntry?.id ?? null, webhookPayload)
    return {
      provider: this.provider.provider,
      eventId: event.id,
      eventType: event.type,
      status: 'processed',
      duplicate: result.duplicate,
      internalEventType: webhookPayload.type,
      membershipId: result.membershipId,
      tenantId: result.tenantId,
      userId: result.userId,
      plan: result.plan,
      credits: result.credits,
      ledgerEntry: result.ledgerEntry,
    }
  }

  private async processCheckoutExpired(event: BillingPaymentWebhookEvent): Promise<PaymentWebhookResult> {
    const session = objectRecord(event.data)
    const providerSessionId = stringValue(session.id)
    if (!providerSessionId) {
      await this.recordIgnored(event, null, 'Expired checkout session is missing the session id')
      return ignoredPaymentWebhookResult(event)
    }
    const expired = await this.repository.markCheckoutExpired({
      provider: this.provider.provider,
      providerSessionId,
      expiredAt: event.createdAt,
    })
    if (!expired) {
      await this.recordIgnored(event, null, 'Expired checkout session was not created by this API')
      return ignoredPaymentWebhookResult(event)
    }
    await this.repository.recordReconciliation({
      provider: this.provider.provider,
      providerEventId: event.id,
      eventType: event.type,
      paymentSessionId: expired.id,
      tenantId: expired.tenantId,
      userId: expired.userId,
      membershipId: expired.membershipId,
      status: 'ignored',
      amount: null,
      currency: expired.currency ?? null,
      credits: expired.credits ?? null,
      message: 'Checkout session expired',
      metadata: { stripeObject: safeEventObject(session) },
    })
    return ignoredPaymentWebhookResult(event, expired)
  }

  private async processSubscriptionRenewed(event: BillingPaymentWebhookEvent): Promise<PaymentWebhookResult> {
    const invoice = objectRecord(event.data)
    const subscriptionId = subscriptionIdFromInvoice(invoice)
    if (!subscriptionId) {
      await this.recordIgnored(event, null, 'Invoice does not reference a subscription')
      return ignoredPaymentWebhookResult(event)
    }
    const paymentSession = await this.repository.findBySubscriptionId(this.provider.provider, subscriptionId)
    if (!paymentSession) {
      throw new AppError(
        409,
        'PAYMENT_SUBSCRIPTION_NOT_FOUND',
        'Subscription is not mapped to a billing account',
      )
    }
    const payload: BillingWebhookEvent = {
      eventId: event.id,
      type: 'subscription.renewed',
      membershipId: paymentSession.membershipId,
      plan: 'member',
      referenceId: `stripe-invoice-${stringValue(invoice.id) ?? event.id}`,
      description: 'Stripe subscription renewal',
      occurredAt: event.createdAt,
      metadata: {
        stripeSubscriptionId: subscriptionId,
        stripeInvoiceId: stringValue(invoice.id),
        stripeCustomerId: stripeId(invoice.customer),
      },
    }
    const result = await this.ledger.processBillingWebhook(this.provider.provider, payload)
    await this.recordProcessed(event, paymentSession, result.ledgerEntry?.id ?? null, payload)
    return {
      provider: this.provider.provider,
      eventId: event.id,
      eventType: event.type,
      status: 'processed',
      duplicate: result.duplicate,
      internalEventType: payload.type,
      membershipId: result.membershipId,
      tenantId: result.tenantId,
      userId: result.userId,
      plan: result.plan,
      credits: result.credits,
      ledgerEntry: result.ledgerEntry,
    }
  }

  private async processInvoicePaymentFailed(event: BillingPaymentWebhookEvent): Promise<PaymentWebhookResult> {
    const invoice = objectRecord(event.data)
    const subscriptionId = subscriptionIdFromInvoice(invoice)
    if (!subscriptionId) {
      await this.recordIgnored(event, null, 'Failed invoice does not reference a subscription')
      return ignoredPaymentWebhookResult(event)
    }
    const paymentSession = await this.repository.findBySubscriptionId(this.provider.provider, subscriptionId)
    if (!paymentSession) {
      const reconciliationId = await this.repository.recordReconciliation({
        provider: this.provider.provider,
        providerEventId: event.id,
        eventType: event.type,
        status: 'failed',
        amount: null,
        currency: null,
        credits: null,
        message: 'Stripe invoice payment failed for an unmapped subscription',
        metadata: {
          stripeObject: safeEventObject(invoice),
          stripeSubscriptionId: subscriptionId,
        },
      })
      await this.raiseReconciliationAlert({
        provider: this.provider.provider,
        providerEventId: event.id,
        eventType: event.type,
        alertType: 'invoice.subscription_missing',
        severity: 'critical',
        message: 'Stripe invoice payment failed for an unmapped subscription',
        metadata: {
          stripeObject: safeEventObject(invoice),
          stripeSubscriptionId: subscriptionId,
          reconciliationItemId: reconciliationId,
        },
      })
      return ignoredPaymentWebhookResult(event)
    }
    const reconciliationId = await this.repository.recordReconciliation({
      provider: this.provider.provider,
      providerEventId: event.id,
      eventType: event.type,
      paymentSessionId: paymentSession.id,
      tenantId: paymentSession.tenantId,
      userId: paymentSession.userId,
      membershipId: paymentSession.membershipId,
      status: 'failed',
      amount: null,
      currency: paymentSession.currency ?? null,
      credits: null,
      message: 'Stripe invoice payment failed',
      metadata: {
        stripeObject: safeEventObject(invoice),
        stripeSubscriptionId: subscriptionId,
      },
    })
    await this.raiseReconciliationAlert({
      provider: this.provider.provider,
      providerEventId: event.id,
      eventType: event.type,
      alertType: 'invoice.payment_failed',
      severity: 'warning',
      paymentSessionId: paymentSession.id,
      reconciliationItemId: reconciliationId,
      tenantId: paymentSession.tenantId,
      userId: paymentSession.userId,
      membershipId: paymentSession.membershipId,
      message: 'Stripe invoice payment failed',
      metadata: {
        stripeObject: safeEventObject(invoice),
        stripeSubscriptionId: subscriptionId,
      },
    })
    return {
      provider: this.provider.provider,
      eventId: event.id,
      eventType: event.type,
      status: 'processed',
      duplicate: false,
      internalEventType: 'subscription.expired',
      membershipId: paymentSession.membershipId,
      tenantId: paymentSession.tenantId,
      userId: paymentSession.userId,
      plan: paymentSession.plan ?? null,
      credits: paymentSession.credits ?? null,
      ledgerEntry: null,
    }
  }

  private async processSubscriptionCancelled(
    event: BillingPaymentWebhookEvent,
  ): Promise<PaymentWebhookResult> {
    const subscription = objectRecord(event.data)
    const subscriptionId = stringValue(subscription.id)
    if (!subscriptionId) {
      await this.recordIgnored(event, null, 'Subscription cancellation is missing the subscription id')
      return ignoredPaymentWebhookResult(event)
    }
    const paymentSession = await this.repository.findBySubscriptionId(this.provider.provider, subscriptionId)
    if (!paymentSession) {
      throw new AppError(
        409,
        'PAYMENT_SUBSCRIPTION_NOT_FOUND',
        'Subscription is not mapped to a billing account',
      )
    }
    const payload: BillingWebhookEvent = {
      eventId: event.id,
      type: 'subscription.cancelled',
      membershipId: paymentSession.membershipId,
      plan: 'free',
      referenceId: `stripe-subscription-${subscriptionId}`,
      description: 'Stripe subscription cancelled',
      occurredAt: event.createdAt,
      metadata: {
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: stripeId(subscription.customer),
      },
    }
    const result = await this.ledger.processBillingWebhook(this.provider.provider, payload)
    await this.recordProcessed(event, paymentSession, result.ledgerEntry?.id ?? null, payload)
    return {
      provider: this.provider.provider,
      eventId: event.id,
      eventType: event.type,
      status: 'processed',
      duplicate: result.duplicate,
      internalEventType: payload.type,
      membershipId: result.membershipId,
      tenantId: result.tenantId,
      userId: result.userId,
      plan: result.plan,
      credits: result.credits,
      ledgerEntry: result.ledgerEntry,
    }
  }

  private async processChargeRefunded(event: BillingPaymentWebhookEvent): Promise<PaymentWebhookResult> {
    const charge = objectRecord(event.data)
    const paymentIntentId = stripeId(charge.payment_intent)
    if (!paymentIntentId) {
      await this.recordIgnored(event, null, 'Refunded charge does not reference a payment intent')
      return ignoredPaymentWebhookResult(event)
    }
    const paymentSession = await this.repository.findByPaymentIntentId(
      this.provider.provider,
      paymentIntentId,
    )
    if (!paymentSession) {
      await this.raiseReconciliationAlert({
        provider: this.provider.provider,
        providerEventId: event.id,
        eventType: event.type,
        alertType: 'refund.unmapped',
        severity: 'warning',
        message: 'Refunded charge is not mapped to a billing payment session',
        metadata: {
          stripeObject: safeEventObject(event.data),
          stripePaymentIntentId: paymentIntentId,
        },
      })
      await this.recordIgnored(event, null, 'Refunded charge is not mapped to a billing payment session')
      return ignoredPaymentWebhookResult(event)
    }
    if (paymentSession.checkoutType !== 'credits') {
      await this.recordIgnored(event, paymentSession, 'Refunded charge is not mapped to a credit purchase')
      return ignoredPaymentWebhookResult(event, paymentSession ?? undefined)
    }

    const amountRefunded = numberValue(charge.amount_refunded) ?? 0
    const previousRefunded = paymentSession.amountRefunded
    const refundDelta = amountRefunded - previousRefunded
    if (refundDelta <= 0) {
      await this.recordIgnored(event, paymentSession, 'Refund was already reconciled')
      return ignoredPaymentWebhookResult(event, paymentSession)
    }

    const purchasedCredits = paymentSession.credits ?? this.options.creditPackCredits
    const amountTotal = numberValue(charge.amount) ?? paymentSession.amountTotal ?? refundDelta
    const refundCredits = Math.max(
      1,
      Math.min(purchasedCredits, Math.floor((purchasedCredits * refundDelta) / amountTotal)),
    )
    const payload: BillingWebhookEvent = {
      eventId: event.id,
      type: 'payment.refunded',
      membershipId: paymentSession.membershipId,
      credits: refundCredits,
      referenceId: `stripe-refund-${paymentIntentId}-${amountRefunded}`,
      description: 'Stripe credit purchase refund',
      occurredAt: event.createdAt,
      metadata: {
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: stringValue(charge.id),
        amountRefunded,
        refundDelta,
        amountTotal,
      },
    }
    const result = await this.ledger.processBillingWebhook(this.provider.provider, payload)
    const updatedSession = await this.repository.markRefunded({
      provider: this.provider.provider,
      providerPaymentIntentId: paymentIntentId,
      amountRefunded,
      refundedAt: event.createdAt,
    })
    await this.recordProcessed(
      event,
      updatedSession ?? paymentSession,
      result.ledgerEntry?.id ?? null,
      payload,
    )
    return {
      provider: this.provider.provider,
      eventId: event.id,
      eventType: event.type,
      status: 'processed',
      duplicate: result.duplicate,
      internalEventType: payload.type,
      membershipId: result.membershipId,
      tenantId: result.tenantId,
      userId: result.userId,
      plan: result.plan,
      credits: result.credits,
      ledgerEntry: result.ledgerEntry,
    }
  }

  private async requireMembership(principal: Principal) {
    const membership = await this.repository.findActiveMembership(principal.userId, principal.tenantId)
    if (!membership) {
      throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account does not exist or is disabled')
    }
    return membership
  }

  private async recordProcessed(
    event: BillingPaymentWebhookEvent,
    paymentSession: BillingPaymentSessionRecord,
    ledgerEntryId: string | null,
    payload: BillingWebhookEvent,
  ): Promise<void> {
    const reconciliationId = await this.repository.recordReconciliation({
      provider: this.provider.provider,
      providerEventId: event.id,
      eventType: event.type,
      paymentSessionId: paymentSession.id,
      billingWebhookEventId: `billing-webhook-${this.provider.provider}-${event.id}`,
      ledgerEntryId,
      tenantId: paymentSession.tenantId,
      userId: paymentSession.userId,
      membershipId: paymentSession.membershipId,
      status: 'processed',
      amount: payload.type === 'payment.refunded' ? -payload.credits! : (payload.credits ?? null),
      currency: paymentSession.currency ?? null,
      credits: payload.credits ?? null,
      message: `${payload.type} processed`,
      metadata: {
        internalEventType: payload.type,
        referenceId: payload.referenceId,
        stripeObject: safeEventObject(event.data),
      },
    })
    await this.repository.resolveAlertsForEvent(this.provider.provider, event.id, {
      reconciliationItemId: reconciliationId,
      internalEventType: payload.type,
      referenceId: payload.referenceId,
    })
  }

  private async recordIgnored(
    event: BillingPaymentWebhookEvent,
    paymentSession: BillingPaymentSessionRecord | null | undefined,
    message: string,
  ): Promise<void> {
    await this.repository.recordReconciliation({
      provider: this.provider.provider,
      providerEventId: event.id,
      eventType: event.type,
      paymentSessionId: paymentSession?.id ?? null,
      tenantId: paymentSession?.tenantId ?? null,
      userId: paymentSession?.userId ?? null,
      membershipId: paymentSession?.membershipId ?? null,
      status: 'ignored',
      amount: null,
      currency: paymentSession?.currency ?? null,
      credits: null,
      message,
      metadata: { stripeObject: safeEventObject(event.data) },
    })
  }

  private async raiseReconciliationAlert(input: BillingPaymentReconciliationAlertInput): Promise<void> {
    const alert = await this.repository.recordReconciliationAlert(input)
    if (!this.mailer || !this.options.alertEmails.length) return
    const subject = `[Stripe billing] ${input.alertType} ${input.severity}`
    const text = [
      `Alert: ${input.alertType}`,
      `Severity: ${input.severity}`,
      `Provider event: ${input.providerEventId}`,
      `Event type: ${input.eventType}`,
      `Message: ${input.message}`,
      input.membershipId ? `Membership: ${input.membershipId}` : null,
      input.tenantId ? `Tenant: ${input.tenantId}` : null,
      input.userId ? `User: ${input.userId}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n')

    let delivered = false
    for (const to of this.options.alertEmails) {
      try {
        await this.mailer.send({
          to,
          subject,
          text,
          purpose: 'billing_reconciliation_alert',
          idempotencyKey: `billing-alert-${alert.id}-${to}`,
        })
        delivered = true
      } catch {
        // Keep the webhook flow moving. Alert rows remain open until a later retry or manual action.
      }
    }
    if (delivered) {
      await this.repository.markReconciliationAlertNotified(alert.id)
    }
  }
}

export type PaymentWebhookResult = {
  provider: 'stripe'
  eventId: string
  eventType: string
  status: 'processed' | 'ignored'
  duplicate: boolean
  internalEventType: BillingWebhookEvent['type'] | null
  membershipId: string | null
  tenantId: string | null
  userId: string | null
  plan: Plan | null
  credits: number | null
  ledgerEntry: BillingWebhookProcessLedgerEntry | null
}

type BillingWebhookProcessLedgerEntry = Awaited<
  ReturnType<CreditLedger['processBillingWebhook']>
>['ledgerEntry']

function subscriptionActivatedPayload(
  event: BillingPaymentWebhookEvent,
  paymentSession: BillingPaymentSessionRecord,
  session: Record<string, unknown>,
): BillingWebhookEvent {
  const subscriptionId = stripeId(session.subscription) ?? paymentSession.providerSubscriptionId
  return {
    eventId: event.id,
    type: 'subscription.activated',
    membershipId: paymentSession.membershipId,
    plan: 'member',
    referenceId: `stripe-subscription-${subscriptionId ?? paymentSession.providerSessionId}`,
    description: 'Stripe member subscription activated',
    occurredAt: event.createdAt,
    metadata: {
      stripeCheckoutSessionId: paymentSession.providerSessionId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: stripeId(session.customer),
    },
  }
}

function creditsPurchasedPayload(
  event: BillingPaymentWebhookEvent,
  paymentSession: BillingPaymentSessionRecord,
  session: Record<string, unknown>,
): BillingWebhookEvent {
  const credits = paymentSession.credits ?? Number(metadataFromObject(session).credits)
  return {
    eventId: event.id,
    type: 'credits.purchased',
    membershipId: paymentSession.membershipId,
    credits,
    referenceId: `stripe-checkout-${paymentSession.providerSessionId}`,
    description: 'Stripe credit purchase',
    occurredAt: event.createdAt,
    metadata: {
      stripeCheckoutSessionId: paymentSession.providerSessionId,
      stripePaymentIntentId: stripeId(session.payment_intent),
      stripeCustomerId: stripeId(session.customer),
      amountTotal: numberValue(session.amount_total),
      currency: stringValue(session.currency),
    },
  }
}

function ignoredPaymentWebhookResult(
  event: BillingPaymentWebhookEvent,
  paymentSession?: BillingPaymentSessionRecord | null,
): PaymentWebhookResult {
  return {
    provider: 'stripe',
    eventId: event.id,
    eventType: event.type,
    status: 'ignored',
    duplicate: false,
    internalEventType: null,
    membershipId: paymentSession?.membershipId ?? null,
    tenantId: paymentSession?.tenantId ?? null,
    userId: paymentSession?.userId ?? null,
    plan: null,
    credits: null,
    ledgerEntry: null,
  }
}

function subscriptionIdFromInvoice(invoice: Record<string, unknown>): string | null {
  return (
    stripeId(invoice.subscription) ??
    stringValue(objectRecord(invoice.subscription_details).subscription) ??
    stringValue(objectRecord(objectRecord(invoice.parent).subscription_details).subscription)
  )
}

function metadataFromObject(value: Record<string, unknown>): Record<string, string> {
  const metadata = objectRecord(value.metadata)
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (!value || typeof value !== 'object') return null
  return stringValue((value as Record<string, unknown>).id)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function safeEventObject(value: unknown): Record<string, unknown> {
  const record = objectRecord(value)
  return {
    id: stringValue(record.id),
    object: stringValue(record.object),
    status: stringValue(record.status),
  }
}
