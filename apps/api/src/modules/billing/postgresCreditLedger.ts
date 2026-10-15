import type {
  BillingSummary,
  CheckoutSession,
  LedgerEntry,
  Plan,
  Principal,
  SubscriptionSummary,
  UsageSummary,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AppError } from '../../core/errors.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import {
  BILLING_PACKAGES,
  concurrencyForPlan,
  creditsForPlan,
  defaultSubscriptionForTenant,
  packageForPlan,
} from './catalog.js'
import {
  CHECKOUT_SESSION_COLUMNS,
  LEDGER_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  USER_COLUMNS,
  checkoutSessionFromRow,
  ledgerFromRow,
  subscriptionFromRow,
  userFromRow,
  type CheckoutSessionRow,
  type LedgerRow,
  type SubscriptionRow,
  type UserRow,
} from '../../infra/postgresRows.js'
import type { StoredUser } from '../../infra/store.js'
import type { CreditLedger } from './creditLedger.js'

export class PostgresCreditLedger implements CreditLedger {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async reserve(
    principal: Principal,
    credits: number,
    referenceId: string,
    description = 'Generation task',
  ): Promise<void> {
    await this.transactions.withTransaction(async (client) => {
      const ledgerId = `generation-${referenceId}`
      const existing = await client.query<{ id: string }>(
        `
          select id
          from ledger_entries
          where id = $1 and user_id = $2 and tenant_id = $3
          for update
        `,
        [ledgerId, principal.userId, principal.tenantId],
      )
      if (existing.rows[0]) return

      const user = await lockedUser(client, principal)
      const nextCredits = user.credits - credits
      if (nextCredits < 0) throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')

      const now = new Date().toISOString()
      await client.query(
        `
          update users
          set credits = $1, updated_at = $2
          where id = $3 and tenant_id = $4
        `,
        [nextCredits, now, user.id, user.tenantId],
      )
      await client.query(
        `
          insert into ledger_entries (
            id, user_id, tenant_id, amount, balance, type, description, created_at
          )
          values ($1, $2, $3, $4, $5, 'generation', $6, $7)
        `,
        [ledgerId, user.id, user.tenantId, -credits, nextCredits, description, now],
      )
    })
  }

  async summary(principal: Principal): Promise<BillingSummary> {
    return this.transactions.withTransaction(async (client) => {
      const user = await readableUser(client, principal)
      const entries = await recentLedgerEntries(client, user.id, user.tenantId)
      const subscription = await subscriptionForTenant(client, user.tenantId, user.plan)
      const usage = await usageSummaryForTenant(client, user.tenantId)
      const checkoutSessions = await recentCheckoutSessions(client, user.tenantId)
      return summaryFor(user, entries, subscription, checkoutSessions, usage)
    })
  }

  async updatePlan(principal: Principal, plan: Plan): Promise<BillingSummary> {
    return this.transactions.withTransaction(async (client) => {
      const user = await lockedUser(client, principal)
      const now = new Date().toISOString()
      const packageInfo = packageForPlan(plan)
      const planChanged = user.plan !== plan

      if (planChanged) {
        const grant = creditsForPlan(plan)
        if (grant > 0) {
          user.credits += grant
          await client.query(
            `
              insert into ledger_entries (
                id, user_id, tenant_id, amount, balance, type, description, created_at
              )
              values ($1, $2, $3, $4, $5, 'grant', $6, $7)
            `,
            [randomUUID(), user.id, user.tenantId, grant, user.credits, 'Subscription credits', now],
          )
        }
      }

      const updatedUser = await client.query<UserRow>(
        `
          update users
          set plan = $1, credits = $2, updated_at = $3
          where id = $4 and tenant_id = $5
          returning ${USER_COLUMNS}
        `,
        [plan, user.credits, now, user.id, user.tenantId],
      )
      const nextUser = userFromRow(updatedUser.rows[0]!)
      await upsertSubscription(client, principal.tenantId, plan, packageInfo, now)

      const entries = await recentLedgerEntries(client, nextUser.id, nextUser.tenantId)
      const subscription = await subscriptionForTenant(client, nextUser.tenantId, nextUser.plan)
      const usage = await usageSummaryForTenant(client, nextUser.tenantId)
      const checkoutSessions = await recentCheckoutSessions(client, nextUser.tenantId)
      return summaryFor(nextUser, entries, subscription, checkoutSessions, usage)
    })
  }
}

