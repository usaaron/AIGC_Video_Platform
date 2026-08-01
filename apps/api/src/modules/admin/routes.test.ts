import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'

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

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
