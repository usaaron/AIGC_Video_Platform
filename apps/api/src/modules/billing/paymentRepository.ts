import type { BillingCheckoutSession, BillingCheckoutType, Plan } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import type { AccountDatabase } from '../../infra/postgres.js'

export type BillingPaymentMembership = {
  membershipId: string
  tenantId: string
  userId: string
  email: string | null
  plan: Plan
  credits: number
}

export type BillingPaymentSessionRecordInput = {
  provider: 'stripe'
  providerSessionId: string
  checkoutType: BillingCheckoutType
  tenantId: string
  userId: string
  membershipId: string
  providerCustomerId?: string | null
  providerSubscriptionId?: string | null
  providerPaymentIntentId?: string | null
  status: BillingCheckoutSession['status']
  plan?: Plan | null
  credits?: number | null
  amountTotal?: number | null
  currency?: string | null
  checkoutUrl?: string | null
  metadata?: Record<string, unknown>
}

export type BillingPaymentSessionRecord = BillingPaymentSessionRecordInput & {
  id: string
  amountRefunded: number
  createdAt: string
  updatedAt: string
}

export type BillingPaymentReconciliationInput = {
  provider: 'stripe'
  providerEventId: string
  eventType: string
  paymentSessionId?: string | null
  billingWebhookEventId?: string | null
  ledgerEntryId?: string | null
  tenantId?: string | null
  userId?: string | null
  membershipId?: string | null
  status: 'processed' | 'ignored' | 'failed'
  amount?: number | null
  currency?: string | null
  credits?: number | null
  message: string
  metadata?: Record<string, unknown>
}

export class BillingPaymentRepository {
  constructor(private readonly database: AccountDatabase) {}

  async findActiveMembership(userId: string, tenantId: string): Promise<BillingPaymentMembership | null> {
    const result = await this.database.query<BillingPaymentMembershipRow>(
      `
      SELECT
        m.id AS membership_id,
        m.tenant_id,
        m.user_id,
        ai.email,
        b.plan,
        b.credits
      FROM tenant_memberships m
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      JOIN billing_accounts b ON b.membership_id = m.id
      LEFT JOIN LATERAL (
        SELECT email
        FROM auth_identities ai
        WHERE ai.user_id = m.user_id
          AND ai.provider = 'local'
          AND ai.status = 'active'
        ORDER BY ai.is_primary DESC, ai.created_at ASC
        LIMIT 1
      ) ai ON true
      WHERE m.user_id = $1
        AND m.tenant_id = $2
        AND m.status = 'active'
      LIMIT 1
      `,
      [userId, tenantId],
    )
    return result.rows[0] ? toMembership(result.rows[0]) : null
  }

