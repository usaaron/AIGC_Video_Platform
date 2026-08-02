import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { AccountDatabase } from '../../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { BillingPaymentRepository } from '../billing/paymentRepository.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let authDatabase: PostgresAuthFixture | undefined

beforeAll(async () => {
  authDatabase = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await authDatabase?.reset()
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
    await login('member@seqora.local', 'MemberPassword123!', {
      'user-agent': 'MemberDevice/1.0',
    })
    const adminCookie = cookieValue(admin)

    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/console?limit=10',
      headers: { cookie: adminCookie },
    })
    expect(snapshot.statusCode).toBe(200)
    expect(snapshot.json()).toMatchObject({
      overview: {
        users: 4,
        activeTasks: expect.any(Number),
        creditsConsumedToday: expect.any(Number),
        generatedAt: expect.any(String),
      },
      users: {
        meta: expect.objectContaining({ limit: 10, offset: 0 }),
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'user-admin', email: 'admin@seqora.local' }),
        ]),
      },
      tenants: {
        items: [expect.objectContaining({ id: 'tenant-seqora-demo', status: 'active', isSystem: true })],
      },
      organizations: {
        items: [expect.objectContaining({ id: 'tenant-seqora-demo', status: 'active', isSystem: true })],
      },
      memberships: {
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 'membership-tenant-seqora-demo-user-admin',
            organizationId: 'tenant-seqora-demo',
          }),
        ]),
      },
      billingAccounts: {
        items: expect.arrayContaining([
          expect.objectContaining({ membershipId: 'membership-tenant-seqora-demo-user-member' }),
        ]),
      },
      sessions: {
        items: expect.arrayContaining([
          expect.objectContaining({
            userId: 'user-admin',
            tenantId: 'tenant-seqora-demo',
            status: 'active',
            current: true,
            userAgent: 'ConsoleAdminBrowser/1.0',
          }),
          expect.objectContaining({
            userId: 'user-member',
            status: 'active',
            current: false,
            userAgent: 'MemberDevice/1.0',
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

  it('lists users, tenants, memberships and billing records', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCookie = cookieValue(admin)

    const users = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?q=seqora.local',
      headers: { cookie: adminCookie },
    })
    expect(users.statusCode).toBe(200)
    expect(users.json()).toMatchObject({
      meta: { total: 4, limit: 50, offset: 0 },
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'user-admin',
          email: 'admin@seqora.local',
          status: 'active',
          roles: expect.arrayContaining(['admin']),
        }),
        expect.objectContaining({
          id: 'user-owner',
          email: 'owner@seqora.local',
          roles: expect.arrayContaining(['owner']),
        }),
      ]),
    })

    const memberUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?tenantId=tenant-seqora-demo&role=member&limit=100',
      headers: { cookie: adminCookie },
    })
    expect(memberUsers.statusCode).toBe(200)
    expect(memberUsers.json().items.map((item: { id: string }) => item.id)).toEqual(['user-member'])

    const tenants = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?q=seqora',
      headers: { cookie: adminCookie },
    })
    expect(tenants.statusCode).toBe(200)
    expect(tenants.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'tenant-seqora-demo',
          status: 'active',
          activeMembershipCount: 4,
          activeOrganizationAdminCount: 0,
        }),
      ],
    })

    const organizations = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?q=seqora',
      headers: { cookie: adminCookie },
    })
    expect(organizations.statusCode).toBe(200)
    expect(organizations.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'tenant-seqora-demo',
          status: 'active',
          activeMembershipCount: 4,
          activeOrganizationAdminCount: 0,
        }),
      ],
    })

    const memberships = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/memberships?tenantId=tenant-seqora-demo&role=member',
      headers: { cookie: adminCookie },
    })
    expect(memberships.statusCode).toBe(200)
    expect(memberships.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'membership-tenant-seqora-demo-user-member',
          userId: 'user-member',
          email: 'member@seqora.local',
          plan: 'free',
          credits: 286,
        }),
      ],
    })

    const adjusted = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-member/adjustments',
      headers: { cookie: adminCookie },
      payload: {
        amount: 15,
        reason: 'Admin console audit top-up',
      },
    })
    expect(adjusted.statusCode).toBe(200)

    const billingAccounts = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/accounts?membershipId=membership-tenant-seqora-demo-user-member',
      headers: { cookie: adminCookie },
    })
    expect(billingAccounts.statusCode).toBe(200)
    expect(billingAccounts.json()).toMatchObject({
      items: [
        expect.objectContaining({
          membershipId: 'membership-tenant-seqora-demo-user-member',
          credits: 301,
          plan: 'free',
        }),
      ],
    })

    const ledger = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/ledger?membershipId=membership-tenant-seqora-demo-user-member&type=adjustment',
      headers: { cookie: adminCookie },
    })
    expect(ledger.statusCode).toBe(200)
    expect(ledger.json()).toMatchObject({
      items: [
        expect.objectContaining({
          membershipId: 'membership-tenant-seqora-demo-user-member',
          userId: 'user-member',
          amount: 15,
          balance: 301,
          type: 'adjustment',
          description: 'Admin console audit top-up',
          createdByUserId: 'user-admin',
        }),
      ],
    })

    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-member',
      headers: { cookie: adminCookie },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      membership: expect.objectContaining({ userId: 'user-member', roles: ['member'] }),
      billing: expect.objectContaining({ credits: 301 }),
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

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/users/user-member/password',
      headers: { cookie: cookieValue(admin) },
      payload: {
        newPassword: 'MemberTempPassword123!',
        requireChange: true,
        revokeSessions: true,
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      id: 'user-member',
      passwordResetRequired: true,
    })

    const oldPassword = await login('member@seqora.local', 'MemberPassword123!')
    expect(oldPassword.statusCode).toBe(401)

    const temporaryPassword = await login('member@seqora.local', 'MemberTempPassword123!')
    expect(temporaryPassword.statusCode).toBe(200)
    expect(temporaryPassword.json()).toMatchObject({
      account: {
        id: 'user-member',
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
      url: '/api/v1/admin/audit-logs?action=admin.password.temporary_set&userId=user-member',
      headers: { cookie: cookieValue(admin) },
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
    const member = await login('member@seqora.local', 'MemberPassword123!', {
      'user-agent': 'MemberSessionDevice/1.0',
    })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!', {
      'user-agent': 'OwnerSessionDevice/1.0',
    })
    const adminCookie = cookieValue(admin)

    const activeMemberSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?userId=user-member&status=active',
      headers: { cookie: adminCookie },
    })
    expect(activeMemberSessions.statusCode).toBe(200)
    expect(activeMemberSessions.json()).toMatchObject({
      items: [
        expect.objectContaining({
          userId: 'user-member',
          tenantId: 'tenant-seqora-demo',
          status: 'active',
          userAgent: 'MemberSessionDevice/1.0',
        }),
      ],
    })
    const memberSessionId = activeMemberSessions.json().items[0].sessionId

    const selfSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?userId=user-admin&status=active',
      headers: { cookie: adminCookie },
    })
    expect(selfSessions.statusCode).toBe(200)
    const adminSessionId = selfSessions.json().items[0].sessionId

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
      headers: { cookie: adminCookie },
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
      headers: { cookie: cookieValue(member) },
    })
    expect(oldMemberSession.statusCode).toBe(401)

    const revokedMemberSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/sessions?userId=user-member&status=revoked',
      headers: { cookie: adminCookie },
    })
    expect(revokedMemberSessions.statusCode).toBe(200)
    expect(revokedMemberSessions.json()).toMatchObject({
      items: [
        expect.objectContaining({
          sessionId: memberSessionId,
          userId: 'user-member',
          status: 'revoked',
          revokedAt: expect.any(String),
        }),
      ],
    })

    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs?action=admin.session.revoked&userId=user-member',
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

    const memberSecondSession = await login('member@seqora.local', 'MemberPassword123!', {
      'user-agent': 'MemberSecondDevice/1.0',
    })
    const memberThirdSession = await login('member@seqora.local', 'MemberPassword123!', {
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
      url: '/api/v1/admin/users/user-member/sessions',
      headers: { cookie: adminCookie },
    })
    expect(bulkRevoked.statusCode).toBe(200)
    expect(bulkRevoked.json()).toMatchObject({
      user: { id: 'user-member' },
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
      url: '/api/v1/admin/audit-logs?action=admin.user_sessions.revoked&userId=user-member',
      headers: { cookie: adminCookie },
    })
    expect(bulkAudit.statusCode).toBe(200)
    expect(bulkAudit.json()).toMatchObject({
      items: [
        expect.objectContaining({
          actorUserId: 'user-admin',
          resourceId: 'user-member',
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
          metadata: expect.objectContaining({ scope: 'admin_console' }),
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
      status: 'pending',
      token: expect.any(String),
    })
    expect(memberInvitation.json().tenantId).not.toBe('tenant-seqora-demo')

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: memberInvitation.json().token,
        email: 'platform-invited-member@example.com',
        name: 'Platform Invited Member',
        password: 'PlatformInvitedMember123!',
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
  })

  it('enforces admin console workspace and membership role boundaries', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')
    const superAdmin = await login('superadmin@seqora.local', 'SuperAdmin123!')
    const admin = await login('admin@seqora.local', 'Admin123!')
    const ownerCookie = cookieValue(owner)
    const superAdminCookie = cookieValue(superAdmin)
    const adminCookie = cookieValue(admin)

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
    await login('enterprise-member@example.com', 'EnterpriseMember123!', {
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
    await verifyEmailAddress('enterprise-admin@example.com')
    const crossTenantAdmin = await login('enterprise-admin@example.com', 'EnterpriseAdmin123!')
    const crossTenantAdminCookie = cookieValue(crossTenantAdmin)

    const scopedConsole = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/console?limit=100',
      headers: { cookie: adminCookie },
    })
    expect(scopedConsole.statusCode).toBe(200)
    const scopedSnapshot = scopedConsole.json()
    expect(scopedSnapshot.tenants.items.map((item: { id: string }) => item.id)).toEqual([
      'tenant-seqora-demo',
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

    const organization = await createWorkspaceFromCurrentSession(ownerCookie, 'Scoped Enterprise Organization')
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

    await verifyEmailAddress('scoped-organization-admin@example.com')
    await verifyEmailAddress('scoped-organization-member@example.com')

    const organizationAdminLogin = await login(
      'scoped-organization-admin@example.com',
      'ScopedOrganizationAdmin123!',
      { 'user-agent': 'ScopedOrganizationAdminDevice/1.0' },
    )
    expect(organizationAdminLogin.statusCode).toBe(200)
    const organizationAdminCookie = cookieValue(organizationAdminLogin)

    const organizationMemberLogin = await login(
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
      url: '/api/v1/admin/console?tenantId=tenant-seqora-demo&limit=100',
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminConsole.statusCode).toBe(200)
    const scopedSnapshot = organizationAdminConsole.json()
    expect(scopedSnapshot.organizations.items.map((item: { id: string }) => item.id)).toEqual([
      organization.tenantId,
    ])
    expect(scopedSnapshot.users.items.map((item: { id: string }) => item.id)).toContain(
      organizationMemberUserId,
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
      url: `/api/v1/admin/users?tenantId=tenant-seqora-demo&limit=100`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminListsUsers.statusCode).toBe(200)
    expect(organizationAdminListsUsers.json().items.map((item: { id: string }) => item.id)).toContain(
      organizationAdminUserId,
    )
    expect(organizationAdminListsUsers.json().items.map((item: { id: string }) => item.id)).not.toContain(
      'user-member',
    )

    const organizationAdminListsBilling = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/accounts?tenantId=tenant-seqora-demo&limit=100`,
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
    expect(adminListsOrganizationAlerts.json().items.map((item: { id: string }) => item.id)).toContain(
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
    const organizationMemberSessionId =
      ownerReadsOrganizationMemberSessions.json().items[0]?.sessionId as string | undefined
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
      error: { code: 'TENANT_SCOPE_MISMATCH' },
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

async function verifyEmailAddress(email: string): Promise<void> {
  if (!app) throw new Error('App is not ready')
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/email-verification/request',
    payload: { email },
  })
  expect(request.statusCode).toBe(202)
  const token = request.json().verificationToken as string | undefined
  expect(token).toEqual(expect.any(String))
  if (!token) throw new Error(`Expected verification token for ${email}`)

  const verified = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/email-verification/verify',
    payload: { token },
  })
  expect(verified.statusCode).toBe(204)
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
