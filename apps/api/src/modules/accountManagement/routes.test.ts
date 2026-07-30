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

  it('invites members, updates roles and disables memberships', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await registerUser('owner@example.com', 'OwnerPassword123!', 'Owner Workspace')
    const member = await registerUser('member@example.com', 'MemberPassword123!', 'Member Workspace')

    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/invitations`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'member@example.com',
        roles: ['member'],
        expiresInDays: 7,
      },
    })

    expect(invite.statusCode).toBe(201)
    const inviteToken = invite.json().token as string

    const accept = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      headers: { cookie: member.cookie },
      payload: { token: inviteToken },
    })
    expect(accept.statusCode).toBe(200)
    const memberAcceptedCookie = cookieValue(accept)
    expect(accept.json()).toMatchObject({
      workspace: { id: owner.tenantId, name: 'Owner Workspace' },
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

    const revokedMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: memberAcceptedCookie },
    })
    expect(revokedMe.statusCode).toBe(401)
  })

  it('disables accounts for the whole tenant and blocks future logins', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })

    const owner = await registerUser('owner2@example.com', 'OwnerPassword123!', 'Owner Workspace 2')
    const member = await registerUser('member2@example.com', 'MemberPassword123!', 'Member Workspace 2')
    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${owner.tenantId}/invitations`,
      headers: { cookie: owner.cookie },
      payload: {
        email: 'member2@example.com',
        roles: ['member'],
        expiresInDays: 7,
      },
    })
    const inviteToken = invite.json().token as string

    const accept = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      headers: { cookie: member.cookie },
      payload: { token: inviteToken },
    })
    expect(accept.statusCode).toBe(200)

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