  async createCheckoutSession(input: BillingPaymentSessionRecordInput): Promise<BillingCheckoutSession> {
    const id = paymentSessionId(input.provider, input.providerSessionId)
    const result = await this.database.query<BillingPaymentSessionRow>(
      `
      INSERT INTO billing_payment_sessions (
        id,
        provider,
        provider_session_id,
        checkout_type,
        tenant_id,
        user_id,
        membership_id,
        provider_customer_id,
        provider_subscription_id,
        provider_payment_intent_id,
        status,
        plan,
        credits,
        amount_total,
        currency,
        checkout_url,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now())
      ON CONFLICT (provider, provider_session_id)
      DO UPDATE SET checkout_url = EXCLUDED.checkout_url,
                    status = EXCLUDED.status,
                    provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, billing_payment_sessions.provider_customer_id),
                    provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, billing_payment_sessions.provider_subscription_id),
                    provider_payment_intent_id = COALESCE(EXCLUDED.provider_payment_intent_id, billing_payment_sessions.provider_payment_intent_id),
                    amount_total = COALESCE(EXCLUDED.amount_total, billing_payment_sessions.amount_total),
                    currency = COALESCE(EXCLUDED.currency, billing_payment_sessions.currency),
                    metadata = billing_payment_sessions.metadata || EXCLUDED.metadata,
                    updated_at = now()
      RETURNING provider, checkout_type, provider_session_id, status, plan, credits, checkout_url
      `,
      [
        id,
        input.provider,
        input.providerSessionId,
        input.checkoutType,
        input.tenantId,
        input.userId,
        input.membershipId,
        input.providerCustomerId ?? null,
        input.providerSubscriptionId ?? null,
        input.providerPaymentIntentId ?? null,
        input.status,
        input.plan ?? null,
        input.credits ?? null,
        input.amountTotal ?? null,
        input.currency ?? null,
        input.checkoutUrl ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    )
    const row = result.rows[0]!
    return {
      provider: row.provider,
      checkoutType: row.checkout_type,
      checkoutSessionId: row.provider_session_id,
      url: row.checkout_url ?? '',
      status: row.status,
      plan: row.plan,
      credits: row.credits,
    }
  }

  async markCheckoutCompleted(input: {
    provider: 'stripe'
    providerSessionId: string
    providerCustomerId?: string | null
    providerSubscriptionId?: string | null
    providerPaymentIntentId?: string | null
    amountTotal?: number | null
    currency?: string | null
    metadata?: Record<string, unknown>
    completedAt?: string
  }): Promise<BillingPaymentSessionRecord | null> {
    const result = await this.database.query<BillingPaymentSessionRecordRow>(
      `
      UPDATE billing_payment_sessions
      SET status = 'completed',
          provider_customer_id = COALESCE($3, provider_customer_id),
          provider_subscription_id = COALESCE($4, provider_subscription_id),
          provider_payment_intent_id = COALESCE($5, provider_payment_intent_id),
          amount_total = COALESCE($6, amount_total),
          currency = COALESCE($7, currency),
          metadata = metadata || $8::jsonb,
          completed_at = COALESCE($9::timestamptz, completed_at, now()),
          updated_at = now()
      WHERE provider = $1
        AND provider_session_id = $2
      RETURNING *
      `,
      [
        input.provider,
        input.providerSessionId,
        input.providerCustomerId ?? null,
        input.providerSubscriptionId ?? null,
        input.providerPaymentIntentId ?? null,
        input.amountTotal ?? null,
        input.currency ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.completedAt ?? null,
      ],
    )
    return result.rows[0] ? toPaymentSessionRecord(result.rows[0]) : null
  }

  async markRefunded(input: {
    provider: 'stripe'
    providerPaymentIntentId: string
    amountRefunded: number
    refundedAt?: string
  }): Promise<BillingPaymentSessionRecord | null> {
    const result = await this.database.query<BillingPaymentSessionRecordRow>(
      `
      UPDATE billing_payment_sessions
      SET status = 'refunded',
          amount_refunded = GREATEST(amount_refunded, $3),
          refunded_at = COALESCE($4::timestamptz, refunded_at, now()),
          updated_at = now()
      WHERE provider = $1
        AND provider_payment_intent_id = $2
      RETURNING *
      `,
      [input.provider, input.providerPaymentIntentId, input.amountRefunded, input.refundedAt ?? null],
    )
    return result.rows[0] ? toPaymentSessionRecord(result.rows[0]) : null
  }

  async findBySubscriptionId(
    provider: 'stripe',
    providerSubscriptionId: string,
  ): Promise<BillingPaymentSessionRecord | null> {
    const result = await this.database.query<BillingPaymentSessionRecordRow>(
      `
      SELECT *
      FROM billing_payment_sessions
      WHERE provider = $1
        AND provider_subscription_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [provider, providerSubscriptionId],
    )
    return result.rows[0] ? toPaymentSessionRecord(result.rows[0]) : null
  }

  async findByPaymentIntentId(
    provider: 'stripe',
    providerPaymentIntentId: string,
  ): Promise<BillingPaymentSessionRecord | null> {
    const result = await this.database.query<BillingPaymentSessionRecordRow>(
      `
      SELECT *
      FROM billing_payment_sessions
      WHERE provider = $1
        AND provider_payment_intent_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [provider, providerPaymentIntentId],
    )
    return result.rows[0] ? toPaymentSessionRecord(result.rows[0]) : null
  }

  async recordReconciliation(input: BillingPaymentReconciliationInput): Promise<void> {
    await this.database.query(
      `
      INSERT INTO billing_payment_reconciliation_items (
        id,
        provider,
        provider_event_id,
        event_type,
        payment_session_id,
        billing_webhook_event_id,
        ledger_entry_id,
        tenant_id,
        user_id,
        membership_id,
        status,
        amount,
        currency,
        credits,
        message,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now())
      ON CONFLICT (provider, provider_event_id)
      DO UPDATE SET status = EXCLUDED.status,
                    payment_session_id = COALESCE(EXCLUDED.payment_session_id, billing_payment_reconciliation_items.payment_session_id),
                    billing_webhook_event_id = COALESCE(EXCLUDED.billing_webhook_event_id, billing_payment_reconciliation_items.billing_webhook_event_id),
                    ledger_entry_id = COALESCE(EXCLUDED.ledger_entry_id, billing_payment_reconciliation_items.ledger_entry_id),
                    tenant_id = COALESCE(EXCLUDED.tenant_id, billing_payment_reconciliation_items.tenant_id),
                    user_id = COALESCE(EXCLUDED.user_id, billing_payment_reconciliation_items.user_id),
                    membership_id = COALESCE(EXCLUDED.membership_id, billing_payment_reconciliation_items.membership_id),
                    amount = COALESCE(EXCLUDED.amount, billing_payment_reconciliation_items.amount),
                    currency = COALESCE(EXCLUDED.currency, billing_payment_reconciliation_items.currency),
                    credits = COALESCE(EXCLUDED.credits, billing_payment_reconciliation_items.credits),
                    message = EXCLUDED.message,
                    metadata = billing_payment_reconciliation_items.metadata || EXCLUDED.metadata,
                    updated_at = now()
      `,
      [
        paymentReconciliationId(input.provider, input.providerEventId),
        input.provider,
        input.providerEventId,
        input.eventType,
        input.paymentSessionId ?? null,
        input.billingWebhookEventId ?? null,
        input.ledgerEntryId ?? null,
        input.tenantId ?? null,
        input.userId ?? null,
        input.membershipId ?? null,
        input.status,
        input.amount ?? null,
        input.currency ?? null,
        input.credits ?? null,
        input.message,
        JSON.stringify(input.metadata ?? {}),
      ],
    )
  }
}

function paymentSessionId(provider: string, providerSessionId: string): string {
  return `payment-session-${provider}-${providerSessionId}`
}

function paymentReconciliationId(provider: string, providerEventId: string): string {
  return `payment-reconciliation-${provider}-${providerEventId}`
}

function toMembership(row: BillingPaymentMembershipRow): BillingPaymentMembership {
  return {
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    email: row.email,
    plan: row.plan,
    credits: row.credits,
  }
}

function toPaymentSessionRecord(row: BillingPaymentSessionRecordRow): BillingPaymentSessionRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    checkoutType: row.checkout_type,
    tenantId: row.tenant_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    providerPaymentIntentId: row.provider_payment_intent_id,
    status: row.status,
    plan: row.plan,
    credits: row.credits,
    amountTotal: row.amount_total,
    amountRefunded: row.amount_refunded,
    currency: row.currency,
    checkoutUrl: row.checkout_url,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

type BillingPaymentMembershipRow = {
  membership_id: string
  tenant_id: string
  user_id: string
  email: string | null
  plan: Plan
  credits: number
}

type BillingPaymentSessionRow = {
  provider: 'stripe'
  checkout_type: BillingCheckoutType
  provider_session_id: string
  status: BillingCheckoutSession['status']
  plan: Plan | null
  credits: number | null
  checkout_url: string | null
}

type BillingPaymentSessionRecordRow = BillingPaymentSessionRow &
  QueryResultRow & {
    id: string
    tenant_id: string
    user_id: string
    membership_id: string
    provider_customer_id: string | null
    provider_subscription_id: string | null
    provider_payment_intent_id: string | null
    amount_total: number | null
    amount_refunded: number
    currency: string | null
    metadata: Record<string, unknown> | string
    created_at: Date | string
    updated_at: Date | string
  }
