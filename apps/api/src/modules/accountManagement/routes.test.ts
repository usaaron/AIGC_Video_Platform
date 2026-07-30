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

describe('account management api', { timeout: 30_000 }, () => {
  it('boots seed owner and admin accounts into local auth', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'owner@seqora.local',
        password: 'OwnerPassword123!',
      },
    })
    expect(ownerLogin.statusCode).toBe(200)
    expect(ownerLogin.json()).toMatchObject({
      account: {
        email: 'owner@seqora.local',
        roles: expect.arrayContaining(['owner']),
      },
    })

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@seqora.local',
        password: 'Admin123!',
      },
    })
    expect(adminLogin.statusCode).toBe(200)
    expect(adminLogin.json()).toMatchObject({
      account: {
        email: 'admin@seqora.local',
        roles: expect.arrayContaining(['admin']),
      },
    })

    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie: cookieValue(ownerLogin) },
    })
    expect(overview.statusCode).toBe(200)
  })

  it('lets admins grant credits and adjust target memberships from the admin API', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@seqora.local',
        password: 'Admin123!',
      },
    })
    expect(adminLogin.statusCode).toBe(200)
    const adminCookie = cookieValue(adminLogin)

    const granted = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/grants',
      headers: { cookie: adminCookie },
      payload: {
        amount: 40,
        reason: 'Admin self top-up',
      },
    })
    expect(granted.statusCode).toBe(200)
    expect(granted.json()).toMatchObject({
      credits: 1_040,
      entries: expect.arrayContaining([
        expect.objectContaining({
          amount: 40,
          type: 'grant',
          description: 'Admin self top-up',
        }),
      ]),
    })

    const adjusted = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-creator/adjustments',
      headers: { cookie: adminCookie },
      payload: {
        amount: 25,
        reason: 'Creator campaign top-up',
      },
    })
    expect(adjusted.statusCode).toBe(200)
    expect(adjusted.json()).toMatchObject({
      credits: 311,
      entries: expect.arrayContaining([
        expect.objectContaining({
          amount: 25,
          type: 'adjustment',
          description: 'Creator campaign top-up',
        }),
      ]),
    })

    const corrected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-creator/adjustments',
      headers: { cookie: adminCookie },
      payload: {
        amount: -10,
        reason: 'Creator manual correction',
      },
    })
    expect(corrected.statusCode).toBe(200)
    expect(corrected.json()).toMatchObject({
      credits: 301,
      entries: expect.arrayContaining([
        expect.objectContaining({
          amount: -10,
          type: 'adjustment',
          description: 'Creator manual correction',
        }),
      ]),
    })
  })

  it('denies creator accounts from admin billing adjustments', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const creatorLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'creator@seqora.local',
        password: 'Creator123!',
      },
    })
    expect(creatorLogin.statusCode).toBe(200)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-creator/adjustments',
      headers: { cookie: cookieValue(creatorLogin) },
      payload: {
        amount: 10,
        reason: 'Unauthorized adjustment',
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
  })

  it('disables public registration and accepts invitations for account creation', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'AlicePassword123!',
        workspaceName: 'Alice Studio',
      },
    })
    expect(register.statusCode).toBe(403)
    expect(register.json()).toMatchObject({ error: { code: 'REGISTRATION_DISABLED' } })

    const accepted = await inviteAndAcceptUser('alice@example.com', 'AlicePassword123!', ['member'])
    expect(accepted.response.json()).toMatchObject({
      account: { email: 'alice@example.com', name: 'alice', tenantId: 'tenant-seqora-demo' },
      workspace: { id: 'tenant-seqora-demo', status: 'active' },
    })
    const registerCookie = accepted.cookie

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: 'AlicePassword123!' },
    })
    expect(relogin.statusCode).toBe(200)
    const reloginCookie = cookieValue(relogin)

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: reloginCookie },
    })
    expect(sessions.statusCode).toBe(200)
    const sessionList = sessions.json() as Array<{ sessionId: string; current: boolean }>
    expect(sessionList).toHaveLength(2)
    const targetSessionId = sessionList.find((session) => !session.current)?.sessionId
    expect(targetSessionId).toEqual(expect.any(String))

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${targetSessionId}`,
      headers: { cookie: reloginCookie },
    })
    expect(revoked.statusCode).toBe(204)

    const meAfterRevoke = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: registerCookie },
    })
    expect(meAfterRevoke.statusCode).toBe(401)

    const createWorkspace = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: reloginCookie },
      payload: { name: 'Alice Second Workspace' },
    })

    expect(createWorkspace.statusCode).toBe(201)
    expect(createWorkspace.json()).toMatchObject({
      workspace: { name: 'Alice Second Workspace', status: 'active' },
    })
  })

  it('creates tenant users directly and enforces owner/admin role boundaries', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await seedOwnerLogin()
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@seqora.local',
        password: 'Admin123!',
      },
    })
    expect(adminLogin.statusCode).toBe(200)
    const adminCookie = cookieValue(adminLogin)

    const createdAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-seqora-demo/users',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'created-admin@example.com',
        name: 'Created Admin',
        password: 'CreatedAdmin123!',
        role: 'admin',
      },
    })
    expect(createdAdmin.statusCode).toBe(201)
    expect(createdAdmin.json()).toMatchObject({
      email: 'created-admin@example.com',
      name: 'Created Admin',
      roles: ['admin'],
      tenantId: 'tenant-seqora-demo',
      status: 'active',
    })
    const createdAdminUserId = createdAdmin.json().userId as string

    const createdAdminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'created-admin@example.com',
        password: 'CreatedAdmin123!',
      },
    })
    expect(createdAdminLogin.statusCode).toBe(200)
    expect(createdAdminLogin.json()).toMatchObject({
      account: {
        tenantId: 'tenant-seqora-demo',
        roles: ['admin'],
      },
    })
    const createdAdminCookie = cookieValue(createdAdminLogin)

    const duplicateAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-seqora-demo/users',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'created-admin@example.com',
        name: 'Duplicate Admin',
        password: 'CreatedAdmin123!',
        role: 'admin',
      },
    })
    expect(duplicateAdmin.statusCode).toBe(409)
    expect(duplicateAdmin.json()).toMatchObject({ error: { code: 'ACCOUNT_ALREADY_EXISTS' } })

    const adminCreatesAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-seqora-demo/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'admin-created-admin@example.com',
        name: 'Admin Created Admin',
        password: 'CreatedAdmin123!',
        role: 'admin',
      },
    })
    expect(adminCreatesAdmin.statusCode).toBe(403)
    expect(adminCreatesAdmin.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })

    const adminCreatesMember = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-seqora-demo/users',
      headers: { cookie: adminCookie },
      payload: {
        email: 'admin-created-member@example.com',
        name: 'Admin Created Member',
        password: 'CreatedMember123!',
        role: 'member',
      },
    })
    expect(adminCreatesMember.statusCode).toBe(201)
    expect(adminCreatesMember.json()).toMatchObject({
      email: 'admin-created-member@example.com',
      roles: ['member'],
      tenantId: 'tenant-seqora-demo',
    })
    const memberUserId = adminCreatesMember.json().userId as string

    const memberLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin-created-member@example.com',
        password: 'CreatedMember123!',
      },
    })
    expect(memberLogin.statusCode).toBe(200)
    expect(memberLogin.json()).toMatchObject({ account: { roles: ['member'] } })
    const memberCookie = cookieValue(memberLogin)

    const adminDeletesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/tenant-seqora-demo/members/${createdAdminUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminDeletesAdmin.statusCode).toBe(403)
    expect(adminDeletesAdmin.json()).toMatchObject({
      error: { code: 'ELEVATED_MEMBERSHIP_REQUIRES_OWNER' },
    })

    const adminDeletesMember = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/tenant-seqora-demo/members/${memberUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminDeletesMember.statusCode).toBe(204)

    const memberAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: memberCookie },
    })
    expect(memberAfterDelete.statusCode).toBe(401)

    const ownerDeletesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/tenant-seqora-demo/members/${createdAdminUserId}`,
      headers: { cookie: owner.cookie },
    })
    expect(ownerDeletesAdmin.statusCode).toBe(204)

    const adminAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: createdAdminCookie },
    })
    expect(adminAfterDelete.statusCode).toBe(401)

    const creatorLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'creator@seqora.local',
        password: 'Creator123!',
      },
    })
    expect(creatorLogin.statusCode).toBe(200)

    const creatorCreatesMember = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant-seqora-demo/users',
      headers: { cookie: cookieValue(creatorLogin) },
      payload: {
        email: 'creator-created-member@example.com',
        name: 'Creator Created Member',
        password: 'CreatedMember123!',
        role: 'member',
      },
    })
    expect(creatorCreatesMember.statusCode).toBe(403)
  })

  it('lists and switches workspaces for active memberships', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await createUserWorkspace(
      'workspace-owner@example.com',
      'OwnerPassword123!',
      'Owner Workspace',
      ['owner'],
    )
    const member = await createUserWorkspace(
      'workspace-member@example.com',
      'MemberPassword123!',
      'Member Workspace',
    )

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/members`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'workspace-member@example.com',
        roles: ['member', 'member'],
      },
    })
    expect(added.statusCode).toBe(201)
    expect(added.json()).toMatchObject({
      roles: ['member'],
      tenantId: owner.tenantId,
      userId: member.userId,
    })

    const workspaces = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: { cookie: member.cookie },
    })
    expect(workspaces.statusCode).toBe(200)
    expect(workspaces.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspace: expect.objectContaining({ id: member.tenantId, name: 'Member Workspace' }),
          membership: expect.objectContaining({ roles: expect.arrayContaining(['owner']) }),
        }),
        expect.objectContaining({
          workspace: expect.objectContaining({ id: owner.tenantId, name: 'Owner Workspace' }),
          membership: expect.objectContaining({ roles: ['member'] }),
        }),
      ]),
    )

    const switched = await switchWorkspace(member.cookie, owner.tenantId)
    expect(switched.statusCode).toBe(200)
    expect(switched.json()).toMatchObject({
      account: {
        id: member.userId,
        tenantId: owner.tenantId,
        roles: ['member'],
      },
      workspace: {
        id: owner.tenantId,
        name: 'Owner Workspace',
      },
    })

    const switchedCookie = cookieValue(switched)
    const current = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: switchedCookie },
    })
    expect(current.statusCode).toBe(200)
    expect(current.json()).toMatchObject({
      account: {
        id: member.userId,
        tenantId: owner.tenantId,
        roles: ['member'],
      },
    })

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: switchedCookie },
    })
    expect(sessions.statusCode).toBe(200)
    expect(sessions.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: member.userId,
          tenantId: owner.tenantId,
          current: true,
        }),
      ]),
    )
  })

  it('enforces owner boundaries for elevated memberships and tenant sessions', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await createUserWorkspace(
      'boundary-owner@example.com',
      'OwnerPassword123!',
      'Boundary Workspace',
      ['owner'],
    )
    const admin = await createUserWorkspace(
      'boundary-admin@example.com',
      'AdminPassword123!',
      'Admin Workspace',
    )
    const member = await createUserWorkspace(
      'boundary-member@example.com',
      'MemberPassword123!',
      'Member Workspace',
    )

    const addAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/members`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'boundary-admin@example.com',
        roles: ['admin'],
      },
    })
    expect(addAdmin.statusCode).toBe(201)

    const addMember = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/members`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'boundary-member@example.com',
        roles: ['member'],
      },
    })
    expect(addMember.statusCode).toBe(201)

    const adminSwitch = await switchWorkspace(admin.cookie, owner.tenantId)
    const adminCookie = cookieValue(adminSwitch)

    const selfRoleChange = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${owner.tenantId}/members/${owner.userId}/roles`,
      headers: { cookie: owner.cookie },
      payload: { roles: ['member'] },
    })
    expect(selfRoleChange.statusCode).toBe(400)
    expect(selfRoleChange.json()).toMatchObject({ error: { code: 'CANNOT_CHANGE_SELF_ROLES' } })

    const demoteOwner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${owner.tenantId}/members/${owner.userId}/roles`,
      headers: { cookie: adminCookie },
      payload: { roles: ['member'] },
    })
    expect(demoteOwner.statusCode).toBe(403)
    expect(demoteOwner.json()).toMatchObject({
      error: { code: 'ELEVATED_MEMBERSHIP_REQUIRES_OWNER' },
    })

    const disableOwner = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/members/${owner.userId}`,
      headers: { cookie: adminCookie },
    })
    expect(disableOwner.statusCode).toBe(403)
    expect(disableOwner.json()).toMatchObject({
      error: { code: 'ELEVATED_MEMBERSHIP_REQUIRES_OWNER' },
    })

    const promoteMember = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${owner.tenantId}/members/${member.userId}/roles`,
      headers: { cookie: adminCookie },
      payload: { roles: ['admin'] },
    })
    expect(promoteMember.statusCode).toBe(403)
    expect(promoteMember.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })

    const tenantSessions = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${owner.tenantId}/sessions`,
      headers: { cookie: adminCookie },
    })
    expect(tenantSessions.statusCode).toBe(200)
    const sessionList = tenantSessions.json() as Array<{
      sessionId: string
      userId: string
      current: boolean
    }>
    const ownerSession = sessionList.find((session) => session.userId === owner.userId)
    const adminSession = sessionList.find((session) => session.userId === admin.userId && session.current)
    expect(ownerSession?.sessionId).toEqual(expect.any(String))
    expect(adminSession?.sessionId).toEqual(expect.any(String))

    const revokeOwnerSession = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/sessions/${ownerSession?.sessionId}`,
      headers: { cookie: adminCookie },
    })
    expect(revokeOwnerSession.statusCode).toBe(403)
    expect(revokeOwnerSession.json()).toMatchObject({
      error: { code: 'ELEVATED_SESSION_REQUIRES_OWNER' },
    })

    const revokeOwnAdminSession = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/sessions/${adminSession?.sessionId}`,
      headers: { cookie: adminCookie },
    })
    expect(revokeOwnAdminSession.statusCode).toBe(400)
    expect(revokeOwnAdminSession.json()).toMatchObject({
      error: { code: 'CANNOT_REVOKE_SELF_SESSION' },
    })

    const disableMember = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/members/${member.userId}`,
      headers: { cookie: adminCookie },
    })
    expect(disableMember.statusCode).toBe(204)

    const disabledSwitch = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.tenantId}/switch`,
      headers: { cookie: member.cookie },
    })
    expect(disabledSwitch.statusCode).toBe(404)
    expect(disabledSwitch.json()).toMatchObject({ error: { code: 'WORKSPACE_NOT_FOUND' } })

    const ownerRevokesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/sessions/${adminSession?.sessionId}`,
      headers: { cookie: owner.cookie },
    })
    expect(ownerRevokesAdmin.statusCode).toBe(204)

    const adminAfterRevoke = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: adminCookie },
    })
    expect(adminAfterRevoke.statusCode).toBe(401)
  })

  it('creates, lists and revokes tenant invitations', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await createUserWorkspace(
      'invites-owner@example.com',
      'OwnerPassword123!',
      'Owner Workspace',
      ['owner'],
    )

    const createInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/invitations`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['member'],
      },
    })
    expect(createInvitation.statusCode).toBe(201)
    expect(createInvitation.json()).toMatchObject({
      email: 'member@example.com',
      tenantId: owner.tenantId,
      roles: ['member'],
      status: 'pending',
      token: expect.any(String),
    })
    const firstInvitation = createInvitation.json() as { id: string; token: string }

    const reissuedInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/invitations`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['member'],
      },
    })
    expect(reissuedInvitation.statusCode).toBe(201)
    expect(reissuedInvitation.json()).toMatchObject({
      id: firstInvitation.id,
      email: 'member@example.com',
      status: 'pending',
      token: expect.any(String),
    })
    expect(reissuedInvitation.json().token).not.toBe(firstInvitation.token)

    const acceptOldToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: {
        token: firstInvitation.token,
        name: 'member',
        password: 'MemberPassword123!',
      },
    })
    expect(acceptOldToken.statusCode).toBe(404)
    expect(acceptOldToken.json()).toMatchObject({ error: { code: 'INVITATION_NOT_FOUND' } })

    const invitations = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${owner.tenantId}/invitations`,
      headers: { cookie: owner.cookie },
    })
    expect(invitations.statusCode).toBe(200)
    expect(invitations.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstInvitation.id,
          email: 'member@example.com',
          status: 'pending',
        }),
      ]),
    )

    const acceptInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: {
        token: reissuedInvitation.json().token,
        name: 'member',
        password: 'MemberPassword123!',
      },
    })
    expect(acceptInvitation.statusCode).toBe(201)
    expect(acceptInvitation.json()).toMatchObject({
      account: {
        email: 'member@example.com',
        tenantId: owner.tenantId,
        roles: ['member'],
      },
    })

    const revokedAccepted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/invitations/${firstInvitation.id}`,
      headers: { cookie: owner.cookie },
    })
    expect(revokedAccepted.statusCode).toBe(404)

    const secondInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/invitations`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'revoked@example.com',
        roles: ['member'],
      },
    })
    expect(secondInvitation.statusCode).toBe(201)

    const revokedPending = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/invitations/${secondInvitation.json().id}`,
      headers: { cookie: owner.cookie },
    })
    expect(revokedPending.statusCode).toBe(204)

    const acceptRevoked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: {
        token: secondInvitation.json().token,
        name: 'revoked',
        password: 'MemberPassword123!',
      },
    })
    expect(acceptRevoked.statusCode).toBe(409)
    expect(acceptRevoked.json()).toMatchObject({ error: { code: 'INVITATION_NOT_PENDING' } })
  })

  it('adds registered members, updates roles and disables memberships', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await createUserWorkspace('owner@example.com', 'OwnerPassword123!', 'Owner Workspace', [
      'owner',
    ])
    const member = await createUserWorkspace('member@example.com', 'MemberPassword123!', 'Member Workspace')

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/members`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['member'],
      },
    })

    expect(added.statusCode).toBe(201)
    expect(added.json()).toMatchObject({
      email: 'member@example.com',
      roles: ['member'],
      tenantId: owner.tenantId,
      userId: member.userId,
    })

    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${owner.tenantId}/members`,
      headers: { cookie: owner.cookie },
    })
    expect(members.statusCode).toBe(200)
    expect(members.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'owner@example.com', roles: expect.arrayContaining(['owner']) }),
        expect.objectContaining({ email: 'member@example.com', roles: expect.arrayContaining(['member']) }),
      ]),
    )

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${owner.tenantId}/members/${member.userId}/roles`,
      headers: { cookie: owner.cookie },
      payload: { roles: ['admin'] },
    })
    expect(promoted.statusCode).toBe(200)
    expect(promoted.json()).toMatchObject({ roles: ['admin'] })

    const disabled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/members/${member.userId}`,
      headers: { cookie: owner.cookie },
    })
    expect(disabled.statusCode).toBe(204)

    const disabledMembers = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${owner.tenantId}/members`,
      headers: { cookie: owner.cookie },
    })
    expect(disabledMembers.statusCode).toBe(200)
    expect(disabledMembers.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'member@example.com', status: 'disabled' })]),
    )
  })

  it('disables accounts for the whole tenant and blocks future logins', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await createUserWorkspace('owner2@example.com', 'OwnerPassword123!', 'Owner Workspace 2', [
      'owner',
    ])
    const member = await createUserWorkspace(
      'member2@example.com',
      'MemberPassword123!',
      'Member Workspace 2',
    )
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/members`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'member2@example.com',
        roles: ['member'],
      },
    })
    expect(added.statusCode).toBe(201)

    const disabled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${owner.tenantId}/accounts/${member.userId}`,
      headers: { cookie: owner.cookie },
    })
    expect(disabled.statusCode).toBe(204)

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member2@example.com', password: 'MemberPassword123!' },
    })
    expect(relogin.statusCode).toBe(401)
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