async function readableUser(client: PoolClient, principal: Principal): Promise<StoredUser> {
  const result = await client.query<UserRow>(
    `
      select ${USER_COLUMNS}
      from users
      where id = $1 and tenant_id = $2
    `,
    [principal.userId, principal.tenantId],
  )
  if (!result.rows[0]) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')
  return userFromRow(result.rows[0])
}

async function lockedUser(client: PoolClient, principal: Principal): Promise<StoredUser> {
  const result = await client.query<UserRow>(
    `
      select ${USER_COLUMNS}
      from users
      where id = $1 and tenant_id = $2
      for update
    `,
    [principal.userId, principal.tenantId],
  )
  if (!result.rows[0]) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account not found')
  return userFromRow(result.rows[0])
}

async function recentLedgerEntries(
  client: PoolClient,
  userId: string,
  tenantId: string,
): Promise<LedgerEntry[]> {
  const result = await client.query<LedgerRow>(
    `
      select ${LEDGER_COLUMNS}
      from ledger_entries
      where user_id = $1 and tenant_id = $2
      order by created_at desc, id
      limit 30
    `,
    [userId, tenantId],
  )
  return result.rows.map(ledgerFromRow)
}

async function recentCheckoutSessions(client: PoolClient, tenantId: string): Promise<CheckoutSession[]> {
  const result = await client.query<CheckoutSessionRow>(
    `
      select ${CHECKOUT_SESSION_COLUMNS}
      from billing_checkout_sessions
      where tenant_id = $1
      order by created_at desc, id
      limit 20
    `,
    [tenantId],
  )
  return result.rows.map(checkoutSessionFromRow)
}

async function subscriptionForTenant(
  client: PoolClient,
  tenantId: string,
  plan: Plan,
): Promise<SubscriptionSummary> {
  const result = await client.query<SubscriptionRow>(
    `
      select ${SUBSCRIPTION_COLUMNS}
      from billing_subscriptions
      where tenant_id = $1
    `,
    [tenantId],
  )
  const stored = result.rows[0]
  if (!stored) {
    const fallback = defaultSubscriptionForTenant(tenantId)
    const packageInfo = packageForPlan(plan)
    return {
      ...fallback,
      packageId: plan,
      seatLimit: packageInfo.seats,
      watermarkRequired: packageInfo.watermarkRequired,
      commercialLicenseEnabled: packageInfo.commercialLicenseIncluded,
    }
  }
  const packageInfo = packageForPlan(stored.packageId || plan)
  return {
    ...subscriptionFromRow(stored),
    seatLimit: packageInfo.seats,
    watermarkRequired: packageInfo.watermarkRequired,
    commercialLicenseEnabled: packageInfo.commercialLicenseIncluded,
  }
}

