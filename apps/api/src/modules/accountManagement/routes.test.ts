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
  it('boots seed owner, super admin and admin accounts into local auth', async () => {
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

    const superAdminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'superadmin@seqora.local',
        password: 'SuperAdmin123!',
      },
    })
    expect(superAdminLogin.statusCode).toBe(200)
    expect(superAdminLogin.json()).toMatchObject({
      account: {
        email: 'superadmin@seqora.local',
        roles: expect.arrayContaining(['super_admin']),
      },
    })

    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie: cookieValue(ownerLogin) },
    })
    expect(overview.statusCode).toBe(200)
  })

  it('marks tenant and workspace compatibility routes as deprecated', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'owner@seqora.local',
        password: 'OwnerPassword123!',
      },
    })
    const ownerCookie = cookieValue(ownerLogin)

    const organizations = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations',
      headers: { cookie: ownerCookie },
    })
    expect(organizations.statusCode).toBe(200)
    expect(organizations.headers.deprecation).toBeUndefined()

    const workspaces = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: { cookie: ownerCookie },
    })
    expect(workspaces.statusCode).toBe(200)
    expect(workspaces.headers.deprecation).toBe('true')
    expect(workspaces.headers.link).toContain('/api/v1/organizations')

    const createdWorkspace = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: ownerCookie },
      payload: { name: 'Deprecated Workspace Route' },
    })
    expect(createdWorkspace.statusCode).toBe(201)
    expect(createdWorkspace.headers.deprecation).toBe('true')
    expect(createdWorkspace.headers.link).toContain('/api/v1/organizations')

    const tenantMembers = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-seqora-demo/members',
      headers: { cookie: ownerCookie },
    })
    expect(tenantMembers.statusCode).toBe(200)
    expect(tenantMembers.headers.deprecation).toBe('true')
    expect(tenantMembers.headers.link).toContain('/api/v1/organizations/tenant-seqora-demo/members')

    const tenantInvitations = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-seqora-demo/invitations',
      headers: { cookie: ownerCookie },
    })
    expect(tenantInvitations.statusCode).toBe(200)
    expect(tenantInvitations.headers.deprecation).toBe('true')
    expect(tenantInvitations.headers.link).toContain('/api/v1/organizations/tenant-seqora-demo/invitations')

    const tenantSessions = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant-seqora-demo/sessions',
      headers: { cookie: ownerCookie },
    })
    expect(tenantSessions.statusCode).toBe(200)
    expect(tenantSessions.headers.deprecation).toBe('true')
    expect(tenantSessions.headers.link).toContain('/api/v1/organizations/tenant-seqora-demo/sessions')

    const oldTransfer = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/tenant-seqora-demo/organization-admin-transfer',
      headers: { cookie: ownerCookie },
      payload: { targetUserId: 'user-member' },
    })
    expect(oldTransfer.statusCode).toBe(403)
    expect(oldTransfer.headers.deprecation).toBe('true')
    expect(oldTransfer.headers.link).toContain('/api/v1/organizations/tenant-seqora-demo/admin-transfer')

    const adminTenants = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tenants',
      headers: { cookie: ownerCookie },
    })
    expect(adminTenants.statusCode).toBe(200)
    expect(adminTenants.headers.deprecation).toBe('true')
    expect(adminTenants.headers.link).toContain('/api/v1/admin/organizations')

    const adminTenantUser = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/tenant-seqora-demo/users',
      headers: { cookie: ownerCookie },
      payload: {
        email: 'deprecated-admin-tenant-member@example.com',
        name: 'Deprecated Tenant Member',
        password: 'DeprecatedTenantMember123!',
        role: 'member',
      },
    })
    expect(adminTenantUser.statusCode).toBe(409)
    expect(adminTenantUser.headers.deprecation).toBe('true')
    expect(adminTenantUser.headers.link).toContain('/api/v1/admin/organizations/tenant-seqora-demo/users')
  })

  it('rejects creator roles from new account management inputs', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await seedOwnerLogin()
    const createdUser = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'creator-input-user@example.com',
        name: 'Creator Input User',
        password: 'CreatorInputUser123!',
        role: 'creator',
      },
    })
    expect(createdUser.statusCode).toBe(400)
    expect(createdUser.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

    const invitation = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/invitations',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'creator-input-invitation@example.com',
        roles: ['creator'],
      },
    })
    expect(invitation.statusCode).toBe(400)
    expect(invitation.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

    const roleUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/tenant-seqora-demo/members/user-member/roles',
      headers: { cookie: owner.cookie },
      payload: { roles: ['creator'] },
    })
    expect(roleUpdate.statusCode).toBe(400)
    expect(roleUpdate.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
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
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-member/adjustments',
      headers: { cookie: adminCookie },
      payload: {
        amount: 25,
        reason: 'Member campaign top-up',
      },
    })
    expect(adjusted.statusCode).toBe(200)
    expect(adjusted.json()).toMatchObject({
      credits: 311,
      entries: expect.arrayContaining([
        expect.objectContaining({
          amount: 25,
          type: 'adjustment',
          description: 'Member campaign top-up',
        }),
      ]),
    })

    const corrected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-member/adjustments',
      headers: { cookie: adminCookie },
      payload: {
        amount: -10,
        reason: 'Member manual correction',
      },
    })
    expect(corrected.statusCode).toBe(200)
    expect(corrected.json()).toMatchObject({
      credits: 301,
      entries: expect.arrayContaining([
        expect.objectContaining({
          amount: -10,
          type: 'adjustment',
          description: 'Member manual correction',
        }),
      ]),
    })
  })

  it('denies member accounts from admin billing adjustments', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const memberLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'member@seqora.local',
        password: 'MemberPassword123!',
      },
    })
    expect(memberLogin.statusCode).toBe(200)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-member/adjustments',
      headers: { cookie: cookieValue(memberLogin) },
      payload: {
        amount: 10,
        reason: 'Unauthorized adjustment',
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
  })

  it('separates platform registration invitations from organization membership invitations', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const missingInvitationCode = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'AlicePassword123!',
      },
    })
    expect(missingInvitationCode.statusCode).toBe(400)
    expect(missingInvitationCode.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

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

    const platformInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie: adminCookie },
      payload: {
        email: 'scoped-platform-member@example.com',
        roles: ['member'],
      },
    })
    expect(platformInvitation.statusCode).toBe(201)
    expect(platformInvitation.json()).toMatchObject({
      email: 'scoped-platform-member@example.com',
      roles: ['member'],
      scope: 'platform_registration',
      status: 'pending',
      token: expect.stringMatching(/^\d{8}$/),
    })
    const platformTenantId = platformInvitation.json().tenantId as string
    const platformInvitationToken = platformInvitation.json().token as string
    expect(platformTenantId).not.toBe('tenant-seqora-demo')

    const directPlatformAcceptance = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: {
        token: platformInvitationToken,
        name: 'Scoped Platform Member',
        password: 'ScopedPlatformMember123!',
      },
    })
    expect(directPlatformAcceptance.statusCode).toBe(400)
    expect(directPlatformAcceptance.json()).toMatchObject({
      error: { code: 'REGISTRATION_CODE_REQUIRED' },
    })

    const wrongEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/registration-code/request',
      payload: {
        token: platformInvitationToken,
        email: 'wrong-scoped-platform-member@example.com',
      },
    })
    expect(wrongEmail.statusCode).toBe(400)
    expect(wrongEmail.json()).toMatchObject({ error: { code: 'INVITATION_EMAIL_MISMATCH' } })

    const registrationCodeRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/registration-code/request',
      payload: {
        token: platformInvitationToken,
        email: 'scoped-platform-member@example.com',
      },
    })
    expect(registrationCodeRequest.statusCode).toBe(202)
    expect(registrationCodeRequest.json()).toMatchObject({
      ok: true,
      registrationCode: expect.stringMatching(/^\d{6}$/),
      resendAfterSeconds: 60,
    })
    const registrationCode = registrationCodeRequest.json().registrationCode as string

    const wrongCode = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: platformInvitationToken,
        name: 'Scoped Platform Member',
        email: 'scoped-platform-member@example.com',
        password: 'ScopedPlatformMember123!',
        verificationCode: registrationCode === '000000' ? '999999' : '000000',
      },
    })
    expect(wrongCode.statusCode).toBe(400)
    expect(wrongCode.json()).toMatchObject({ error: { code: 'REGISTRATION_CODE_INVALID' } })

    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: platformInvitationToken,
        name: 'Scoped Platform Member',
        email: 'scoped-platform-member@example.com',
        password: 'ScopedPlatformMember123!',
        verificationCode: registrationCode,
      },
    })
    expect(register.statusCode).toBe(201)
    expect(register.json()).toMatchObject({
      account: {
        email: 'scoped-platform-member@example.com',
        name: 'Scoped Platform Member',
        tenantId: platformTenantId,
        organizationId: platformTenantId,
        roles: ['member'],
        emailVerified: true,
        credits: 2_000,
      },
      workspace: { id: platformTenantId, status: 'active' },
      organization: { id: platformTenantId, status: 'active' },
    })
    const platformUserId = register.json().account.id as string

    const platformMemberships = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/memberships?tenantId=${platformTenantId}&userId=${platformUserId}&limit=100`,
      headers: { cookie: adminCookie },
    })
    expect(platformMemberships.statusCode).toBe(200)
    expect(platformMemberships.json().items).toEqual([
      expect.objectContaining({
        userId: platformUserId,
        email: 'scoped-platform-member@example.com',
        roles: ['member'],
        isPrimary: true,
        organizationType: 'personal',
      }),
    ])

    const enterpriseOrganization = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: owner.cookie },
      payload: { name: 'Scoped Enterprise Organization' },
    })
    expect(enterpriseOrganization.statusCode).toBe(201)
    const enterpriseTenantId = enterpriseOrganization.json().organization.id as string

    const organizationInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${enterpriseTenantId}/invitations`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'scoped-organization-member@example.com',
        roles: ['organization_member'],
      },
    })
    expect(organizationInvitation.statusCode).toBe(201)
    expect(organizationInvitation.json()).toMatchObject({
      email: 'scoped-organization-member@example.com',
      tenantId: enterpriseTenantId,
      roles: ['organization_member'],
      scope: 'organization_membership',
      status: 'pending',
      token: expect.stringMatching(/^\d{8}$/),
    })
    const organizationInvitationToken = organizationInvitation.json().token as string

    const organizationCodeRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/registration-code/request',
      payload: {
        token: organizationInvitationToken,
        email: 'scoped-organization-member@example.com',
      },
    })
    expect(organizationCodeRequest.statusCode).toBe(400)
    expect(organizationCodeRequest.json()).toMatchObject({
      error: { code: 'PLATFORM_REGISTRATION_INVITATION_REQUIRED' },
    })

    const organizationRegister = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: organizationInvitationToken,
        name: 'Scoped Organization Member',
        email: 'scoped-organization-member@example.com',
        password: 'ScopedOrganizationMember123!',
        verificationCode: '000000',
      },
    })
    expect(organizationRegister.statusCode).toBe(400)
    expect(organizationRegister.json()).toMatchObject({
      error: { code: 'PLATFORM_REGISTRATION_INVITATION_REQUIRED' },
    })

    const organizationAccept = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: {
        token: organizationInvitationToken,
        name: 'Scoped Organization Member',
        password: 'ScopedOrganizationMember123!',
      },
    })
    expect(organizationAccept.statusCode).toBe(201)
    expect(organizationAccept.json()).toMatchObject({
      account: {
        email: 'scoped-organization-member@example.com',
        tenantId: enterpriseTenantId,
        organizationId: enterpriseTenantId,
        roles: ['organization_member'],
      },
    })
    const organizationMemberUserId = organizationAccept.json().account.id as string

    const organizationMemberships = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/memberships?tenantId=${enterpriseTenantId}&userId=${organizationMemberUserId}&limit=100`,
      headers: { cookie: owner.cookie },
    })
    expect(organizationMemberships.statusCode).toBe(200)
    expect(organizationMemberships.json().items).toEqual([
      expect.objectContaining({
        userId: organizationMemberUserId,
        email: 'scoped-organization-member@example.com',
        roles: ['organization_member'],
        isPrimary: false,
        organizationType: 'enterprise',
      }),
    ])

    const adminUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?q=scoped-&limit=100',
      headers: { cookie: adminCookie },
    })
    expect(adminUsers.statusCode).toBe(200)
    expect(adminUsers.json().items.map((item: { email: string }) => item.email)).toContain(
      'scoped-platform-member@example.com',
    )
    expect(adminUsers.json().items.map((item: { email: string }) => item.email)).not.toContain(
      'scoped-organization-member@example.com',
    )

    const ownerUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?q=scoped-&limit=100',
      headers: { cookie: owner.cookie },
    })
    expect(ownerUsers.statusCode).toBe(200)
    expect(ownerUsers.json().items.map((item: { email: string }) => item.email)).toEqual(
      expect.arrayContaining([
        'scoped-platform-member@example.com',
        'scoped-organization-member@example.com',
      ]),
    )

    const reusedInvitationCode = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: platformInvitationToken,
        name: 'Scoped Platform Member',
        email: 'scoped-platform-member@example.com',
        password: 'ScopedPlatformMember123!',
        verificationCode: registrationCode,
      },
    })
    expect(reusedInvitationCode.statusCode).toBe(409)
    expect(reusedInvitationCode.json()).toMatchObject({ error: { code: 'INVITATION_NOT_PENDING' } })

    const registerCookie = cookieValue(register)

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'scoped-platform-member@example.com', password: 'ScopedPlatformMember123!' },
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
      url: '/api/v1/organizations',
      headers: { cookie: reloginCookie },
      payload: { name: 'Scoped Platform Second Workspace' },
    })

    expect(createWorkspace.statusCode).toBe(201)
    expect(createWorkspace.json()).toMatchObject({
      account: { roles: ['member'] },
      workspace: { name: 'Scoped Platform Second Workspace', status: 'active' },
      organization: { name: 'Scoped Platform Second Workspace', status: 'active' },
    })

    const createOrganization = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: reloginCookie },
      payload: { name: 'Scoped Platform Third Organization' },
    })
    expect(createOrganization.statusCode).toBe(201)
    expect(createOrganization.json()).toMatchObject({
      account: { roles: ['member'] },
      organization: { name: 'Scoped Platform Third Organization', status: 'active' },
    })

    const organizations = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations',
      headers: { cookie: cookieValue(createOrganization) },
    })
    expect(organizations.statusCode).toBe(200)
    expect(organizations.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspace: expect.objectContaining({ name: 'Scoped Platform Third Organization' }),
          organization: expect.objectContaining({ name: 'Scoped Platform Third Organization' }),
          membership: expect.objectContaining({
            organizationId: createOrganization.json().organization.id,
            organizationName: 'Scoped Platform Third Organization',
          }),
        }),
      ]),
    )

    const switchedOrganization = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${createWorkspace.json().organization.id}/switch`,
      headers: { cookie: cookieValue(createOrganization) },
    })
    expect(switchedOrganization.statusCode).toBe(200)
    expect(switchedOrganization.json()).toMatchObject({
      account: {
        tenantId: createWorkspace.json().organization.id,
        organizationId: createWorkspace.json().organization.id,
      },
      organization: { id: createWorkspace.json().organization.id },
    })
  })

  it('uses one-time platform registration codes and allows duplicate display names', async () => {
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
    const createPlatformInvitation = async (email: string) =>
      await app!.inject({
        method: 'POST',
        url: '/api/v1/admin/invitations',
        headers: { cookie: adminCookie },
        payload: { email, roles: ['member'] },
      })

    const firstInvitation = await createPlatformInvitation('open-first@example.com')
    expect(firstInvitation.statusCode).toBe(201)
    expect(firstInvitation.json()).toMatchObject({
      email: 'open-first@example.com',
      roles: ['member'],
      scope: 'platform_registration',
      status: 'pending',
      token: expect.stringMatching(/^\d{8}$/),
    })
    const firstToken = firstInvitation.json().token as string

    const directAcceptance = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: {
        token: firstToken,
        name: 'Shared Name',
        password: 'SharedPassword123!',
      },
    })
    expect(directAcceptance.statusCode).toBe(400)
    expect(directAcceptance.json()).toMatchObject({ error: { code: 'REGISTRATION_CODE_REQUIRED' } })

    const firstCodeRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/registration-code/request',
      payload: { token: firstToken, email: 'open-first@example.com' },
    })
    expect(firstCodeRequest.statusCode).toBe(202)
    const firstVerificationCode = firstCodeRequest.json().registrationCode as string
    expect(firstVerificationCode).toMatch(/^\d{6}$/)

    const differentEmailInvitation = await createPlatformInvitation('open-other@example.com')
    expect(differentEmailInvitation.statusCode).toBe(201)
    const differentEmailRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/registration-code/request',
      payload: { token: differentEmailInvitation.json().token, email: 'open-first@example.com' },
    })
    expect(differentEmailRequest.statusCode).toBe(400)
    expect(differentEmailRequest.json()).toMatchObject({
      error: { code: 'INVITATION_EMAIL_MISMATCH' },
    })

    const firstRegistration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: firstToken,
        name: 'Shared Name',
        email: 'open-first@example.com',
        password: 'SharedPassword123!',
        verificationCode: firstVerificationCode,
      },
    })
    expect(firstRegistration.statusCode).toBe(201)
    expect(firstRegistration.json()).toMatchObject({
      account: { email: 'open-first@example.com', name: 'Shared Name', emailVerified: true },
    })

    const reusedInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: firstToken,
        name: 'Another Name',
        email: 'open-first@example.com',
        password: 'SharedPassword123!',
        verificationCode: firstVerificationCode,
      },
    })
    expect(reusedInvitation.statusCode).toBe(409)
    expect(reusedInvitation.json()).toMatchObject({ error: { code: 'INVITATION_NOT_PENDING' } })

    const secondInvitation = await createPlatformInvitation('open-second@example.com')
    expect(secondInvitation.statusCode).toBe(201)
    expect(secondInvitation.json()).toMatchObject({
      email: 'open-second@example.com',
      token: expect.stringMatching(/^\d{8}$/),
    })
    expect(secondInvitation.json().token).not.toBe(firstToken)

    const secondToken = secondInvitation.json().token as string
    const secondCodeRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/registration-code/request',
      payload: { token: secondToken, email: 'open-second@example.com' },
    })
    expect(secondCodeRequest.statusCode).toBe(202)

    const secondRegistration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        token: secondToken,
        name: 'Shared Name',
        email: 'open-second@example.com',
        password: 'SecondPassword123!',
        verificationCode: secondCodeRequest.json().registrationCode,
      },
    })
    expect(secondRegistration.statusCode).toBe(201)
    expect(secondRegistration.json()).toMatchObject({
      account: { email: 'open-second@example.com', name: 'Shared Name', emailVerified: true },
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

    const superAdminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'superadmin@seqora.local',
        password: 'SuperAdmin123!',
      },
    })
    expect(superAdminLogin.statusCode).toBe(200)
    const superAdminCookie = cookieValue(superAdminLogin)

    const ownerCreatesSuperAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'created-super-admin@example.com',
        name: 'Created Super Admin',
        password: 'CreatedSuperAdmin123!',
        role: 'super_admin',
      },
    })
    expect(ownerCreatesSuperAdmin.statusCode).toBe(201)
    expect(ownerCreatesSuperAdmin.json()).toMatchObject({
      email: 'created-super-admin@example.com',
      name: 'Created Super Admin',
      roles: ['super_admin'],
      tenantId: 'tenant-seqora-demo',
      status: 'active',
    })
    const createdSuperAdminUserId = ownerCreatesSuperAdmin.json().userId as string

    const superAdminCreatesAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
      headers: { cookie: superAdminCookie },
      payload: {
        email: 'super-admin-created-admin@example.com',
        name: 'Super Admin Created Admin',
        password: 'CreatedAdmin123!',
        role: 'admin',
      },
    })
    expect(superAdminCreatesAdmin.statusCode).toBe(201)
    expect(superAdminCreatesAdmin.json()).toMatchObject({
      email: 'super-admin-created-admin@example.com',
      roles: ['admin'],
      tenantId: 'tenant-seqora-demo',
    })
    const superAdminCreatedAdminUserId = superAdminCreatesAdmin.json().userId as string

    const superAdminCreatesSuperAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
      headers: { cookie: superAdminCookie },
      payload: {
        email: 'super-admin-created-super-admin@example.com',
        name: 'Super Admin Created Super Admin',
        password: 'CreatedSuperAdmin123!',
        role: 'super_admin',
      },
    })
    expect(superAdminCreatesSuperAdmin.statusCode).toBe(403)
    expect(superAdminCreatesSuperAdmin.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })

    const createdAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
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
    const createdAdminLogin = await activateProvisionedAccount(
      'created-admin@example.com',
      'CreatedAdmin123!',
    )
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
      url: '/api/v1/organizations/tenant-seqora-demo/users',
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
      url: '/api/v1/organizations/tenant-seqora-demo/users',
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

    const adminManagedTenant = await createTenantUserInFreshWorkspace(
      'tenant-admin-for-members@example.com',
      'TenantAdminForMembers123!',
      'Admin Managed Workspace',
      'admin',
    )

    const adminCreatesMember = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${adminManagedTenant.tenantId}/users`,
      headers: { cookie: adminManagedTenant.cookie },
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
      tenantId: adminManagedTenant.tenantId,
    })
    const memberUserId = adminCreatesMember.json().userId as string
    const organizationAdmin = await createOrganizationAdminWorkspace(
      'created-org-admin@example.com',
      'CreatedOrgAdmin123!',
      'Created Organization Workspace',
    )
    const organizationAdminUserId = organizationAdmin.userId
    const organizationAdminCookie = organizationAdmin.cookie

    const organizationAdminCreatesMember = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/users`,
      headers: { cookie: organizationAdminCookie },
      payload: {
        email: 'org-admin-created-member@example.com',
        name: 'Org Admin Created Member',
        password: 'OrgAdminCreatedMember123!',
        role: 'member',
      },
    })
    expect(organizationAdminCreatesMember.statusCode).toBe(403)

    const organizationAdminCreatesOrganizationMember = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/users`,
      headers: { cookie: organizationAdminCookie },
      payload: {
        email: 'org-admin-created-org-member@example.com',
        name: 'Org Admin Created Org Member',
        password: 'OrgAdminCreatedOrgMember123!',
        role: 'organization_member',
      },
    })
    expect(organizationAdminCreatesOrganizationMember.statusCode).toBe(201)
    expect(organizationAdminCreatesOrganizationMember.json()).toMatchObject({
      roles: ['organization_member'],
      organizationId: organizationAdmin.tenantId,
    })
    const organizationMemberUserId = organizationAdminCreatesOrganizationMember.json().userId as string

    const memberLogin = await activateProvisionedAccount(
      'admin-created-member@example.com',
      'CreatedMember123!',
    )
    expect(memberLogin.statusCode).toBe(200)
    expect(memberLogin.json()).toMatchObject({ account: { roles: ['member'] } })
    const memberCookie = cookieValue(memberLogin)

    const adminDeletesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/tenant-seqora-demo/members/${createdAdminUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminDeletesAdmin.statusCode).toBe(403)
    expect(adminDeletesAdmin.json()).toMatchObject({
      error: { code: 'ELEVATED_MEMBERSHIP_REQUIRES_PLATFORM_ADMIN' },
    })

    const superAdminDeletesSuperAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/tenant-seqora-demo/members/${createdSuperAdminUserId}`,
      headers: { cookie: superAdminCookie },
    })
    expect(superAdminDeletesSuperAdmin.statusCode).toBe(403)
    expect(superAdminDeletesSuperAdmin.json()).toMatchObject({
      error: { code: 'ELEVATED_MEMBERSHIP_REQUIRES_OWNER' },
    })

    const superAdminDeletesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/tenant-seqora-demo/members/${superAdminCreatedAdminUserId}`,
      headers: { cookie: superAdminCookie },
    })
    expect(superAdminDeletesAdmin.statusCode).toBe(204)

    const adminDeletesMember = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${adminManagedTenant.tenantId}/members/${memberUserId}`,
      headers: { cookie: adminManagedTenant.cookie },
    })
    expect(adminDeletesMember.statusCode).toBe(204)

    const adminDeletesOrganizationMember = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${organizationMemberUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminDeletesOrganizationMember.statusCode).toBe(403)

    const organizationAdminDeletesMember = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${adminManagedTenant.tenantId}/members/${memberUserId}`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminDeletesMember.statusCode).toBe(403)

    const organizationAdminDeletesOrganizationMember = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${organizationMemberUserId}`,
      headers: { cookie: organizationAdminCookie },
    })
    expect(organizationAdminDeletesOrganizationMember.statusCode).toBe(204)

    const adminDeletesOrganizationAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${organizationAdminUserId}`,
      headers: { cookie: adminCookie },
    })
    expect(adminDeletesOrganizationAdmin.statusCode).toBe(403)

    const memberAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: memberCookie },
    })
    expect(memberAfterDelete.statusCode).toBe(401)

    const ownerDeletesAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/tenant-seqora-demo/members/${createdAdminUserId}`,
      headers: { cookie: owner.cookie },
    })
    expect(ownerDeletesAdmin.statusCode).toBe(204)

    const adminAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: createdAdminCookie },
    })
    expect(adminAfterDelete.statusCode).toBe(401)

    const defaultMemberLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'member@seqora.local',
        password: 'MemberPassword123!',
      },
    })
    expect(defaultMemberLogin.statusCode).toBe(200)

    const memberCreatesMember = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
      headers: { cookie: cookieValue(defaultMemberLogin) },
      payload: {
        email: 'member-created-member@example.com',
        name: 'Member Created Member',
        password: 'CreatedMember123!',
        role: 'member',
      },
    })
    expect(memberCreatesMember.statusCode).toBe(403)
  })

  it('does not create a second owner when the platform owner creates a workspace', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await seedOwnerLogin()
    const createdWorkspace = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: owner.cookie },
      payload: { name: 'Owner Created Member Workspace' },
    })

    expect(createdWorkspace.statusCode).toBe(201)
    expect(createdWorkspace.json()).toMatchObject({
      account: {
        id: 'user-owner',
        roles: ['member'],
      },
      workspace: {
        name: 'Owner Created Member Workspace',
        status: 'active',
      },
    })
    expect(createdWorkspace.json().account.roles).not.toContain('owner')
  })

  it('protects the internal system organization from business users and lifecycle changes', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await seedOwnerLogin()
    const consoleSnapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/console?limit=100',
      headers: { cookie: owner.cookie },
    })
    expect(consoleSnapshot.statusCode).toBe(200)
    expect(consoleSnapshot.json().tenants.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tenant-seqora-demo',
          isSystem: true,
          status: 'active',
        }),
      ]),
    )

    const memberInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/invitations',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'system-member@example.com',
        roles: ['member'],
      },
    })
    expect(memberInvitation.statusCode).toBe(409)
    expect(memberInvitation.json()).toMatchObject({
      error: { code: 'SYSTEM_ORGANIZATION_PROTECTED' },
    })

    for (const role of ['member', 'organization_admin', 'organization_member'] as const) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations/tenant-seqora-demo/users',
        headers: { cookie: owner.cookie },
        payload: {
          email: `system-${role}@example.com`,
          name: `System ${role}`,
          password: 'SystemProtected123!',
          role,
        },
      })
      expect(created.statusCode).toBe(409)
      expect(created.json()).toMatchObject({
        error: { code: 'SYSTEM_ORGANIZATION_PROTECTED' },
      })
    }

    const internalAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations/tenant-seqora-demo/users',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'system-internal-admin@example.com',
        name: 'System Internal Admin',
        password: 'SystemInternalAdmin123!',
        role: 'admin',
      },
    })
    expect(internalAdmin.statusCode).toBe(201)
    expect(internalAdmin.json()).toMatchObject({
      email: 'system-internal-admin@example.com',
      roles: ['admin'],
      tenantId: 'tenant-seqora-demo',
    })

    const disabled = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/organizations/tenant-seqora-demo',
      headers: { cookie: owner.cookie },
    })
    expect(disabled.statusCode).toBe(409)
    expect(disabled.json()).toMatchObject({
      error: { code: 'SYSTEM_ORGANIZATION_PROTECTED' },
    })

    const transferred = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations/tenant-seqora-demo/admin-transfer',
      headers: { cookie: owner.cookie },
      payload: {
        currentOrganizationAdminUserId: 'user-missing-current-organization-admin',
        targetUserId: 'user-missing-target-organization-admin',
      },
    })
    expect(transferred.statusCode).toBe(409)
    expect(transferred.json()).toMatchObject({
      error: { code: 'SYSTEM_ORGANIZATION_PROTECTED' },
    })
  })

  it('enforces global owner and super admin role limits', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await seedOwnerLogin()
    const secondOwnerInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/invitations',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'second-owner@example.com',
        roles: ['owner'],
      },
    })
    expect(secondOwnerInvitation.statusCode).toBe(409)
    expect(secondOwnerInvitation.json()).toMatchObject({
      error: { code: 'OWNER_LIMIT_REACHED' },
    })

    const member = await createMemberWithWorkspace(
      'owner-promotion-member@example.com',
      'OwnerPromotionMember123!',
      'Owner Promotion Workspace',
    )
    const promoteMemberToOwner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/memberships/${member.membershipId}/roles`,
      headers: { cookie: owner.cookie },
      payload: { roles: ['owner'] },
    })
    expect(promoteMemberToOwner.statusCode).toBe(409)
    expect(promoteMemberToOwner.json()).toMatchObject({
      error: { code: 'OWNER_LIMIT_REACHED' },
    })

    for (let index = 1; index <= 4; index += 1) {
      const createdSuperAdmin = await app.inject({
        method: 'POST',
        url: '/api/v1/organizations/tenant-seqora-demo/users',
        headers: { cookie: owner.cookie },
        payload: {
          email: `role-limit-super-admin-${index}@example.com`,
          name: `Role Limit Super Admin ${index}`,
          password: `RoleLimitSuperAdmin${index}123!`,
          role: 'super_admin',
        },
      })
      expect(createdSuperAdmin.statusCode).toBe(201)
      expect(createdSuperAdmin.json()).toMatchObject({ roles: ['super_admin'] })
    }

    const sixthSuperAdmin = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
      headers: { cookie: owner.cookie },
      payload: {
        email: 'role-limit-super-admin-6@example.com',
        name: 'Role Limit Super Admin 6',
        password: 'RoleLimitSuperAdmin6123!',
        role: 'super_admin',
      },
    })
    expect(sixthSuperAdmin.statusCode).toBe(409)
    expect(sixthSuperAdmin.json()).toMatchObject({
      error: { code: 'SUPER_ADMIN_LIMIT_REACHED' },
    })
  })

  it('lists and switches workspaces for active memberships', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'workspace-admin@example.com',
      'OrgAdminPassword123!',
      'Organization Workspace',
    )
    const member = await createMemberWithWorkspace(
      'workspace-member@example.com',
      'MemberPassword123!',
      'Member Workspace',
    )

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'workspace-member@example.com',
        roles: ['organization_member', 'organization_member'],
      },
    })
    expect(added.statusCode).toBe(201)
    expect(added.json()).toMatchObject({
      roles: ['organization_member'],
      tenantId: organizationAdmin.tenantId,
      userId: member.userId,
    })

    const workspaces = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations',
      headers: { cookie: member.cookie },
    })
    expect(workspaces.statusCode).toBe(200)
    expect(workspaces.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspace: expect.objectContaining({ id: member.tenantId, name: 'Member Workspace' }),
          membership: expect.objectContaining({ roles: ['member'] }),
        }),
        expect.objectContaining({
          workspace: expect.objectContaining({
            id: organizationAdmin.tenantId,
            name: 'Organization Workspace',
          }),
          membership: expect.objectContaining({ roles: ['organization_member'] }),
        }),
      ]),
    )

    const switched = await switchWorkspace(member.cookie, organizationAdmin.tenantId)
    expect(switched.statusCode).toBe(200)
    expect(switched.json()).toMatchObject({
      account: {
        id: member.userId,
        tenantId: organizationAdmin.tenantId,
        roles: ['organization_member'],
      },
      workspace: {
        id: organizationAdmin.tenantId,
        name: 'Organization Workspace',
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
        tenantId: organizationAdmin.tenantId,
        roles: ['organization_member'],
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
          tenantId: organizationAdmin.tenantId,
          current: true,
        }),
      ]),
    )
  })

  it('renames organization workspaces and transfers organization administration', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'tenant-org-admin@example.com',
      'OrgAdminPassword123!',
      'Original Workspace',
    )
    const target = await createMemberWithWorkspace(
      'tenant-target@example.com',
      'TargetPassword123!',
      'Target Workspace',
    )

    const addTarget = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { email: 'tenant-target@example.com', roles: ['organization_member'] },
    })
    expect(addTarget.statusCode).toBe(201)

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { name: 'Renamed Workspace' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({
      id: organizationAdmin.tenantId,
      name: 'Renamed Workspace',
      status: 'active',
    })

    const organizationAdminTransfer = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/admin-transfer`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { targetUserId: target.userId },
    })
    expect(organizationAdminTransfer.statusCode).toBe(200)
    expect(organizationAdminTransfer.json()).toMatchObject({
      previousOrganizationAdmin: {
        userId: organizationAdmin.userId,
        roles: ['organization_member'],
      },
      newOrganizationAdmin: {
        userId: target.userId,
        roles: ['organization_admin'],
      },
    })
    expect(organizationAdminTransfer.json()).not.toHaveProperty('owner')
    expect(organizationAdminTransfer.headers).not.toHaveProperty('deprecation')

    const targetSwitch = await switchWorkspace(target.cookie, organizationAdmin.tenantId)
    expect(targetSwitch.statusCode).toBe(200)
    expect(targetSwitch.json()).toMatchObject({
      account: {
        id: target.userId,
        tenantId: organizationAdmin.tenantId,
        roles: ['organization_admin'],
      },
      workspace: { id: organizationAdmin.tenantId, name: 'Renamed Workspace' },
    })
  })

  it('keeps the legacy organization admin transfer route deprecated but functional', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'legacy-route-org-admin@example.com',
      'LegacyRouteOrgAdmin123!',
      'Legacy Route Workspace',
    )
    const target = await createMemberWithWorkspace(
      'legacy-route-target@example.com',
      'LegacyRouteTarget123!',
      'Legacy Route Target Workspace',
    )
    const addTarget = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { email: 'legacy-route-target@example.com', roles: ['organization_member'] },
    })
    expect(addTarget.statusCode).toBe(201)

    const legacyTransfer = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/organization-admin-transfer`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { targetUserId: target.userId },
    })
    expect(legacyTransfer.statusCode).toBe(200)
    expect(legacyTransfer.headers.deprecation).toBe('true')
    expect(legacyTransfer.headers.link).toContain(
      `/api/v1/organizations/${organizationAdmin.tenantId}/admin-transfer`,
    )
  })

  it('keeps workspace disable as an owner-only action', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'disable-org-admin@example.com',
      'OrgAdminPassword123!',
      'Disable Workspace',
    )

    const organizationAdminDisablesWorkspace = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(organizationAdminDisablesWorkspace.statusCode).toBe(403)
    expect(organizationAdminDisablesWorkspace.json()).toMatchObject({ error: { code: 'OWNER_REQUIRED' } })
  })

  it('enforces organization admin boundaries for memberships and tenant sessions', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'boundary-org-admin@example.com',
      'OrgAdminPassword123!',
      'Boundary Workspace',
    )
    const organizationMember = await createMemberWithWorkspace(
      'boundary-member@example.com',
      'MemberPassword123!',
      'Member Workspace',
    )
    const platformMember = await createMemberWithWorkspace(
      'boundary-platform-member@example.com',
      'MemberPassword123!',
      'Platform Member Workspace',
    )

    const addMember = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'boundary-member@example.com',
        roles: ['organization_member'],
      },
    })
    expect(addMember.statusCode).toBe(201)
    const organizationMemberSwitch = await switchWorkspace(
      organizationMember.cookie,
      organizationAdmin.tenantId,
    )
    expect(organizationMemberSwitch.statusCode).toBe(200)

    const selfRoleChange = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${organizationAdmin.userId}/roles`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { roles: ['organization_member'] },
    })
    expect(selfRoleChange.statusCode).toBe(400)
    expect(selfRoleChange.json()).toMatchObject({ error: { code: 'CANNOT_CHANGE_SELF_ROLES' } })

    const managePlatformMember = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${platformMember.userId}/roles`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { roles: ['member'] },
    })
    expect(managePlatformMember.statusCode).toBe(403)

    const promoteMember = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${organizationMember.userId}/roles`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { roles: ['organization_admin'] },
    })
    expect(promoteMember.statusCode).toBe(403)
    expect(promoteMember.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })

    const tenantSessions = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/sessions`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(tenantSessions.statusCode).toBe(200)
    const sessionList = tenantSessions.json() as Array<{
      sessionId: string
      userId: string
      current: boolean
    }>
    const organizationAdminSession = sessionList.find(
      (session) => session.userId === organizationAdmin.userId && session.current,
    )
    const organizationMemberSession = sessionList.find(
      (session) => session.userId === organizationMember.userId,
    )
    expect(organizationAdminSession?.sessionId).toEqual(expect.any(String))
    expect(organizationMemberSession?.sessionId).toEqual(expect.any(String))

    const revokeOwnAdminSession = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/sessions/${organizationAdminSession?.sessionId}`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(revokeOwnAdminSession.statusCode).toBe(400)
    expect(revokeOwnAdminSession.json()).toMatchObject({
      error: { code: 'CANNOT_REVOKE_SELF_SESSION' },
    })

    const disableMember = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${organizationMember.userId}`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(disableMember.statusCode).toBe(204)

    const disabledSwitch = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/switch`,
      headers: { cookie: organizationMember.cookie },
    })
    expect(disabledSwitch.statusCode).toBe(404)
    expect(disabledSwitch.json()).toMatchObject({ error: { code: 'WORKSPACE_NOT_FOUND' } })
  })

  it('creates, lists and revokes tenant invitations', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'invites-org-admin@example.com',
      'OrgAdminPassword123!',
      'Owner Workspace',
    )

    const createInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/invitations`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['organization_member'],
      },
    })
    expect(createInvitation.statusCode).toBe(201)
    expect(createInvitation.json()).toMatchObject({
      email: 'member@example.com',
      tenantId: organizationAdmin.tenantId,
      roles: ['organization_member'],
      status: 'pending',
      token: expect.stringMatching(/^\d{8}$/),
    })
    const firstInvitation = createInvitation.json() as { id: string; token: string }

    const invalidOrganizationMemberInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/invitations`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'illegal-member@example.com',
        roles: ['member'],
      },
    })
    expect(invalidOrganizationMemberInvitation.statusCode).toBe(400)
    expect(invalidOrganizationMemberInvitation.json()).toMatchObject({
      error: { code: 'ORGANIZATION_INVITATION_ROLE_REQUIRED' },
    })

    const reissuedInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/invitations`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['organization_member'],
      },
    })
    expect(reissuedInvitation.statusCode).toBe(201)
    expect(reissuedInvitation.json()).toMatchObject({
      id: firstInvitation.id,
      email: 'member@example.com',
      status: 'pending',
      token: expect.stringMatching(/^\d{8}$/),
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
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/invitations`,
      headers: { cookie: organizationAdmin.cookie },
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
        tenantId: organizationAdmin.tenantId,
        roles: ['organization_member'],
      },
    })

    const revokedAccepted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/invitations/${firstInvitation.id}`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(revokedAccepted.statusCode).toBe(404)

    const secondInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/invitations`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'revoked@example.com',
        roles: ['organization_member'],
      },
    })
    expect(secondInvitation.statusCode).toBe(201)

    const revokedPending = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/invitations/${secondInvitation.json().id}`,
      headers: { cookie: organizationAdmin.cookie },
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

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'members-org-admin@example.com',
      'OrgAdminPassword123!',
      'Organization Workspace',
    )
    const member = await createMemberWithWorkspace(
      'member@example.com',
      'MemberPassword123!',
      'Member Workspace',
    )

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['organization_member'],
      },
    })

    expect(added.statusCode).toBe(201)
    expect(added.json()).toMatchObject({
      email: 'member@example.com',
      roles: ['organization_member'],
      tenantId: organizationAdmin.tenantId,
      userId: member.userId,
    })

    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(members.statusCode).toBe(200)
    expect(members.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: 'members-org-admin@example.com',
          roles: expect.arrayContaining(['organization_admin']),
        }),
        expect.objectContaining({
          email: 'member@example.com',
          roles: expect.arrayContaining(['organization_member']),
        }),
      ]),
    )

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${member.userId}/roles`,
      headers: { cookie: organizationAdmin.cookie },
      payload: { roles: ['organization_member'] },
    })
    expect(promoted.statusCode).toBe(200)
    expect(promoted.json()).toMatchObject({ roles: ['organization_member'] })

    const disabled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members/${member.userId}`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(disabled.statusCode).toBe(204)

    const disabledMembers = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
    })
    expect(disabledMembers.statusCode).toBe(200)
    expect(disabledMembers.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'member@example.com', status: 'disabled' })]),
    )
  })

  it('disables accounts for the whole tenant and blocks future logins', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const organizationAdmin = await createOrganizationAdminWorkspace(
      'account-org-admin@example.com',
      'OrgAdminPassword123!',
      'Organization Workspace 2',
    )
    const member = await createMemberWithWorkspace(
      'member2@example.com',
      'MemberPassword123!',
      'Member Workspace 2',
    )
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationAdmin.tenantId}/members`,
      headers: { cookie: organizationAdmin.cookie },
      payload: {
        email: 'member2@example.com',
        roles: ['organization_member'],
      },
    })
    expect(added.statusCode).toBe(201)

    const owner = await seedOwnerLogin()
    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${member.userId}/status`,
      headers: { cookie: owner.cookie },
      payload: { status: 'disabled' },
    })
    expect(disabled.statusCode).toBe(200)

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member2@example.com', password: 'Ready-MemberPassword123!' },
    })
    expect(relogin.statusCode).toBe(401)
  })
})

function localAuthConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    EMAIL_PROVIDER: 'none',
    DATABASE_URL: authDatabase.connectionString,
    DATA_FILE: ':memory:',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: resolve('./data/test-uploads'),
    ...overrides,
  })
}

async function createMemberWithWorkspace(email: string, password: string, workspaceName: string) {
  return await createTenantUserInFreshWorkspace(email, password, workspaceName, 'member')
}

async function createOrganizationAdminWorkspace(email: string, password: string, workspaceName: string) {
  return await createTenantUserInFreshWorkspace(email, password, workspaceName, 'organization_admin')
}

async function createTenantUserInFreshWorkspace(
  email: string,
  password: string,
  workspaceName: string,
  role: 'member' | 'admin' | 'organization_admin',
) {
  if (!app) throw new Error('App is not ready')
  const owner = await seedOwnerLogin()
  const workspace = await app.inject({
    method: 'POST',
    url: '/api/v1/organizations',
    headers: { cookie: owner.cookie },
    payload: { name: workspaceName },
  })
  expect(workspace.statusCode).toBe(201)
  const tenantId = workspace.json().workspace.id as string
  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/organizations/${tenantId}/users`,
    headers: { cookie: owner.cookie },
    payload: {
      email,
      name: email.split('@')[0],
      password,
      role,
    },
  })
  expect(created.statusCode).toBe(201)
  const login = await activateProvisionedAccount(email, password)
  expect(login.statusCode).toBe(200)
  expect(login.json().account.roles).toEqual([role])
  return {
    userId: created.json().userId as string,
    membershipId: created.json().id as string,
    tenantId,
    cookie: cookieValue(login),
  }
}

async function activateProvisionedAccount(email: string, temporaryPassword: string) {
  if (!app) throw new Error('App is not ready')
  const initialLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '10.0.0.2',
    payload: { email, password: temporaryPassword },
  })
  expect(initialLogin.statusCode).toBe(200)
  expect(initialLogin.json()).toMatchObject({ account: { passwordResetRequired: true } })

  const newPassword = `Ready-${temporaryPassword}`
  const changed = await app.inject({
    method: 'PUT',
    url: '/api/v1/auth/password',
    remoteAddress: '10.0.0.2',
    headers: { cookie: cookieValue(initialLogin) },
    payload: { currentPassword: temporaryPassword, newPassword },
  })
  expect(changed.statusCode).toBe(204)

  const readyLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '10.0.0.2',
    payload: { email, password: newPassword },
  })
  expect(readyLogin.statusCode).toBe(200)
  expect(readyLogin.json()).toMatchObject({ account: { passwordResetRequired: false } })
  return readyLogin
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
    url: `/api/v1/organizations/${tenantId}/switch`,
    headers: { cookie },
  })
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
