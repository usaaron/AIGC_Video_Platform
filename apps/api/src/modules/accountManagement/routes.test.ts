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

describe('account management api', () => {
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

  it('registers users, creates workspaces and revokes specific sessions', async () => {
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

    expect(register.statusCode).toBe(201)
    expect(register.json()).toMatchObject({
      account: { email: 'alice@example.com', name: 'Alice', tenantId: expect.any(String) },
      workspace: { name: 'Alice Studio', status: 'active' },
    })
    const registerCookie = cookieValue(register)

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

  it('does not expose invitation endpoints', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await registerUser('no-invites-owner@example.com', 'OwnerPassword123!', 'Owner Workspace')

    const createInvitation = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/invitations`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['member'],
      },
    })
    expect(createInvitation.statusCode).toBe(404)

    const acceptInvitation = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      headers: { cookie: owner.cookie },
      payload: { token: 'x'.repeat(64) },
    })
    expect(acceptInvitation.statusCode).toBe(404)
  })

  it('adds registered members, updates roles and disables memberships', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await registerUser('owner@example.com', 'OwnerPassword123!', 'Owner Workspace')
    const member = await registerUser('member@example.com', 'MemberPassword123!', 'Member Workspace')

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

    const owner = await registerUser('owner2@example.com', 'OwnerPassword123!', 'Owner Workspace 2')
    const member = await registerUser('member2@example.com', 'MemberPassword123!', 'Member Workspace 2')
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

async function registerUser(email: string, password: string, workspaceName: string) {
  if (!app) throw new Error('App is not ready')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      name: email.split('@')[0],
      email,
      password,
      workspaceName,
    },
  })
  expect(response.statusCode).toBe(201)
  return {
    userId: response.json().account.id as string,
    tenantId: response.json().account.tenantId as string,
    cookie: cookieValue(response),
  }
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