async function upsertSubscription(
  client: PoolClient,
  tenantId: string,
  plan: Plan,
  packageInfo = packageForPlan(plan),
  now = new Date().toISOString(),
): Promise<void> {
  const current = await client.query<SubscriptionRow>(
    `
      select ${SUBSCRIPTION_COLUMNS}
      from billing_subscriptions
      where tenant_id = $1
    `,
    [tenantId],
  )
  const existing = current.rows[0]
  const next = {
    tenantId,
    provider: existing?.provider ?? 'mock',
    packageId: plan,
    status: existing?.status ?? 'active',
    billingCycle: existing?.billingCycle ?? 'monthly',
    seatLimit: packageInfo.seats,
    activeSeats: await activeSeatCount(client, tenantId),
    watermarkRequired: packageInfo.watermarkRequired,
    commercialLicenseEnabled: packageInfo.commercialLicenseIncluded,
    startsAt: existing?.startsAt ? toIso(existing.startsAt) : now,
    renewsAt: existing?.renewsAt ? toIsoNullable(existing.renewsAt) : null,
    updatedAt: now,
  } satisfies SubscriptionSummary

  await client.query(
    `
      insert into billing_subscriptions (
        tenant_id, provider, package_id, status, billing_cycle, seat_limit,
        active_seats, watermark_required, commercial_license_enabled,
        starts_at, renews_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (tenant_id) do update set
        provider = excluded.provider,
        package_id = excluded.package_id,
        status = excluded.status,
        billing_cycle = excluded.billing_cycle,
        seat_limit = excluded.seat_limit,
        active_seats = excluded.active_seats,
        watermark_required = excluded.watermark_required,
        commercial_license_enabled = excluded.commercial_license_enabled,
        starts_at = excluded.starts_at,
        renews_at = excluded.renews_at,
        updated_at = excluded.updated_at
    `,
    [
      next.tenantId,
      next.provider,
      next.packageId,
      next.status,
      next.billingCycle,
      next.seatLimit,
      next.activeSeats,
      next.watermarkRequired,
      next.commercialLicenseEnabled,
      next.startsAt,
      next.renewsAt,
      next.updatedAt,
    ],
  )
}

async function activeSeatCount(client: PoolClient, tenantId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from users
      where tenant_id = $1
    `,
    [tenantId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function usageSummaryForTenant(client: PoolClient, tenantId: string): Promise<UsageSummary> {
  const credits = await client.query<{ total: string | null }>(
    `
      select coalesce(sum(amount), 0)::text as total
      from ledger_entries
      where tenant_id = $1 and amount < 0
    `,
    [tenantId],
  )
  const tasks = await client.query<{ kind: string; count: string }>(
    `
      select kind, count(*)::text as count
      from generation_tasks
      where tenant_id = $1
      group by kind
    `,
    [tenantId],
  )
  const watermarkTasks = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from generation_tasks
      where tenant_id = $1
        and coalesce((metadata->>'watermark')::boolean, false) = true
    `,
    [tenantId],
  )
  const shares = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from project_shares
      where tenant_id = $1 and status = 'active'
    `,
    [tenantId],
  )
  const comments = await client.query<{ count: string }>(
    `
      select count(*)::text as count
      from project_comments
      where tenant_id = $1 and status = 'pending'
    `,
    [tenantId],
  )

  const taskCounts = new Map(tasks.rows.map((row) => [row.kind, Number(row.count ?? 0)]))
  return {
    generatedAt: new Date().toISOString(),
    periodDays: 30,
    creditsSpent: Math.abs(Number(credits.rows[0]?.total ?? 0)),
    tasksCreated: [...taskCounts.values()].reduce((total, value) => total + value, 0),
    imageTasks: taskCounts.get('image') ?? 0,
    videoTasks: taskCounts.get('video') ?? 0,
    audioTasks: taskCounts.get('audio') ?? 0,
    activeShares: Number(shares.rows[0]?.count ?? 0),
    pendingComments: Number(comments.rows[0]?.count ?? 0),
    activeMembers: await activeSeatCount(client, tenantId),
    watermarkTasks: Number(watermarkTasks.rows[0]?.count ?? 0),
  }
}

function summaryFor(
  user: StoredUser,
  entries: LedgerEntry[],
  subscription: SubscriptionSummary,
  checkoutSessions: CheckoutSession[],
  usage: UsageSummary,
): BillingSummary {
  return {
    plan: user.plan,
    credits: user.credits,
    concurrency: concurrencyForPlan(user.plan),
    entries,
    subscription,
    packages: BILLING_PACKAGES,
    checkoutSessions,
    usage,
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toIsoNullable(value: Date | string | null): string | null {
  return value === null ? null : toIso(value)
}
