import type { AppConfig } from '../config.js'
import {
  accountSessionSchema,
  adminAuditLogEntrySchema,
  adminAuditLogEntryListSchema,
  adminBillingAccountListSchema,
  adminBillingLedgerEntryListSchema,
  adminBillingPaymentReconciliationListSchema,
  adminBillingReconciliationAlertListSchema,
  adminConsoleSchema,
  adminMembershipListSchema,
  adminOrganizationListSchema,
  adminOverviewSchema,
  adminSessionSchema,
  adminSessionListSchema,
  adminUserSchema,
  adminUserListSchema,
  billingCheckoutSessionSchema,
  billingPaymentConfigurationSchema,
  billingSummarySchema,
  membershipSchema,
  generationTaskSchema,
  sessionSummarySchema,
  projectWorkspaceSchema,
  sessionSchema,
  workspaceMembershipSchema,
} from '@seqora/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { AppStore } from '../infra/store.js'
import { ProjectRepository } from '../modules/projects/repository.js'
import { UserRepository } from '../modules/users/repository.js'
import type {
  BillingPaymentCheckoutInput,
  BillingPaymentWebhookEvent,
  BillingPaymentProvider,
} from '../modules/billing/paymentProvider.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../testing/postgresAuth.js'
import { createJsonSchemaValidator } from '../testing/jsonSchema.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let authDatabase: PostgresAuthFixture | undefined

const assertSession = createJsonSchemaValidator(sessionSchema, 'auth.session')
const assertAccountSession = createJsonSchemaValidator(accountSessionSchema, 'auth.accountSession')
const assertOrganizationMembershipList = createJsonSchemaValidator(
  z.array(workspaceMembershipSchema),
  'organizations.list',
)
const assertMembershipList = createJsonSchemaValidator(z.array(membershipSchema), 'organizations.members')
const assertSessionSummaryList = createJsonSchemaValidator(z.array(sessionSummarySchema), 'sessions.list')
const assertBillingSummary = createJsonSchemaValidator(billingSummarySchema, 'billing.summary')
const assertBillingPaymentConfiguration = createJsonSchemaValidator(
  billingPaymentConfigurationSchema,
  'billing.payment.configuration',
)
const assertBillingCheckoutSession = createJsonSchemaValidator(
  billingCheckoutSessionSchema,
  'billing.checkout.session',
)
const assertProjectWorkspace = createJsonSchemaValidator(projectWorkspaceSchema, 'projects.workspace')
const assertAdminOverview = createJsonSchemaValidator(adminOverviewSchema, 'admin.overview')
const assertAdminConsole = createJsonSchemaValidator(adminConsoleSchema, 'admin.console')
const assertAdminUserList = createJsonSchemaValidator(adminUserListSchema, 'admin.users')
const assertAdminOrganizationList = createJsonSchemaValidator(
  adminOrganizationListSchema,
  'admin.organizations',
)
const assertAdminMembershipList = createJsonSchemaValidator(adminMembershipListSchema, 'admin.memberships')
const assertAdminBillingAccountList = createJsonSchemaValidator(
  adminBillingAccountListSchema,
  'admin.billing.accounts',
)
const assertAdminBillingLedgerEntryList = createJsonSchemaValidator(
  adminBillingLedgerEntryListSchema,
  'admin.billing.ledger',
)
const assertAdminBillingPaymentReconciliationList = createJsonSchemaValidator(
  adminBillingPaymentReconciliationListSchema,
  'admin.billing.reconciliation',
)
const assertAdminBillingReconciliationAlertList = createJsonSchemaValidator(
  adminBillingReconciliationAlertListSchema,
  'admin.billing.reconciliationAlerts',
)
const assertAdminSessionList = createJsonSchemaValidator(adminSessionListSchema, 'admin.sessions')
const assertAdminSession = createJsonSchemaValidator(adminSessionSchema, 'admin.session')
const assertAdminAuditLogEntryList = createJsonSchemaValidator(
  adminAuditLogEntryListSchema,
  'admin.auditLogs',
)
const assertAdminAuditLogEntry = createJsonSchemaValidator(adminAuditLogEntrySchema, 'admin.auditLog')
const assertGenerationTask = createJsonSchemaValidator(generationTaskSchema, 'generation.task')

const chromeWindowsUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
const firefoxMacUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:143.0) Gecko/20100101 Firefox/143.0'

beforeAll(async () => {
  authDatabase = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await authDatabase?.reset()
  await seedProjectWorkspace()
  app = await buildContractApp()
})

afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(resolve('./data/test-uploads'), { recursive: true, force: true })
})

afterAll(async () => {
  await authDatabase?.close()
})

describe('api contract layer', { timeout: 30_000 }, () => {
  it('validates successful HTTP payloads against strict JSON Schema', async () => {
    const member = await login('member@seqora.local', 'MemberPassword123!')
    assertSession(member.json())

    const me = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(member) },
    })
    expect(me.statusCode).toBe(200)
    assertSession(me.json())

    const project = await app!.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers: { cookie: cookieValue(member) },
    })
    expect(project.statusCode).toBe(200)
    assertProjectWorkspace(project.json())

    const authSessions = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: cookieValue(member) },
    })
    expect(authSessions.statusCode).toBe(200)
    assertSessionSummaryList(authSessions.json())

    const summary = await app!.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: cookieValue(member) },
    })
    expect(summary.statusCode).toBe(200)
    assertBillingSummary(summary.json())

    const paymentConfiguration = await app!.inject({
      method: 'GET',
      url: '/api/v1/billing/payment/configuration',
      headers: { cookie: cookieValue(member) },
    })
    expect(paymentConfiguration.statusCode).toBe(200)
    const paymentConfig = assertBillingPaymentConfiguration(paymentConfiguration.json())
    expect(paymentConfig.provider).toBe('stripe')

    const subscriptionCheckout = await app!.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout/subscription',
      headers: { cookie: cookieValue(member) },
    })
    expect(subscriptionCheckout.statusCode).toBe(201)
    assertBillingCheckoutSession(subscriptionCheckout.json())

    const creditCheckout = await app!.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout/credits',
      headers: { cookie: cookieValue(member) },
      payload: paymentConfig.creditPackCredits === null ? {} : { credits: paymentConfig.creditPackCredits },
    })
    expect(creditCheckout.statusCode).toBe(201)
    assertBillingCheckoutSession(creditCheckout.json())
  })

  it('validates organization and session payloads against strict JSON Schema', async () => {
    const admin = await login('admin@seqora.local', 'Admin123!')

    const createdOrganization = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: cookieValue(admin) },
      payload: { name: 'Contract Organization' },
    })
    expect(createdOrganization.statusCode).toBe(201)
    assertAccountSession(createdOrganization.json())

    const organizations = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations',
      headers: { cookie: cookieValue(admin) },
    })
    expect(organizations.statusCode).toBe(200)
    assertOrganizationMembershipList(organizations.json())

    const members = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/tenant-seqora-demo/members',
      headers: { cookie: cookieValue(admin) },
    })
    expect(members.statusCode).toBe(200)
    assertMembershipList(members.json())

    const sessions = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/tenant-seqora-demo/sessions',
      headers: { cookie: cookieValue(admin) },
    })
    expect(sessions.statusCode).toBe(200)
    assertSessionSummaryList(sessions.json())
  })

  it('validates admin console payloads against strict JSON Schema', async () => {
    const admin = await login('admin@seqora.local', 'Admin123!')

    const overview = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie: cookieValue(admin) },
    })
    expect(overview.statusCode).toBe(200)
    assertAdminOverview(overview.json())

    const consoleSnapshot = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/console?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(consoleSnapshot.statusCode).toBe(200)
    assertAdminConsole(consoleSnapshot.json())

    const users = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/users?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(users.statusCode).toBe(200)
    assertAdminUserList(users.json())

    const organizations = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(organizations.statusCode).toBe(200)
    assertAdminOrganizationList(organizations.json())

    const memberships = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/memberships?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(memberships.statusCode).toBe(200)
    assertAdminMembershipList(memberships.json())

    const billingAccounts = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/accounts?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(billingAccounts.statusCode).toBe(200)
    assertAdminBillingAccountList(billingAccounts.json())

    const billingLedger = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/ledger?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(billingLedger.statusCode).toBe(200)
    assertAdminBillingLedgerEntryList(billingLedger.json())

    const billingReconciliation = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/reconciliation?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(billingReconciliation.statusCode).toBe(200)
    assertAdminBillingPaymentReconciliationList(billingReconciliation.json())

    const reconciliationAlerts = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/reconciliation-alerts?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(reconciliationAlerts.statusCode).toBe(200)
    assertAdminBillingReconciliationAlertList(reconciliationAlerts.json())

    const sessions = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(sessions.statusCode).toBe(200)
    assertAdminSessionList(sessions.json())

    const auditLogs = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs?limit=10',
      headers: { cookie: cookieValue(admin) },
    })
    expect(auditLogs.statusCode).toBe(200)
    assertAdminAuditLogEntryList(auditLogs.json())
  })

  it('validates session device info, kick-out, forced password change and audit logs', async () => {
    const admin = await login('admin@seqora.local', 'Admin123!', chromeWindowsUserAgent)
    const member = await login('member@seqora.local', 'MemberPassword123!', firefoxMacUserAgent)
    const adminHeaders = {
      cookie: cookieValue(admin),
      'user-agent': chromeWindowsUserAgent,
    }

    const ownSessions = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: cookieValue(member) },
    })
    expect(ownSessions.statusCode).toBe(200)
    const ownSessionList = assertSessionSummaryList(ownSessions.json())
    expect(ownSessionList[0]).toMatchObject({
      userId: 'user-member',
      current: true,
      userAgent: firefoxMacUserAgent,
      deviceLabel: 'Firefox on macOS',
      ipAddress: expect.any(String),
    })

    const adminSessions = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?userId=user-member&status=active',
      headers: { cookie: cookieValue(admin) },
    })
    expect(adminSessions.statusCode).toBe(200)
    const adminSessionPayload = assertAdminSessionList(adminSessions.json())
    const targetSession = adminSessionPayload.items.find((session) => session.userId === 'user-member')
    expect(targetSession).toBeDefined()
    const parsedSession = assertAdminSession(targetSession)
    expect(parsedSession).toMatchObject({
      userId: 'user-member',
      status: 'active',
      current: false,
      userAgent: firefoxMacUserAgent,
      deviceLabel: 'Firefox on macOS',
      ipAddress: expect.any(String),
    })

    const revokedSession = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${parsedSession.sessionId}`,
      headers: adminHeaders,
    })
    expect(revokedSession.statusCode).toBe(204)

    const revokedAudit = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs?action=admin.session.revoked&userId=user-member',
      headers: adminHeaders,
    })
    expect(revokedAudit.statusCode).toBe(200)
    const revokedAuditList = assertAdminAuditLogEntryList(revokedAudit.json())
    const revokedAuditEntry = assertAdminAuditLogEntry(revokedAuditList.items[0])
    expect(revokedAuditEntry).toMatchObject({
      action: 'admin.session.revoked',
      resourceType: 'session',
      resourceId: parsedSession.sessionId,
      actorUserId: 'user-admin',
      userAgent: chromeWindowsUserAgent,
    })
    expect(revokedAuditEntry.metadata).toMatchObject({ scope: 'admin_console' })

    const forceReset = await app!.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-member/password-reset-requirement',
      headers: adminHeaders,
      payload: {
        required: true,
        revokeSessions: true,
      },
    })
    expect(forceReset.statusCode).toBe(200)
    expect(adminUserSchema.parse(forceReset.json())).toMatchObject({
      id: 'user-member',
      passwordResetRequired: true,
    })

    const temporaryPassword = await app!.inject({
      method: 'PUT',
      url: '/api/v1/admin/users/user-member/password',
      headers: adminHeaders,
      payload: {
        newPassword: 'MemberTempPassword123!',
        requireChange: true,
        revokeSessions: true,
      },
    })
    expect(temporaryPassword.statusCode).toBe(200)
    expect(adminUserSchema.parse(temporaryPassword.json())).toMatchObject({
      id: 'user-member',
      passwordResetRequired: true,
    })

    const passwordAudit = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs?action=admin.password.temporary_set&userId=user-member',
      headers: adminHeaders,
    })
    expect(passwordAudit.statusCode).toBe(200)
    const passwordAuditList = assertAdminAuditLogEntryList(passwordAudit.json())
    const passwordAuditEntry = assertAdminAuditLogEntry(passwordAuditList.items[0])
    expect(passwordAuditEntry).toMatchObject({
      action: 'admin.password.temporary_set',
      resourceType: 'auth_identity',
      actorUserId: 'user-admin',
      userAgent: chromeWindowsUserAgent,
    })
    expect(passwordAuditEntry.metadata).toMatchObject({
      requireChange: true,
      revokedSessionCount: expect.any(Number),
      scope: 'admin_console',
    })
  })

  it('rejects missing fields, boundary values and SQL-injection style inputs', async () => {
    const missingPassword = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local' },
    })
    expect(missingPassword.statusCode).toBe(400)
    expect(missingPassword.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })

    const member = await login('member@seqora.local', 'MemberPassword123!')
    const tooLongName = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: cookieValue(member) },
      payload: {
        name: 'A'.repeat(121),
        contentType: 'short-drama',
        aspectRatio: '9:16',
      },
    })
    expect(tooLongName.statusCode).toBe(400)
    expect(tooLongName.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })

    const admin = await login('admin@seqora.local', 'Admin123!')
    const injection = await app!.inject({
      method: 'GET',
      url: `/api/v1/admin/users?q=${encodeURIComponent("' OR 1=1 --")}&limit=10`,
      headers: { cookie: cookieValue(admin) },
    })
    expect(injection.statusCode).toBe(200)
    assertAdminUserList(injection.json())
    expect(injection.json().meta.total).toBeLessThanOrEqual(4)
  })

  it('keeps generation task submission idempotent by clientRequestId', async () => {
    const member = await login('member@seqora.local', 'MemberPassword123!')
    const beforeSummary = await app!.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: cookieValue(member) },
    })
    expect(beforeSummary.statusCode).toBe(200)
    assertBillingSummary(beforeSummary.json())

    const payload = {
      clientRequestId: 'api-contract-idempotent-task',
      projectId: 'project-midnight-film',
      kind: 'image' as const,
      label: 'API contract idempotency task',
      provider: 'img2',
      estimatedCredits: 4,
    }

    const first = await app!.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { cookie: cookieValue(member) },
      payload,
    })
    expect(first.statusCode).toBe(202)
    assertGenerationTask(first.json())

    const second = await app!.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { cookie: cookieValue(member) },
      payload,
    })
    expect(second.statusCode).toBe(202)
    assertGenerationTask(second.json())
    expect(second.json()).toMatchObject({
      id: first.json().id,
      clientRequestId: payload.clientRequestId,
      estimatedCredits: 4,
    })

    const afterSummary = await app!.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: cookieValue(member) },
    })
    expect(afterSummary.statusCode).toBe(200)
    assertBillingSummary(afterSummary.json())
    expect(afterSummary.json().credits).toBe(beforeSummary.json().credits - 4)
  })
})

async function buildContractApp() {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  return await buildApp({
    config: localContractConfig(),
    store: new AppStore(null),
    startWorker: false,
    paymentProvider: new FakeStripeProvider(),
  })
}

function localContractConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    DATABASE_URL: authDatabase.connectionString,
    DATA_FILE: ':memory:',
    STORAGE_DRIVER: 'local',
    EMAIL_PROVIDER: 'none',
    PAYMENT_PROVIDER: 'none',
    UPLOAD_DIR: resolve('./data/test-uploads'),
    ...overrides,
  })
}

async function seedProjectWorkspace(): Promise<void> {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  const store = new AppStore(null)
  await store.initialize()
  await withDatabase(async (database) => {
    const users = new UserRepository(store, database)
    await users.bootstrapFromStore()
    const projects = new ProjectRepository(store, database)
    await projects.importFromStore()
  })
}

async function login(email: string, password: string, userAgent?: string) {
  if (!app) throw new Error('App is not ready')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: userAgent ? { 'user-agent': userAgent } : undefined,
    payload: { email, password },
  })
  expect(response.statusCode).toBe(200)
  assertSession(response.json())
  return response
}

async function withDatabase<T>(operation: (database: AccountDatabase) => Promise<T>): Promise<T> {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  const database = new AccountDatabase(authDatabase.connectionString)
  try {
    return await operation(database)
  } finally {
    await database.close()
  }
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}

class FakeStripeProvider implements BillingPaymentProvider {
  readonly provider = 'stripe' as const

  async createCheckoutSession(
    input: BillingPaymentCheckoutInput,
  ): Promise<Awaited<ReturnType<BillingPaymentProvider['createCheckoutSession']>>> {
    const id = `cs_test_${input.checkoutType}_${input.membershipId}`
    return {
      id,
      url: `https://checkout.stripe.test/${id}`,
      status: 'open',
      customerId: `cus_${input.membershipId}`,
      subscriptionId: input.checkoutType === 'subscription' ? `sub_${input.membershipId}` : null,
      paymentIntentId: input.checkoutType === 'credits' ? `pi_${input.membershipId}` : null,
      amountTotal: input.checkoutType === 'credits' ? 2_000 : 12_000,
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
      throw new Error('Invalid webhook signature')
    }
    const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) as {
      id: string
      type: string
      createdAt: string
      data: Record<string, unknown>
    }
    return {
      id: parsed.id,
      type: parsed.type,
      createdAt: parsed.createdAt,
      data: parsed.data,
    }
  }
}
