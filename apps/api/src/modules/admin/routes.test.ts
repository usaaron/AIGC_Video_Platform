import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { usageCollector } from '../../core/observability/usage.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { BillingPaymentRepository } from '../billing/paymentRepository.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let authDatabase: PostgresAuthFixture | undefined

beforeAll(async () => {
  authDatabase = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await authDatabase?.reset()
  usageCollector.resetForTests()
})

afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(resolve('./data/test-uploads'), { recursive: true, force: true })
})

afterAll(async () => {
  await authDatabase?.close()
})

describe('admin console api', { timeout: 30_000 }, () => {
  it('returns a unified admin console snapshot', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!', {
      'user-agent': 'ConsoleAdminBrowser/1.0',
    })
    const member = await login('member@seqora.local', 'MemberPassword123!', {
      'user-agent': 'MemberDevice/1.0',
    })
    const adminCookie = cookieValue(admin)

    const anonymousAccess = await app.inject({ method: 'GET', url: '/api/v1/admin/access' })
    expect(anonymousAccess.statusCode).toBe(401)
    const memberAccess = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/access',
      headers: { cookie: cookieValue(member) },
    })
    expect(memberAccess.statusCode).toBe(403)
    const adminAccess = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/access',
      headers: { cookie: adminCookie },
    })
    expect(adminAccess.statusCode).toBe(204)

    const personalMember = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'admin-visible-member@example.com',
        name: 'Admin Visible Member',
        password: 'AdminVisibleMember123!',
        role: 'member',
      },
    })
    expect(personalMember.statusCode).toBe(201)
    const personalMemberUserId = personalMember.json().userId as string
    const personalMemberMembershipId = personalMember.json().id as string
    const personalMemberTenantId = personalMember.json().tenantId as string
    const personalMemberLogin = await login('admin-visible-member@example.com', 'AdminVisibleMember123!', {
      'user-agent': 'AdminVisibleMemberDevice/1.0',
    })
    expect(personalMemberLogin.statusCode).toBe(200)

    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/console?limit=10',
      headers: { cookie: adminCookie },
    })
    expect(snapshot.statusCode).toBe(200)
    expect(snapshot.json()).toMatchObject({
      overview: {
        users: 1,
        activeTasks: expect.any(Number),
        creditsConsumedToday: expect.any(Number),
        generatedAt: expect.any(String),
      },
      users: {
        meta: expect.objectContaining({ limit: 10, offset: 0 }),
        items: expect.arrayContaining([
          expect.objectContaining({
            id: personalMemberUserId,
            email: 'admin-visible-member@example.com',
            roles: ['member'],
          }),
        ]),
      },
      tenants: {
        items: [expect.objectContaining({ id: personalMemberTenantId, status: 'active', organizationType: 'personal' })],
      },
      organizations: {
        items: [expect.objectContaining({ id: personalMemberTenantId, status: 'active', organizationType: 'personal' })],
      },
      memberships: {
        items: expect.arrayContaining([
          expect.objectContaining({
            id: personalMemberMembershipId,
            organizationId: personalMemberTenantId,
          }),
        ]),
      },
      billingAccounts: {
        items: expect.arrayContaining([
          expect.objectContaining({ membershipId: personalMemberMembershipId }),
        ]),
      },
      sessions: {
        items: expect.arrayContaining([
          expect.objectContaining({
            userId: personalMemberUserId,
            tenantId: personalMemberTenantId,
            status: 'active',
            current: false,
            userAgent: 'AdminVisibleMemberDevice/1.0',
          }),
        ]),
      },
      auditLogs: {
        items: expect.arrayContaining([
          expect.objectContaining({ action: 'auth.login.succeeded', resourceType: 'session' }),
        ]),
      },
      generatedAt: expect.any(String),
    })
  })

  it('returns realtime, user, and organization usage summaries for the admin console', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)
    const occurredAt = Date.now() - 1_000

    const personalMember = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'usage-personal-member@example.com',
        name: 'Usage Personal Member',
        password: 'UsagePersonalMember123!',
        role: 'member',
      },
    })
    expect(personalMember.statusCode).toBe(201)
    const personalMemberUserId = personalMember.json().userId as string
    const personalMemberTenantId = personalMember.json().tenantId as string

    usageCollector.finishApiRequest({
      requestId: 'usage-api-request',
      method: 'POST',
      route: '/api/v1/projects',
      statusCode: 500,
      durationMs: 45,
      tenantId: personalMemberTenantId,
      organizationId: personalMemberTenantId,
      userId: personalMemberUserId,
      traceId: 'trace-usage-api',
      now: occurredAt,
    })
    usageCollector.recordProviderTokenUsage({
      provider: 'test-provider',
      operation: 'text.generate',
      tenantId: personalMemberTenantId,
      organizationId: personalMemberTenantId,
      userId: personalMemberUserId,
      inputTokens: 10,
      outputTokens: 15,
      totalTokens: 25,
      now: occurredAt,
    })
    usageCollector.startJob({
      jobId: 'usage-generation-task',
      source: 'generation_task',
      kind: 'image',
      tenantId: personalMemberTenantId,
      organizationId: personalMemberTenantId,
      userId: personalMemberUserId,
      now: occurredAt,
    })
    usageCollector.finishJob({
      jobId: 'usage-generation-task',
      source: 'generation_task',
      kind: 'image',
      status: 'completed',
      creditsUsed: 6,
      tenantId: personalMemberTenantId,
      organizationId: personalMemberTenantId,
      userId: personalMemberUserId,
      now: occurredAt,
    })

    const usage = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/usage?range=today&limit=20',
      headers: { cookie: adminCookie },
    })

    expect(usage.statusCode).toBe(200)
    expect(usage.json()).toMatchObject({
      range: 'today',
      global: {
        subjectType: 'global',
        range: 'today',
        metrics: {
          requestCount: 1,
          errorCount: 1,
          errorRate: 1,
          jobCount: 1,
          jobFailedCount: 0,
          creditsUsed: 6,
          inputTokens: 10,
          outputTokens: 15,
          totalTokens: 25,
          tpm: 25,
        },
      },
      organizations: expect.arrayContaining([
        expect.objectContaining({
          subjectType: 'organization',
          organizationId: personalMemberTenantId,
          metrics: expect.objectContaining({ requestCount: 1, jobCount: 1, creditsUsed: 6 }),
        }),
      ]),
      users: expect.arrayContaining([
        expect.objectContaining({
          subjectType: 'user',
          userId: personalMemberUserId,
          metrics: expect.objectContaining({ requestCount: 1, jobCount: 1, totalTokens: 25 }),
        }),
      ]),
    })
  })

  it('reads admin and observability summaries from Postgres instead of JSON runtime state', async () => {
    const store = new AppStore(null)
    app = await buildApp({ config: localAuthConfig(), store, startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)
    const now = new Date().toISOString()

    await store.mutate((state) => {
      state.tasks.unshift({
        id: 'json-only-running-task',
        clientRequestId: 'json-only-running-task',
        projectId: 'project-json-only',
        tenantId: 'tenant-seqora-demo',
        userId: 'user-member',
        kind: 'video',
        label: 'JSON only running task',
        prompt: 'This task exists only in app.json',
        negativePrompt: '',
        provider: 'local',
        model: null,
        tier: null,
        metadata: {},
        status: 'running',
        progress: 25,
        estimatedCredits: 999,
        createdAt: now,
        updatedAt: now,
        resultUrl: null,
        outputs: [],
        error: null,
      })
      state.ledger.unshift({
        id: 'json-only-generation-debit',
        userId: 'user-member',
        tenantId: 'tenant-seqora-demo',
        amount: -999,
        balance: 0,
        type: 'generation',
        description: 'JSON only debit',
        createdAt: now,
      })
    })

    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie: adminCookie },
    })
    expect(overview.statusCode).toBe(200)
    expect(overview.json()).toMatchObject({
      activeTasks: 0,
      creditsConsumedToday: 0,
    })

    const metrics = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { cookie: adminCookie },
    })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.json().daily).toMatchObject({
      creditsConsumed: 0,
      generationTasks: expect.objectContaining({ created: 0, terminal: 0 }),
    })
  })

  it('lists users, tenants, memberships and billing records', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)

    const createdPersonalMember = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'personal-admin-visible@example.com',
        name: 'Personal Admin Visible',
        password: 'PersonalAdminVisible123!',
        role: 'member',
      },
    })
    expect(createdPersonalMember.statusCode).toBe(201)
    const personalMemberUserId = createdPersonalMember.json().userId as string
    const personalMemberMembershipId = createdPersonalMember.json().id as string
    const personalMemberTenantId = createdPersonalMember.json().tenantId as string
    const personalMemberLogin = await login('personal-admin-visible@example.com', 'PersonalAdminVisible123!')
    expect(personalMemberLogin.statusCode).toBe(200)

    const users = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?q=personal-admin-visible&limit=100',
      headers: { cookie: adminCookie },
    })
    expect(users.statusCode).toBe(200)
    expect(users.json()).toMatchObject({
      meta: { total: 1, limit: 100, offset: 0 },
      items: [
        expect.objectContaining({
          id: personalMemberUserId,
          email: 'personal-admin-visible@example.com',
          status: 'active',
          roles: ['member'],
        }),
      ],
    })

    const memberUsers = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users?tenantId=${personalMemberTenantId}&role=member&limit=100`,
      headers: { cookie: adminCookie },
    })
    expect(memberUsers.statusCode).toBe(200)
    expect(memberUsers.json().items.map((item: { id: string }) => item.id)).toEqual([personalMemberUserId])

    const tenants = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations?tenantId=${personalMemberTenantId}`,
      headers: { cookie: adminCookie },
    })
    expect(tenants.statusCode).toBe(200)
    expect(tenants.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: personalMemberTenantId,
          status: 'active',
          organizationType: 'personal',
        }),
      ],
    })

    const organizations = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations?tenantId=${personalMemberTenantId}`,
      headers: { cookie: adminCookie },
    })
    expect(organizations.statusCode).toBe(200)
    expect(organizations.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: personalMemberTenantId,
          status: 'active',
          organizationType: 'personal',
        }),
      ],
    })

    const memberships = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/memberships?tenantId=${personalMemberTenantId}&role=member`,
      headers: { cookie: adminCookie },
    })
    expect(memberships.statusCode).toBe(200)
    expect(memberships.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: personalMemberMembershipId,
          userId: personalMemberUserId,
          email: 'personal-admin-visible@example.com',
          plan: 'free',
          credits: 0,
          organizationType: 'personal',
        }),
      ],
    })

    const adjusted = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/billing/memberships/${personalMemberMembershipId}/adjustments`,
      headers: { cookie: adminCookie },
      payload: {
        amount: 15,
        reason: 'Admin console audit top-up',
      },
    })
    expect(adjusted.statusCode).toBe(200)

    const billingAccounts = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/accounts?membershipId=${personalMemberMembershipId}`,
      headers: { cookie: adminCookie },
    })
    expect(billingAccounts.statusCode).toBe(200)
    expect(billingAccounts.json()).toMatchObject({
      items: [
        expect.objectContaining({
          membershipId: personalMemberMembershipId,
          credits: 15,
          plan: 'free',
        }),
      ],
    })

    const ledger = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/ledger?membershipId=${personalMemberMembershipId}&type=adjustment`,
      headers: { cookie: adminCookie },
    })
    expect(ledger.statusCode).toBe(200)
    expect(ledger.json()).toMatchObject({
      items: [
        expect.objectContaining({
          membershipId: personalMemberMembershipId,
          userId: personalMemberUserId,
          amount: 15,
          balance: 15,
          type: 'adjustment',
          description: 'Admin console audit top-up',
          createdByUserId: 'user-admin',
        }),
      ],
    })

    const billingAudit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?action=billing.credits.adjusted&userId=${personalMemberUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(billingAudit.statusCode).toBe(200)
    expect(billingAudit.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'billing.credits.adjusted',
          resourceType: 'billing_account',
          resourceId: personalMemberMembershipId,
          actorUserId: 'user-admin',
          metadata: expect.objectContaining({
            amount: 15,
            balance: 15,
            membershipId: personalMemberMembershipId,
            reason: 'Admin console audit top-up',
            traceId: expect.any(String),
          }),
        }),
      ]),
    )

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/memberships/${personalMemberMembershipId}`,
      headers: { cookie: adminCookie },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      membership: expect.objectContaining({ userId: personalMemberUserId, roles: ['member'] }),
      billing: expect.objectContaining({ credits: 15 }),
      entries: expect.arrayContaining([
        expect.objectContaining({ amount: 15, description: 'Admin console audit top-up' }),
      ]),
    })
  })

  it('enables and disables ordinary accounts without touching membership status', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const superAdmin = await login('superadmin@seqora.local', 'SuperAdmin123!')
    const member = await login('member@seqora.local', 'MemberPassword123!')

    const disabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-member/status',
      headers: { cookie: cookieValue(superAdmin) },
      payload: { status: 'disabled' },
    })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({
      id: 'user-member',
      status: 'disabled',
      activeMembershipCount: 1,
    })

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(member) },
    })
    expect(oldSession.statusCode).toBe(401)

    const blockedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'member@seqora.local',
        password: 'MemberPassword123!',
      },
    })
    expect(blockedLogin.statusCode).toBe(401)

    const enabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-member/status',
      headers: { cookie: cookieValue(superAdmin) },
      payload: { status: 'active' },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({
      id: 'user-member',
      status: 'active',
      activeMembershipCount: 1,
    })

    const loginAfterEnable = await login('member@seqora.local', 'MemberPassword123!')
    expect(loginAfterEnable.statusCode).toBe(200)
  })

  it('lets admins set temporary member passwords and records the forced reset state', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)

    const personalMember = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'personal-password-member@example.com',
        name: 'Personal Password Member',
        password: 'PersonalPasswordMember123!',
        role: 'member',
      },
    })
    expect(personalMember.statusCode).toBe(201)
    const personalMemberUserId = personalMember.json().userId as string
    const originalPassword = 'PersonalPasswordMember123!'

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/users/${personalMemberUserId}/password`,
      headers: { cookie: adminCookie },
      payload: {
        newPassword: 'MemberTempPassword123!',
        requireChange: true,
        revokeSessions: true,
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      id: personalMemberUserId,
      passwordResetRequired: true,
    })

    const oldPassword = await login('personal-password-member@example.com', originalPassword)
    expect(oldPassword.statusCode).toBe(401)

    const temporaryPassword = await login('personal-password-member@example.com', 'MemberTempPassword123!')
    expect(temporaryPassword.statusCode).toBe(200)
    expect(temporaryPassword.json()).toMatchObject({
      account: {
        id: personalMemberUserId,
        passwordResetRequired: true,
      },
    })

    const blockedProjects = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { cookie: cookieValue(temporaryPassword) },
    })
    expect(blockedProjects.statusCode).toBe(403)
    expect(blockedProjects.json()).toMatchObject({
      error: { code: 'PASSWORD_RESET_REQUIRED' },
    })

    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?action=admin.password.temporary_set&userId=${personalMemberUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(audit.statusCode).toBe(200)
    expect(audit.json()).toMatchObject({
      meta: { total: 1 },
      items: [
        expect.objectContaining({
          actorUserId: 'user-admin',
          resourceType: 'auth_identity',
          metadata: expect.objectContaining({ requireChange: true, scope: 'admin_console' }),
        }),
      ],
    })
  })

  it('forces password reset until the user changes password', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const superAdmin = await login('superadmin@seqora.local', 'SuperAdmin123!')
    const member = await login('member@seqora.local', 'MemberPassword123!')

    const forced = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-member/password-reset-requirement',
      headers: { cookie: cookieValue(superAdmin) },
      payload: {
        required: true,
        revokeSessions: true,
      },
    })
    expect(forced.statusCode).toBe(200)
    expect(forced.json()).toMatchObject({
      id: 'user-member',
      passwordResetRequired: true,
    })

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(member) },
    })
    expect(oldSession.statusCode).toBe(401)

    const forcedLogin = await login('member@seqora.local', 'MemberPassword123!')
    expect(forcedLogin.statusCode).toBe(200)
    expect(forcedLogin.json()).toMatchObject({
      account: { passwordResetRequired: true },
    })
    const forcedCookie = cookieValue(forcedLogin)

    const blockedBilling = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: forcedCookie },
    })
    expect(blockedBilling.statusCode).toBe(403)
    expect(blockedBilling.json()).toMatchObject({
      error: { code: 'PASSWORD_RESET_REQUIRED' },
    })

    const passwordChanged = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/password',
      headers: { cookie: forcedCookie },
      payload: {
        currentPassword: 'MemberPassword123!',
        newPassword: 'MemberChangedPassword123!',
      },
    })
    expect(passwordChanged.statusCode).toBe(204)

    const changedLogin = await login('member@seqora.local', 'MemberChangedPassword123!')
    expect(changedLogin.statusCode).toBe(200)
    expect(changedLogin.json()).toMatchObject({
      account: { passwordResetRequired: false },
    })

    const projects = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { cookie: cookieValue(changedLogin) },
    })
    expect(projects.statusCode).toBe(200)
  })

  it('enforces password management role boundaries', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const superAdmin = await login('superadmin@seqora.local', 'SuperAdmin123!')

    const adminResetsSelf = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-admin/password-reset-requirement',
      headers: { cookie: cookieValue(admin) },
      payload: { required: true, revokeSessions: true },
    })
    expect(adminResetsSelf.statusCode).toBe(400)
    expect(adminResetsSelf.json()).toMatchObject({
      error: { code: 'CANNOT_MANAGE_SELF_PASSWORD' },
    })

    const adminResetsOwner = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/users/user-owner/password',
      headers: { cookie: cookieValue(admin) },
      payload: {
        newPassword: 'OwnerTempPassword123!',
        requireChange: true,
        revokeSessions: true,
      },
    })
    expect(adminResetsOwner.statusCode).toBe(403)

    const superAdminResetsOwner = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-owner/password-reset-requirement',
      headers: { cookie: cookieValue(superAdmin) },
      payload: { required: true, revokeSessions: true },
    })
    expect(superAdminResetsOwner.statusCode).toBe(403)
    expect(superAdminResetsOwner.json()).toMatchObject({
      error: { code: 'ELEVATED_ACCOUNT_REQUIRES_OWNER' },
    })
  })

  it('lists and revokes sessions through admin console boundaries', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!', {
      'user-agent': 'AdminSessionDevice/1.0',
    })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!', {
      'user-agent': 'OwnerSessionDevice/1.0',
    })
    const adminCookie = cookieValue(admin)

    const personalMember = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'session-personal-member@example.com',
        name: 'Session Personal Member',
        password: 'SessionPersonalMember123!',
        role: 'member',
      },
    })
    expect(personalMember.statusCode).toBe(201)
    const personalMemberUserId = personalMember.json().userId as string
    const personalMemberLogin = await login('session-personal-member@example.com', 'SessionPersonalMember123!', {
      'user-agent': 'MemberSessionDevice/1.0',
    })
    expect(personalMemberLogin.statusCode).toBe(200)

    const activeMemberSessions = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/sessions?userId=${personalMemberUserId}&status=active`,
      headers: { cookie: adminCookie },
    })
    expect(activeMemberSessions.statusCode).toBe(200)
    expect(activeMemberSessions.json()).toMatchObject({
      items: [
        expect.objectContaining({
          userId: personalMemberUserId,
          status: 'active',
          userAgent: 'MemberSessionDevice/1.0',
        }),
      ],
    })
    const memberSessionId = activeMemberSessions.json().items[0].sessionId

    const ownerSeesAdminSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?userId=user-admin&status=active',
      headers: { cookie: cookieValue(owner) },
    })
    expect(ownerSeesAdminSessions.statusCode).toBe(200)
    const adminSessionId = ownerSeesAdminSessions.json().items[0].sessionId

    const adminRevokesSelf = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${adminSessionId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminRevokesSelf.statusCode).toBe(400)
    expect(adminRevokesSelf.json()).toMatchObject({
      error: { code: 'CANNOT_REVOKE_SELF_SESSION' },
    })

    const activeOwnerSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?userId=user-owner&status=active',
      headers: { cookie: cookieValue(owner) },
    })
    expect(activeOwnerSessions.statusCode).toBe(200)
    const ownerSessionId = activeOwnerSessions.json().items[0].sessionId

    const adminRevokesOwner = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${ownerSessionId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminRevokesOwner.statusCode).toBe(403)
    expect(adminRevokesOwner.json()).toMatchObject({
      error: { code: 'ELEVATED_SESSION_REQUIRES_OWNER' },
    })

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${memberSessionId}`,
      headers: { cookie: adminCookie },
    })
    expect(revoked.statusCode).toBe(204)

    const oldMemberSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(personalMemberLogin) },
    })
    expect(oldMemberSession.statusCode).toBe(401)

    const revokedMemberSessions = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/sessions?userId=${personalMemberUserId}&status=revoked`,
      headers: { cookie: adminCookie },
    })
    expect(revokedMemberSessions.statusCode).toBe(200)
    expect(revokedMemberSessions.json()).toMatchObject({
      items: [
        expect.objectContaining({
          sessionId: memberSessionId,
          userId: personalMemberUserId,
          status: 'revoked',
          revokedAt: expect.any(String),
        }),
      ],
    })

    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?action=admin.session.revoked&userId=${personalMemberUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(audit.statusCode).toBe(200)
    expect(audit.json()).toMatchObject({
      items: [
        expect.objectContaining({
          actorUserId: 'user-admin',
          resourceId: memberSessionId,
          metadata: expect.objectContaining({ scope: 'admin_console' }),
        }),
      ],
    })

    const memberSecondSession = await login('session-personal-member@example.com', 'SessionPersonalMember123!', {
      'user-agent': 'MemberSecondDevice/1.0',
    })
    const memberThirdSession = await login('session-personal-member@example.com', 'SessionPersonalMember123!', {
      'user-agent': 'MemberThirdDevice/1.0',
    })

    const adminBulkRevokesSelf = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/users/user-admin/sessions',
      headers: { cookie: adminCookie },
    })
    expect(adminBulkRevokesSelf.statusCode).toBe(400)
    expect(adminBulkRevokesSelf.json()).toMatchObject({
      error: { code: 'CANNOT_REVOKE_SELF_USER_SESSIONS' },
    })

    const bulkRevoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${personalMemberUserId}/sessions`,
      headers: { cookie: adminCookie },
    })
    expect(bulkRevoked.statusCode).toBe(200)
    expect(bulkRevoked.json()).toMatchObject({
      user: { id: personalMemberUserId },
      revokedSessionCount: 2,
    })

    const oldMemberSecondSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(memberSecondSession) },
    })
    expect(oldMemberSecondSession.statusCode).toBe(401)

    const oldMemberThirdSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(memberThirdSession) },
    })
    expect(oldMemberThirdSession.statusCode).toBe(401)

    const bulkAudit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?action=admin.user_sessions.revoked&userId=${personalMemberUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(bulkAudit.statusCode).toBe(200)
    expect(bulkAudit.json()).toMatchObject({
      items: [
        expect.objectContaining({
          actorUserId: 'user-admin',
          resourceId: personalMemberUserId,
          metadata: expect.objectContaining({ revokedSessionCount: 2, scope: 'admin_console' }),
        }),
      ],
    })

    const ownerRevokesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${adminSessionId}`,
      headers: { cookie: cookieValue(owner) },
    })
    expect(ownerRevokesAdmin.statusCode).toBe(204)
  })

  it('enforces elevated account and self-disable boundaries', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const superAdmin = await login('superadmin@seqora.local', 'SuperAdmin123!')
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')

    const adminDisablesOwner = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-owner/status',
      headers: { cookie: cookieValue(admin) },
      payload: { status: 'disabled' },
    })
    expect(adminDisablesOwner.statusCode).toBe(403)
    expect(adminDisablesOwner.json()).toMatchObject({
      error: { code: 'PLATFORM_ADMIN_REQUIRED' },
    })

    const superAdminDisablesOwner = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-owner/status',
      headers: { cookie: cookieValue(superAdmin) },
      payload: { status: 'disabled' },
    })
    expect(superAdminDisablesOwner.statusCode).toBe(403)
    expect(superAdminDisablesOwner.json()).toMatchObject({
      error: { code: 'ELEVATED_ACCOUNT_REQUIRES_OWNER' },
    })

    const ownerDisablesSelf = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-owner/status',
      headers: { cookie: cookieValue(owner) },
      payload: { status: 'disabled' },
    })
    expect(ownerDisablesSelf.statusCode).toBe(400)
    expect(ownerDisablesSelf.json()).toMatchObject({
      error: { code: 'CANNOT_DISABLE_SELF_ACCOUNT' },
    })

    const ownerDisablesAdmin = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-admin/status',
      headers: { cookie: cookieValue(owner) },
      payload: { status: 'disabled' },
    })
    expect(ownerDisablesAdmin.statusCode).toBe(200)
    expect(ownerDisablesAdmin.json()).toMatchObject({ id: 'user-admin', status: 'disabled' })

    const adminLoginAfterDisable = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@seqora.local',
        password: 'Admin123!',
      },
    })
    expect(adminLoginAfterDisable.statusCode).toBe(401)

    const ownerEnablesAdmin = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-admin/status',
      headers: { cookie: cookieValue(owner) },
      payload: { status: 'active' },
    })
    expect(ownerEnablesAdmin.statusCode).toBe(200)
    expect(ownerEnablesAdmin.json()).toMatchObject({ id: 'user-admin', status: 'active' })

    const adminLoginAfterEnable = await login('admin@seqora.local', 'Admin123!')
    expect(adminLoginAfterEnable.statusCode).toBe(200)
  })

  it('manages workspaces and memberships through admin console APIs', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')
    const ownerCookie = cookieValue(owner)
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)

    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/organizations/tenant-seqora-demo',
      headers: { cookie: ownerCookie },
      payload: { name: 'Seqora Commercial Workspace' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({
      id: 'tenant-seqora-demo',
      name: 'Seqora Commercial Workspace',
    })

    const createdOrganization = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      headers: { cookie: ownerCookie },
      payload: { name: 'Admin Created Organization' },
    })
    expect(createdOrganization.statusCode).toBe(201)
    expect(createdOrganization.json()).toMatchObject({
      id: expect.stringMatching(/^tenant-/),
      name: 'Admin Created Organization',
      status: 'active',
    })
    const adminCreatedOrganizationId = createdOrganization.json().id as string

    const ownerSessionAfterCreate = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: ownerCookie },
    })
    expect(ownerSessionAfterCreate.statusCode).toBe(200)
    expect(ownerSessionAfterCreate.json().account.tenantId).toBe('tenant-seqora-demo')

    const adminCreatesOrganization = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      headers: { cookie: adminCookie },
      payload: { name: 'Admin Should Not Create Organization' },
    })
    expect(adminCreatesOrganization.statusCode).toBe(403)
    expect(adminCreatesOrganization.json()).toMatchObject({
      error: { code: 'PLATFORM_ADMIN_REQUIRED' },
    })

    const existingAccount = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: ownerCookie },
      payload: {
        email: 'existing-account@example.com',
        name: 'Existing Account',
        password: 'ExistingAccount123!',
        role: 'member',
      },
    })
    expect(existingAccount.statusCode).toBe(201)

    const addedExistingMember = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${adminCreatedOrganizationId}/members`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'existing-account@example.com',
        roles: ['organization_member'],
      },
    })
    expect(addedExistingMember.statusCode).toBe(201)
    expect(addedExistingMember.json()).toMatchObject({
      email: 'existing-account@example.com',
      roles: ['organization_member'],
      tenantId: adminCreatedOrganizationId,
      status: 'active',
    })
    const existingMemberUserId = addedExistingMember.json().userId as string

    const organizationAudit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?resourceType=tenant&actorUserId=user-owner`,
      headers: { cookie: ownerCookie },
    })
    expect(organizationAudit.statusCode).toBe(200)
    expect(organizationAudit.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'admin.organization.created',
          resourceId: adminCreatedOrganizationId,
          metadata: expect.objectContaining({ scope: 'admin_console' }),
        }),
      ]),
    )

    const existingMemberAudit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?userId=${existingMemberUserId}`,
      headers: { cookie: ownerCookie },
    })
    expect(existingMemberAudit.statusCode).toBe(200)
    expect(existingMemberAudit.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'admin.membership.added',
          metadata: expect.objectContaining({ scope: 'admin_console' }),
        }),
      ]),
    )

    const disabledOrganization = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${adminCreatedOrganizationId}`,
      headers: { cookie: ownerCookie },
    })
    expect(disabledOrganization.statusCode).toBe(200)
    expect(disabledOrganization.json()).toMatchObject({
      id: adminCreatedOrganizationId,
      status: 'disabled',
    })

    const disabledOrganizationAudit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?action=admin.organization.disabled&resourceType=tenant&actorUserId=user-owner`,
      headers: { cookie: ownerCookie },
    })
    expect(disabledOrganizationAudit.statusCode).toBe(200)
    expect(disabledOrganizationAudit.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'admin.organization.disabled',
          resourceId: adminCreatedOrganizationId,
          metadata: expect.objectContaining({ scope: 'admin_console', traceId: expect.any(String) }),
        }),
      ]),
    )

    const managedTenant = await createWorkspaceFromCurrentSession(ownerCookie, 'Console Managed Workspace')
    const createdMember = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${managedTenant.tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'console-member@example.com',
        name: 'Console Member',
        password: 'ConsoleMember123!',
        role: 'member',
      },
    })
    expect(createdMember.statusCode).toBe(201)
    expect(createdMember.json()).toMatchObject({
      email: 'console-member@example.com',
      roles: ['member'],
      tenantId: managedTenant.tenantId,
    })
    const membershipId = createdMember.json().id as string
    const userId = createdMember.json().userId as string

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/memberships/${membershipId}/roles`,
      headers: { cookie: ownerCookie },
      payload: { roles: ['admin'] },
    })
    expect(promoted.statusCode).toBe(200)
    expect(promoted.json()).toMatchObject({ id: membershipId, roles: ['admin'] })

    const demoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/memberships/${membershipId}/roles`,
      headers: { cookie: ownerCookie },
      payload: { roles: ['member'] },
    })
    expect(demoted.statusCode).toBe(200)
    expect(demoted.json()).toMatchObject({ id: membershipId, roles: ['member'] })

    const disabled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/memberships/${membershipId}`,
      headers: { cookie: ownerCookie },
    })
    expect(disabled.statusCode).toBe(204)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/memberships/${membershipId}`,
      headers: { cookie: ownerCookie },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      membership: expect.objectContaining({ id: membershipId, userId, status: 'disabled' }),
    })

    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-logs?userId=${userId}`,
      headers: { cookie: ownerCookie },
    })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'admin.account.created',
          metadata: expect.objectContaining({ scope: 'admin_console' }),
        }),
        expect.objectContaining({
          action: 'admin.membership.roles.updated',
          metadata: expect.objectContaining({
            previousRoles: ['member'],
            roles: ['admin'],
            scope: 'admin_console',
          }),
        }),
        expect.objectContaining({
          action: 'admin.membership.disabled',
          metadata: expect.objectContaining({ scope: 'admin_console' }),
        }),
      ]),
    )
  })

  it('manages organization invitations through admin console APIs', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')
    const ownerCookie = cookieValue(owner)
    const organization = await createWorkspaceFromCurrentSession(ownerCookie, 'Admin Console Invite Organization')
    const invitationUrl = `/api/v1/admin/organizations/${organization.tenantId}/invitations`

    const created = await app.inject({
      method: 'POST',
      url: invitationUrl,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'admin-console-invite@example.com',
        roles: ['organization_member'],
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      email: 'admin-console-invite@example.com',
      tenantId: organization.tenantId,
      roles: ['organization_member'],
      scope: 'organization_membership',
      status: 'pending',
      token: expect.any(String),
    })
    const firstInvitation = created.json() as { id: string; token: string }

    const listed = await app.inject({
      method: 'GET',
      url: invitationUrl,
      headers: { cookie: ownerCookie },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstInvitation.id,
          email: 'admin-console-invite@example.com',
          scope: 'organization_membership',
          status: 'pending',
        }),
      ]),
    )

    const reissued = await app.inject({
      method: 'POST',
      url: invitationUrl,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'admin-console-invite@example.com',
        roles: ['organization_member'],
      },
    })
    expect(reissued.statusCode).toBe(201)
    expect(reissued.json()).toMatchObject({
      id: firstInvitation.id,
      email: 'admin-console-invite@example.com',
      status: 'pending',
      token: expect.any(String),
    })
    expect(reissued.json().token).not.toBe(firstInvitation.token)

    const revoked = await app.inject({
      method: 'DELETE',
      url: `${invitationUrl}/${firstInvitation.id}`,
      headers: { cookie: ownerCookie },
    })
    expect(revoked.statusCode).toBe(204)

    const afterRevoke = await app.inject({
      method: 'GET',
      url: invitationUrl,
      headers: { cookie: ownerCookie },
    })
    expect(afterRevoke.statusCode).toBe(200)
    expect(afterRevoke.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstInvitation.id,
          email: 'admin-console-invite@example.com',
          status: 'revoked',
          revokedAt: expect.any(String),
        }),
      ]),
    )
  })

  it('creates platform accounts and invitations without selecting an organization', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')
    const ownerCookie = cookieValue(owner)
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)

    const createdMember = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'platform-member@example.com',
        name: 'Platform Member',
        password: 'PlatformMember123!',
        role: 'member',
      },
    })
    expect(createdMember.statusCode).toBe(201)
    expect(createdMember.json()).toMatchObject({
      email: 'platform-member@example.com',
      roles: ['member'],
      tenantName: 'Platform Member 的个人空间',
      status: 'active',
    })
    expect(createdMember.json().tenantId).not.toBe('tenant-seqora-demo')

    const ownerCreatesAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: ownerCookie },
      payload: {
        email: 'platform-admin@example.com',
        name: 'Platform Admin',
        password: 'PlatformAdmin123!',
        role: 'admin',
      },
    })
    expect(ownerCreatesAdmin.statusCode).toBe(201)
    expect(ownerCreatesAdmin.json()).toMatchObject({
      email: 'platform-admin@example.com',
      roles: ['admin'],
      tenantId: 'tenant-seqora-demo',
    })

    const organizationRoleWithoutOrganization = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: ownerCookie },
      payload: {
        email: 'org-role-without-org@example.com',
        name: 'Missing Organization',
        password: 'MissingOrganization123!',
        role: 'organization_member',
      },
    })
    expect(organizationRoleWithoutOrganization.statusCode).toBe(400)
    expect(organizationRoleWithoutOrganization.json()).toMatchObject({
      error: { code: 'ORGANIZATION_REQUIRED' },
    })

    const memberInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie: adminCookie },
      payload: {
        email: 'platform-invited-member@example.com',
        roles: ['member'],
      },
    })
    expect(memberInvitation.statusCode).toBe(201)
    expect(memberInvitation.json()).toMatchObject({
      email: 'platform-invited-member@example.com',
      roles: ['member'],
      scope: 'platform_registration',
      status: 'pending',
      token: expect.stringMatching(/^\d{8}$/),
    })
    expect(memberInvitation.json().tenantId).not.toBe('tenant-seqora-demo')
    const memberInvitationToken = memberInvitation.json().token as string

    const directAcceptance = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: {
        token: memberInvitationToken,
        name: 'Platform Invited Member',
        password: 'PlatformInvitedMember123!',
      },
    })
    expect(directAcceptance.statusCode).toBe(400)
    expect(directAcceptance.json()).toMatchObject({
      error: { code: 'REGISTRATION_CODE_REQUIRED' },
    })

    const registrationCodeRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/registration-code/request',
      payload: {
        token: memberInvitationToken,
        email: 'platform-invited-member@example.com',
      },
    })
    expect(registrationCodeRequest.statusCode).toBe(202)

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: memberInvitationToken,
        email: 'platform-invited-member@example.com',
        name: 'Platform Invited Member',
        password: 'PlatformInvitedMember123!',
        verificationCode: registrationCodeRequest.json().registrationCode,
      },
    })
    expect(accepted.statusCode).toBe(201)
    expect(accepted.json()).toMatchObject({
      account: {
        email: 'platform-invited-member@example.com',
        roles: ['member'],
        tenantId: memberInvitation.json().tenantId,
      },
    })

    const personalMemberships = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/memberships?tenantId=${memberInvitation.json().tenantId}&limit=100`,
      headers: { cookie: adminCookie },
    })
    expect(personalMemberships.statusCode).toBe(200)
    expect(personalMemberships.json().items).toEqual([
      expect.objectContaining({
        email: 'platform-invited-member@example.com',
        roles: ['member'],
        isPrimary: true,
        organizationType: 'personal',
      }),
    ])

    const visibleToAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?q=platform-invited-member&limit=100',
      headers: { cookie: adminCookie },
    })
    expect(visibleToAdmin.statusCode).toBe(200)
    expect(visibleToAdmin.json().items).toEqual([
      expect.objectContaining({
        email: 'platform-invited-member@example.com',
        roles: ['member'],
      }),
    ])

    const organizationInvitationWithoutOrganization = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie: ownerCookie },
      payload: {
        email: 'org-invite-without-org@example.com',
        roles: ['organization_member'],
      },
    })
    expect(organizationInvitationWithoutOrganization.statusCode).toBe(400)
    expect(organizationInvitationWithoutOrganization.json()).toMatchObject({
      error: { code: 'ORGANIZATION_REQUIRED' },
    })

    const platformInvitationWithAdminRole = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie: ownerCookie },
      payload: {
        email: 'platform-invited-admin@example.com',
        roles: ['admin'],
      },
    })
    expect(platformInvitationWithAdminRole.statusCode).toBe(400)
    expect(platformInvitationWithAdminRole.json()).toMatchObject({
      error: { code: 'PLATFORM_REGISTRATION_ROLE_REQUIRED' },
    })
  })

  it('enforces admin console workspace and membership role boundaries', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')
    const superAdmin = await login('superadmin@seqora.local', 'SuperAdmin123!')
    const admin = await login('admin@seqora.local', 'Admin123!')
    const ownerCookie = cookieValue(owner)
    const superAdminCookie = cookieValue(superAdmin)
    const adminCookie = cookieValue(admin)

    const personalMember = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'boundary-personal-member@example.com',
        name: 'Boundary Personal Member',
        password: 'BoundaryPersonalMember123!',
        role: 'member',
      },
    })
    expect(personalMember.statusCode).toBe(201)
    const personalMemberTenantId = personalMember.json().tenantId as string

    const adminCreatesAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations/tenant-seqora-demo/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'admin-created-admin@example.com',
        name: 'Admin Created Admin',
        password: 'AdminCreatedAdmin123!',
        role: 'admin',
      },
    })
    expect(adminCreatesAdmin.statusCode).toBe(403)

    const superAdminCreatesSuperAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations/tenant-seqora-demo/users',
      headers: { cookie: superAdminCookie },
      payload: {
        email: 'superadmin-created-superadmin@example.com',
        name: 'Super Created Super',
        password: 'SuperCreatedSuper123!',
        role: 'super_admin',
      },
    })
    expect(superAdminCreatesSuperAdmin.statusCode).toBe(403)

    const ownerCreatesSuperAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations/tenant-seqora-demo/users',
      headers: { cookie: ownerCookie },
      payload: {
        email: 'owner-created-superadmin@example.com',
        name: 'Owner Created Super',
        password: 'OwnerCreatedSuper123!',
        role: 'super_admin',
      },
    })
    expect(ownerCreatesSuperAdmin.statusCode).toBe(201)
    expect(ownerCreatesSuperAdmin.json()).toMatchObject({ roles: ['super_admin'] })

    const superAdminMembershipId = ownerCreatesSuperAdmin.json().id as string
    const adminChangesSuperAdmin = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/memberships/${superAdminMembershipId}/roles`,
      headers: { cookie: adminCookie },
      payload: { roles: ['member'] },
    })
    expect(adminChangesSuperAdmin.statusCode).toBe(403)

    const superAdminChangesSuperAdmin = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/memberships/${superAdminMembershipId}/roles`,
      headers: { cookie: superAdminCookie },
      payload: { roles: ['admin'] },
    })
    expect(superAdminChangesSuperAdmin.statusCode).toBe(403)

    const ownerChangesSuperAdmin = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/memberships/${superAdminMembershipId}/roles`,
      headers: { cookie: ownerCookie },
      payload: { roles: ['admin'] },
    })
    expect(ownerChangesSuperAdmin.statusCode).toBe(200)
    expect(ownerChangesSuperAdmin.json()).toMatchObject({ roles: ['admin'] })

    const crossTenant = await createWorkspaceFromCurrentSession(ownerCookie, 'Enterprise Workspace')
    const ownerCreatesCrossTenantMember = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${crossTenant.tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'enterprise-member@example.com',
        name: 'Enterprise Member',
        password: 'EnterpriseMember123!',
        role: 'member',
      },
    })
    expect(ownerCreatesCrossTenantMember.statusCode).toBe(201)
    const crossTenantMembershipId = ownerCreatesCrossTenantMember.json().id as string
    const crossTenantUserId = ownerCreatesCrossTenantMember.json().userId as string
    await activateProvisionedAccount('enterprise-member@example.com', 'EnterpriseMember123!', {
      'user-agent': 'EnterpriseMemberDevice/1.0',
    })
    const ownerCreatesCrossTenantAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${crossTenant.tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'enterprise-admin@example.com',
        name: 'Enterprise Admin',
        password: 'EnterpriseAdmin123!',
        role: 'admin',
      },
    })
    expect(ownerCreatesCrossTenantAdmin.statusCode).toBe(201)
    const crossTenantAdmin = await activateProvisionedAccount(
      'enterprise-admin@example.com',
      'EnterpriseAdmin123!',
    )
    const crossTenantAdminCookie = cookieValue(crossTenantAdmin)

    const scopedConsole = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/console?limit=100',
      headers: { cookie: adminCookie },
    })
    expect(scopedConsole.statusCode).toBe(200)
    const scopedSnapshot = scopedConsole.json()
    expect(scopedSnapshot.tenants.items.map((item: { id: string }) => item.id)).toEqual([
      personalMemberTenantId,
    ])
    expect(scopedSnapshot.users.items.map((item: { id: string }) => item.id)).not.toContain(crossTenantUserId)
    expect(scopedSnapshot.memberships.items.map((item: { id: string }) => item.id)).not.toContain(
      crossTenantMembershipId,
    )
    expect(
      scopedSnapshot.billingAccounts.items.map((item: { membershipId: string }) => item.membershipId),
    ).not.toContain(crossTenantMembershipId)
    expect(scopedSnapshot.sessions.items.map((item: { userId: string }) => item.userId)).not.toContain(
      crossTenantUserId,
    )

    const adminReadsCrossTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/memberships/${crossTenantMembershipId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminReadsCrossTenant.statusCode).toBe(403)
    expect(adminReadsCrossTenant.json()).toMatchObject({
      error: { code: 'TENANT_SCOPE_MISMATCH' },
    })

    const adminRenamesCrossTenant = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${crossTenant.tenantId}`,
      headers: { cookie: adminCookie },
      payload: { name: 'Illegal Rename' },
    })
    expect(adminRenamesCrossTenant.statusCode).toBe(403)

    const adminAdjustsCrossTenantBilling = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/billing/memberships/${crossTenantMembershipId}/adjustments`,
      headers: { cookie: adminCookie },
      payload: { amount: 5, reason: 'Illegal cross-tenant adjustment' },
    })
    expect([403, 404]).toContain(adminAdjustsCrossTenantBilling.statusCode)

    const ownerCreatesOrganizationAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${crossTenant.tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'owner-created-org-admin@example.com',
        name: 'Owner Created Organization Admin',
        password: 'OwnerCreatedOrgAdmin123!',
        role: 'organization_admin',
      },
    })
    expect(ownerCreatesOrganizationAdmin.statusCode).toBe(201)
    expect(ownerCreatesOrganizationAdmin.json()).toMatchObject({ roles: ['organization_admin'] })
    const organizationAdminUserId = ownerCreatesOrganizationAdmin.json().userId as string

    const ownerCreatesOrganizationMember = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${crossTenant.tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'owner-created-org-member@example.com',
        name: 'Owner Created Organization Member',
        password: 'OwnerCreatedOrgMember123!',
        role: 'organization_member',
      },
    })
    expect(ownerCreatesOrganizationMember.statusCode).toBe(201)
    expect(ownerCreatesOrganizationMember.json()).toMatchObject({ roles: ['organization_member'] })
    const organizationMemberUserId = ownerCreatesOrganizationMember.json().userId as string

    const adminTransfersOrganizationAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${crossTenant.tenantId}/admin-transfer`,
      headers: { cookie: crossTenantAdminCookie },
      payload: {
        currentOrganizationAdminUserId: organizationAdminUserId,
        targetUserId: organizationMemberUserId,
      },
    })
    expect(adminTransfersOrganizationAdmin.statusCode).toBe(403)
    expect(adminTransfersOrganizationAdmin.json()).toMatchObject({
      error: { code: 'PLATFORM_ADMIN_REQUIRED' },
    })

    const superAdminTransfersOrganizationAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${crossTenant.tenantId}/admin-transfer`,
      headers: { cookie: superAdminCookie },
      payload: {
        currentOrganizationAdminUserId: organizationAdminUserId,
        targetUserId: organizationMemberUserId,
      },
    })
    expect(superAdminTransfersOrganizationAdmin.statusCode).toBe(200)
    expect(superAdminTransfersOrganizationAdmin.json()).toMatchObject({
      previousOrganizationAdmin: {
        userId: organizationAdminUserId,
        roles: ['organization_member'],
      },
      newOrganizationAdmin: {
        userId: organizationMemberUserId,
        roles: ['organization_admin'],
      },
    })
  })

  it('scopes tenant admins and organization admins to their own organization records', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')
    const superAdmin = await login('superadmin@seqora.local', 'SuperAdmin123!')
    const admin = await login('admin@seqora.local', 'Admin123!')
    const member = await login('member@seqora.local', 'MemberPassword123!', {
      'user-agent': 'SeedMemberScopedDevice/1.0',
    })
    const ownerCookie = cookieValue(owner)
    const superAdminCookie = cookieValue(superAdmin)
    const adminCookie = cookieValue(admin)
    const memberCookie = cookieValue(member)

    const organization = await createWorkspaceFromCurrentSession(
      ownerCookie,
      'Scoped Enterprise Organization',
    )
    const organizationAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organization.tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'scoped-organization-admin@example.com',
        name: 'Scoped Organization Admin',
        password: 'ScopedOrganizationAdmin123!',
        role: 'organization_admin',
      },
    })
    expect(organizationAdmin.statusCode).toBe(201)
    const organizationAdminUserId = organizationAdmin.json().userId as string

    const organizationMember = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organization.tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'scoped-organization-member@example.com',
        name: 'Scoped Organization Member',
        password: 'ScopedOrganizationMember123!',
        role: 'organization_member',
      },
    })
    expect(organizationMember.statusCode).toBe(201)
    const organizationMemberUserId = organizationMember.json().userId as string
    const organizationMemberMembershipId = organizationMember.json().id as string

    const organizationAdminLogin = await activateProvisionedAccount(
      'scoped-organization-admin@example.com',
      'ScopedOrganizationAdmin123!',
      { 'user-agent': 'ScopedOrganizationAdminDevice/1.0' },
    )
    expect(organizationAdminLogin.statusCode).toBe(200)
    const organizationAdminCookie = cookieValue(organizationAdminLogin)

    const organizationMemberLogin = await activateProvisionedAccount(
      'scoped-organization-member@example.com',
      'ScopedOrganizationMember123!',
      { 'user-agent': 'ScopedOrganizationMemberDevice/1.0' },
    )
    expect(organizationMemberLogin.statusCode).toBe(200)

    const ownerAdjustsOrganizationBilling = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/billing/memberships/${organizationMemberMembershipId}/adjustments`,
      headers: { cookie: ownerCookie },
      payload: { amount: 12, reason: 'Scoped organization fixture credit' },
    })
    expect(ownerAdjustsOrganizationBilling.statusCode).toBe(200)

    const seedAlertId = await createBillingReconciliationAlert({
      providerEventId: 'evt_seed_scope_alert',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-member',
      membershipId: 'membership-tenant-seqora-demo-user-member',
      message: 'Seed organization payment needs review',
    })
    const organizationAlertId = await createBillingReconciliationAlert({
      providerEventId: 'evt_organization_scope_alert',
      tenantId: organization.tenantId,
      userId: organizationMemberUserId,
      membershipId: organizationMemberMembershipId,
      message: 'Scoped organization payment needs review',
    })

    const memberReadsAlerts = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/reconciliation-alerts',
      headers: { cookie: memberCookie },
    })
    expect(memberReadsAlerts.statusCode).toBe(403)

    const organizationAdminConsole = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/console?tenantId=${organization.tenantId}&limit=100`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminConsole.statusCode).toBe(200)
    const scopedSnapshot = organizationAdminConsole.json()
    expect(scopedSnapshot.organizations.items.map((item: { id: string }) => item.id)).toEqual([
      organization.tenantId,
    ])
    expect(scopedSnapshot.users.items.map((item: { id: string }) => item.id)).toContain(organizationMemberUserId)
    expect(scopedSnapshot.users.items.map((item: { id: string }) => item.id)).not.toContain(
      organizationAdminUserId,
    )
    expect(scopedSnapshot.users.items.map((item: { id: string }) => item.id)).not.toContain('user-member')
    expect(
      scopedSnapshot.billingLedgerEntries.items.map((item: { membershipId: string }) => item.membershipId),
    ).toContain(organizationMemberMembershipId)
    expect(scopedSnapshot.sessions.items.map((item: { userId: string }) => item.userId)).toContain(
      organizationMemberUserId,
    )
    expect(scopedSnapshot.sessions.items.map((item: { userId: string }) => item.userId)).not.toContain(
      'user-member',
    )
    expect(scopedSnapshot.billingReconciliationAlerts.items.map((item: { id: string }) => item.id)).toContain(
      organizationAlertId,
    )
    expect(
      scopedSnapshot.billingReconciliationAlerts.items.map((item: { id: string }) => item.id),
    ).not.toContain(seedAlertId)

    const organizationAdminListsUsers = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users?tenantId=${organization.tenantId}&role=organization_member&limit=100`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminListsUsers.statusCode).toBe(200)
    expect(organizationAdminListsUsers.json().items.map((item: { id: string }) => item.id)).toContain(
      organizationMemberUserId,
    )
    expect(organizationAdminListsUsers.json().items.map((item: { id: string }) => item.id)).not.toContain(
      organizationAdminUserId,
    )

    const organizationAdminListsBilling = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/accounts?tenantId=${organization.tenantId}&limit=100`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminListsBilling.statusCode).toBe(200)
    expect(
      organizationAdminListsBilling.json().items.map((item: { membershipId: string }) => item.membershipId),
    ).toContain(organizationMemberMembershipId)
    expect(
      organizationAdminListsBilling.json().items.map((item: { membershipId: string }) => item.membershipId),
    ).not.toContain('membership-tenant-seqora-demo-user-member')

    const adminListsOrganizationAlerts = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/reconciliation-alerts?tenantId=${organization.tenantId}&limit=100`,
      headers: { cookie: adminCookie },
    })
    expect(adminListsOrganizationAlerts.statusCode).toBe(200)
    expect(adminListsOrganizationAlerts.json().items.map((item: { id: string }) => item.id)).not.toContain(
      organizationAlertId,
    )
    expect(adminListsOrganizationAlerts.json().items.map((item: { id: string }) => item.id)).not.toContain(
      seedAlertId,
    )

    const adminUpdatesOrganizationAlert = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/billing/reconciliation-alerts/${organizationAlertId}`,
      headers: { cookie: adminCookie },
      payload: { status: 'acknowledged', message: 'Wrong organization acknowledgement' },
    })
    expect(adminUpdatesOrganizationAlert.statusCode).toBe(403)
    expect(adminUpdatesOrganizationAlert.json()).toMatchObject({
      error: { code: 'TENANT_SCOPE_MISMATCH' },
    })

    const organizationAdminUpdatesSeedAlert = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/billing/reconciliation-alerts/${seedAlertId}`,
      headers: { cookie: organizationAdminCookie },
      payload: { status: 'acknowledged', message: 'Wrong seed acknowledgement' },
    })
    expect(organizationAdminUpdatesSeedAlert.statusCode).toBe(403)
    expect(organizationAdminUpdatesSeedAlert.json()).toMatchObject({
      error: { code: 'TENANT_SCOPE_MISMATCH' },
    })

    const organizationAdminUpdatesOwnAlert = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/billing/reconciliation-alerts/${organizationAlertId}`,
      headers: { cookie: organizationAdminCookie },
      payload: { status: 'acknowledged', message: 'Organization admin is reviewing' },
    })
    expect(organizationAdminUpdatesOwnAlert.statusCode).toBe(200)
    expect(organizationAdminUpdatesOwnAlert.json()).toMatchObject({
      id: organizationAlertId,
      status: 'acknowledged',
      acknowledgedByUserId: organizationAdminUserId,
      message: 'Organization admin is reviewing',
    })

    const ownerReadsOrganizationAlerts = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/reconciliation-alerts?tenantId=${organization.tenantId}&limit=100`,
      headers: { cookie: ownerCookie },
    })
    expect(ownerReadsOrganizationAlerts.statusCode).toBe(200)
    expect(ownerReadsOrganizationAlerts.json().items.map((item: { id: string }) => item.id)).toContain(
      organizationAlertId,
    )

    const superAdminResolvesOrganizationAlert = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/billing/reconciliation-alerts/${organizationAlertId}`,
      headers: { cookie: superAdminCookie },
      payload: { status: 'resolved', message: 'Platform review completed' },
    })
    expect(superAdminResolvesOrganizationAlert.statusCode).toBe(200)
    expect(superAdminResolvesOrganizationAlert.json()).toMatchObject({
      id: organizationAlertId,
      status: 'resolved',
      message: 'Platform review completed',
      resolvedAt: expect.any(String),
    })

    const ownerReadsOrganizationMemberSessions = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/sessions?userId=${organizationMemberUserId}&status=active`,
      headers: { cookie: ownerCookie },
    })
    expect(ownerReadsOrganizationMemberSessions.statusCode).toBe(200)
    const organizationMemberSessionId = ownerReadsOrganizationMemberSessions.json().items[0]?.sessionId as
      string | undefined
    expect(organizationMemberSessionId).toEqual(expect.any(String))

    const ownerReadsSeedMemberSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?userId=user-member&status=active',
      headers: { cookie: ownerCookie },
    })
    expect(ownerReadsSeedMemberSessions.statusCode).toBe(200)
    const seedMemberSessionId = ownerReadsSeedMemberSessions.json().items[0]?.sessionId as string | undefined
    expect(seedMemberSessionId).toEqual(expect.any(String))

    const organizationAdminRevokesSeedSession = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${seedMemberSessionId}`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminRevokesSeedSession.statusCode).toBe(403)
    expect(organizationAdminRevokesSeedSession.json()).toMatchObject({
      error: { code: 'TENANT_SCOPE_MISMATCH' },
    })

    const adminRevokesOrganizationSession = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${organizationMemberSessionId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminRevokesOrganizationSession.statusCode).toBe(403)
    expect(adminRevokesOrganizationSession.json()).toMatchObject({
      error: { code: 'TENANT_SCOPE_MISMATCH' },
    })

    const organizationAdminRevokesOwnOrganizationSession = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${organizationMemberSessionId}`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminRevokesOwnOrganizationSession.statusCode).toBe(204)

    const organizationAdminRenamesSeedOrganization = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/organizations/tenant-seqora-demo',
      headers: { cookie: organizationAdminCookie },
      payload: { name: 'Illegal Seed Rename' },
    })
    expect(organizationAdminRenamesSeedOrganization.statusCode).toBe(403)
    expect(organizationAdminRenamesSeedOrganization.json()).toMatchObject({
      error: { code: 'TENANT_SCOPE_MISMATCH' },
    })

    const organizationAdminResetsSeedMemberPassword = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/users/user-member/password',
      headers: { cookie: organizationAdminCookie },
      payload: {
        newPassword: 'IllegalSeedReset123!',
        requireChange: true,
        revokeSessions: true,
      },
    })
    expect(organizationAdminResetsSeedMemberPassword.statusCode).toBe(403)
    expect(organizationAdminResetsSeedMemberPassword.json()).toMatchObject({
      error: { code: 'PLATFORM_MEMBER_REQUIRES_PLATFORM_ADMIN' },
    })
  })

  it('manages organization credit pools and membership plans through admin billing APIs', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')
    const ownerCookie = cookieValue(owner)
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)

    const organization = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      headers: { cookie: ownerCookie },
      payload: { name: 'Billing Pool Organization' },
    })
    expect(organization.statusCode).toBe(201)
    const tenantId = organization.json().id as string

    const organizationAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'billing-org-admin@example.com',
        name: 'Billing Org Admin',
        password: 'BillingOrgAdmin123!',
        role: 'organization_admin',
      },
    })
    expect(organizationAdmin.statusCode).toBe(201)
    const organizationAdminLogin = await activateProvisionedAccount(
      'billing-org-admin@example.com',
      'BillingOrgAdmin123!',
    )
    const organizationAdminCookie = cookieValue(organizationAdminLogin)

    const organizationMember = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${tenantId}/users`,
      headers: { cookie: ownerCookie },
      payload: {
        email: 'billing-org-member@example.com',
        name: 'Billing Org Member',
        password: 'BillingOrgMember123!',
        role: 'organization_member',
      },
    })
    expect(organizationMember.statusCode).toBe(201)
    const organizationMemberUserId = organizationMember.json().userId as string
    const organizationMemberMembershipId = organizationMember.json().id as string
    const organizationMemberLogin = await activateProvisionedAccount(
      'billing-org-member@example.com',
      'BillingOrgMember123!',
    )
    const organizationMemberCookie = cookieValue(organizationMemberLogin)

    const initialPool = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/organizations/${tenantId}`,
      headers: { cookie: ownerCookie },
    })
    expect(initialPool.statusCode).toBe(200)
    expect(initialPool.json()).toMatchObject({ tenantId, organizationId: tenantId, credits: 0 })

    const personalAdminTopUp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/billing/organizations/${tenantId}/adjustments`,
      headers: { cookie: adminCookie },
      payload: { amount: 50, reason: 'Wrong scope top-up' },
    })
    expect(personalAdminTopUp.statusCode).toBe(403)

    const ownerTopUp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/billing/organizations/${tenantId}/adjustments`,
      headers: { cookie: ownerCookie },
      payload: { amount: 120, reason: 'Organization launch credits' },
    })
    expect(ownerTopUp.statusCode).toBe(200)
    expect(ownerTopUp.json()).toMatchObject({
      tenantId,
      credits: 120,
      entries: expect.arrayContaining([
        expect.objectContaining({
          type: 'adjustment',
          amount: 120,
          description: 'Organization launch credits',
        }),
      ]),
    })

    const organizationAdminTopUp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/billing/organizations/${tenantId}/adjustments`,
      headers: { cookie: organizationAdminCookie },
      payload: { amount: 30, reason: 'Organization admin top-up' },
    })
    expect(organizationAdminTopUp.statusCode).toBe(200)
    expect(organizationAdminTopUp.json()).toMatchObject({ tenantId, credits: 150 })

    const organizationRouteSummary = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${tenantId}/billing/summary`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationRouteSummary.statusCode).toBe(200)
    expect(organizationRouteSummary.json()).toMatchObject({ tenantId, credits: 150 })

    const updatedPlan = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/billing/memberships/${organizationMemberMembershipId}/plan`,
      headers: { cookie: ownerCookie },
      payload: { plan: 'member', reason: 'Backend membership upgrade' },
    })
    expect(updatedPlan.statusCode).toBe(200)
    expect(updatedPlan.json()).toMatchObject({
      plan: 'member',
      billingScope: 'organization',
      credits: 150,
      organizationPool: { tenantId, organizationId: tenantId, credits: 150 },
    })

    const memberBilling = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: organizationMemberCookie },
    })
    expect(memberBilling.statusCode).toBe(200)
    expect(memberBilling.json()).toMatchObject({
      plan: 'member',
      billingScope: 'organization',
      credits: 150,
    })

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: organizationMemberCookie },
      payload: {
        name: 'Organization Pool Generation',
        contentType: 'short-drama',
        aspectRatio: '9:16',
      },
    })
    expect(project.statusCode).toBe(201)
    const task = await app.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { cookie: organizationMemberCookie },
      payload: {
        clientRequestId: 'organization-pool-generation',
        projectId: project.json().id,
        kind: 'image',
        label: 'Organization pool render',
        provider: 'img2',
        estimatedCredits: 7,
      },
    })
    expect(task.statusCode).toBe(202)

    const afterGeneration = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: organizationMemberCookie },
    })
    expect(afterGeneration.statusCode).toBe(200)
    expect(afterGeneration.json()).toMatchObject({
      billingScope: 'organization',
      credits: 143,
      monthlyUsage: { consumedCredits: 7, netCredits: 7 },
    })

    await withDatabase(async (database) => {
      const rows = await database.query<{
        organization_credits: number
        membership_credits: number
        membership_plan: string
        organization_debits: number
        membership_debits: number
      }>(
        `
        SELECT
          (SELECT credits FROM organization_billing_accounts WHERE tenant_id = $1) AS organization_credits,
          (
            SELECT credits
            FROM billing_accounts
            WHERE membership_id = $2
          ) AS membership_credits,
          (
            SELECT plan
            FROM billing_accounts
            WHERE membership_id = $2
          ) AS membership_plan,
          (
            SELECT count(*)::int
            FROM organization_billing_ledger_entries
            WHERE tenant_id = $1
              AND reference_id = 'organization-pool-generation'
              AND user_id = $3
          ) AS organization_debits,
          (
            SELECT count(*)::int
            FROM billing_ledger_entries
            WHERE membership_id = $2
              AND reference_id = 'organization-pool-generation'
          ) AS membership_debits
        `,
        [tenantId, organizationMemberMembershipId, organizationMemberUserId],
      )
      expect(rows.rows[0]).toEqual({
        organization_credits: 143,
        membership_credits: 500,
        membership_plan: 'member',
        organization_debits: 1,
        membership_debits: 0,
      })
    })
  })

  it('denies non-admin accounts from admin console APIs', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const member = await login('member@seqora.local', 'MemberPassword123!')

    const users = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: cookieValue(member) },
    })
    expect(users.statusCode).toBe(403)

    const billing = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/accounts',
      headers: { cookie: cookieValue(member) },
    })
    expect(billing.statusCode).toBe(403)

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions',
      headers: { cookie: cookieValue(member) },
    })
    expect(sessions.statusCode).toBe(403)

    const usage = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/usage',
      headers: { cookie: cookieValue(member) },
    })
    expect(usage.statusCode).toBe(403)
  })
})

function localAuthConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    DATABASE_URL: authDatabase.connectionString,
    DATA_FILE: ':memory:',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: resolve('./data/test-uploads'),
    ...overrides,
  })
}

async function login(email: string, password: string, headers?: Record<string, string>) {
  if (!app) throw new Error('App is not ready')
  return await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers,
    payload: { email, password },
  })
}

async function activateProvisionedAccount(
  email: string,
  temporaryPassword: string,
  headers?: Record<string, string>,
) {
  if (!app) throw new Error('App is not ready')
  const initialLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '10.0.0.2',
    headers,
    payload: { email, password: temporaryPassword },
  })
  expect(initialLogin.statusCode).toBe(200)
  expect(initialLogin.json()).toMatchObject({ account: { passwordResetRequired: true } })

  const newPassword = `Ready-${temporaryPassword}`
  const changed = await app.inject({
    method: 'PUT',
    url: '/api/v1/auth/password',
    remoteAddress: '10.0.0.2',
    headers: { cookie: cookieValue(initialLogin), ...headers },
    payload: { currentPassword: temporaryPassword, newPassword },
  })
  expect(changed.statusCode).toBe(204)

  const readyLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '10.0.0.2',
    headers,
    payload: { email, password: newPassword },
  })
  expect(readyLogin.statusCode).toBe(200)
  expect(readyLogin.json()).toMatchObject({ account: { passwordResetRequired: false } })
  return readyLogin
}

async function createWorkspaceFromCurrentSession(
  cookie: string,
  name: string,
): Promise<{ tenantId: string }> {
  if (!app) throw new Error('App is not ready')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/organizations',
    headers: { cookie },
    payload: { name },
  })
  expect(response.statusCode).toBe(201)
  return { tenantId: response.json().workspace.id as string }
}

async function createBillingReconciliationAlert(input: {
  providerEventId: string
  tenantId: string
  userId: string
  membershipId: string
  message: string
}): Promise<string> {
  return await withDatabase(async (database) => {
    const repository = new BillingPaymentRepository(database)
    const alert = await repository.recordReconciliationAlert({
      provider: 'stripe',
      providerEventId: input.providerEventId,
      eventType: 'invoice.payment_failed',
      alertType: 'invoice.payment_failed',
      severity: 'critical',
      tenantId: input.tenantId,
      userId: input.userId,
      membershipId: input.membershipId,
      message: input.message,
      metadata: { testFixture: true },
    })
    return alert.id
  })
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