async function createUserWorkspace(
  email: string,
  password: string,
  workspaceName: string,
  seedRoles: string[] = ['member'],
) {
  if (!app) throw new Error('App is not ready')
  const accepted = await inviteAndAcceptUser(email, password, seedRoles)
  const workspace = await app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    headers: { cookie: accepted.cookie },
    payload: { name: workspaceName },
  })
  expect(workspace.statusCode).toBe(201)
  return {
    userId: workspace.json().account.id as string,
    tenantId: workspace.json().account.tenantId as string,
    cookie: cookieValue(workspace),
  }
}

async function inviteAndAcceptUser(email: string, password: string, roles: string[] = ['member']) {
  if (!app) throw new Error('App is not ready')
  const owner = await seedOwnerLogin()
  const invitation = await app.inject({
    method: 'POST',
    url: '/api/v1/tenants/tenant-seqora-demo/invitations',
    headers: { cookie: owner.cookie },
    payload: {
      email,
      roles,
    },
  })
  expect(invitation.statusCode).toBe(201)

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/invitations/accept',
    payload: {
      token: invitation.json().token,
      name: email.split('@')[0],
      password,
    },
  })
  expect(response.statusCode).toBe(201)
  return {
    response,
    userId: response.json().account.id as string,
    tenantId: response.json().account.tenantId as string,
    cookie: cookieValue(response),
  }
}

async function seedOwnerLogin() {
  if (!app) throw new Error('App is not ready')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      email: 'owner@seqora.local',
      password: 'OwnerPassword123!',
    },
  })
  expect(response.statusCode).toBe(200)
  return { cookie: cookieValue(response) }
}

async function switchWorkspace(cookie: string, tenantId: string) {
  if (!app) throw new Error('App is not ready')
  return await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${tenantId}/switch`,
    headers: { cookie },
  })
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
