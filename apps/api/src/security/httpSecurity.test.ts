import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../app.js'
import { loadConfig, type AppConfig } from '../config.js'
import { parseIssuedSessionToken } from '../core/auth/sessionToken.js'
import { AccountDatabase } from '../infra/postgres.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../testing/postgresAuth.js'
import { createTestDataFactory } from '../testing/testDataFactory.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let authDatabase: PostgresAuthFixture | undefined
const dataFactory = createTestDataFactory('security')

beforeAll(async () => {
  authDatabase = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await authDatabase?.reset()
  app = await buildApp({ config: localAuthConfig(), startWorker: false })
})

afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(resolve('./data/test-uploads'), { recursive: true, force: true })
})

afterAll(async () => {
  await authDatabase?.close()
})

describe('HTTP security controls', { timeout: 45_000 }, () => {
  it('rejects expired and tampered session cookies', async () => {
    const member = await login('member@seqora.local', 'MemberPassword123!')
    const memberCookie = cookieValue(member)
    const memberSessionId = sessionIdFromCookie(memberCookie)

    await withDatabase(async (database) => {
      await database.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [
        memberSessionId,
      ])
    })

    const expired = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: memberCookie },
    })
    expect(expired.statusCode).toBe(401)
    expect(expired.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } })

    const fresh = await login('member@seqora.local', 'MemberPassword123!')
    const freshCookie = cookieValue(fresh)
    const tamperedCookie = `${freshCookie.slice(0, -1)}x`
    const tampered = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: tamperedCookie },
    })
    expect(tampered.statusCode).toBe(401)
    expect(tampered.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } })
  })

  it('blocks vertical privilege escalation from members and platform admins', async () => {
    const member = await login('member@seqora.local', 'MemberPassword123!')
    const memberReadsAdminUsers = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: cookieValue(member) },
    })
    expect(memberReadsAdminUsers.statusCode).toBe(403)
    expect(memberReadsAdminUsers.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })

    const admin = await login('admin@seqora.local', 'Admin123!')
    const adminCreatesSuperAdmin = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/tenant-seqora-demo/users',
      headers: { cookie: cookieValue(admin) },
      payload: {
        email: 'admin-escalation@example.com',
        name: 'Admin Escalation',
        password: 'AdminEscalation123!',
        role: 'super_admin',
      },
    })
    expect(adminCreatesSuperAdmin.statusCode).toBe(403)
    expect(adminCreatesSuperAdmin.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
  })

  it('blocks horizontal cross-organization access for organization admins', async () => {
    const alpha = await createOrganizationAdminWorkspace(
      dataFactory.email('security-alpha-admin'),
      'SecurityAlphaAdmin123!',
      dataFactory.tenantName('Alpha Organization'),
    )
    const beta = await createOrganizationAdminWorkspace(
      dataFactory.email('security-beta-admin'),
      'SecurityBetaAdmin123!',
      dataFactory.tenantName('Beta Organization'),
    )
    const betaMember = await createTenantUser(
      beta.tenantId,
      dataFactory.email('security-beta-member'),
      'SecurityBetaMember123!',
      'organization_member',
    )

    const alphaListsBetaMembers = await app!.inject({
      method: 'GET',
      url: `/api/v1/organizations/${beta.tenantId}/members`,
      headers: { cookie: alpha.cookie },
    })
    expect(alphaListsBetaMembers.statusCode).toBe(403)
    expect(alphaListsBetaMembers.json()).toMatchObject({ error: { code: 'TENANT_SCOPE_MISMATCH' } })

    const alphaDisablesBetaMember = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${beta.tenantId}/members/${betaMember.userId}`,
      headers: { cookie: alpha.cookie },
    })
    expect(alphaDisablesBetaMember.statusCode).toBe(403)
    expect(alphaDisablesBetaMember.json()).toMatchObject({ error: { code: 'TENANT_SCOPE_MISMATCH' } })

    const alphaReadsBetaSessions = await app!.inject({
      method: 'GET',
      url: `/api/v1/organizations/${beta.tenantId}/sessions`,
      headers: { cookie: alpha.cookie },
    })
    expect(alphaReadsBetaSessions.statusCode).toBe(403)
    expect(alphaReadsBetaSessions.json()).toMatchObject({ error: { code: 'TENANT_SCOPE_MISMATCH' } })
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

async function login(email: string, password: string) {
  if (!app) throw new Error('App is not ready')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  })
  expect(response.statusCode).toBe(200)
  return response
}

async function createOrganizationAdminWorkspace(email: string, password: string, name: string) {
  const tenant = await createOrganization(name)
  const user = await createTenantUser(tenant.id, email, password, 'organization_admin')
  const loginResponse = await activateProvisionedAccount(email, password)
  return {
    tenantId: tenant.id,
    userId: user.userId,
    cookie: cookieValue(loginResponse),
  }
}

async function createOrganization(name: string): Promise<{ id: string }> {
  if (!app) throw new Error('App is not ready')
  const owner = await login('owner@seqora.local', 'OwnerPassword123!')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/organizations',
    headers: { cookie: cookieValue(owner) },
    payload: { name },
  })
  expect(response.statusCode).toBe(201)
  return { id: response.json().organization.id as string }
}

async function createTenantUser(
  tenantId: string,
  email: string,
  password: string,
  role: 'organization_admin' | 'organization_member',
): Promise<{ userId: string }> {
  if (!app) throw new Error('App is not ready')
  const owner = await login('owner@seqora.local', 'OwnerPassword123!')
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/organizations/${tenantId}/users`,
    headers: { cookie: cookieValue(owner) },
    payload: {
      email,
      name: email.split('@')[0],
      password,
      role,
    },
  })
  expect(response.statusCode).toBe(201)
  return { userId: response.json().userId as string }
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

function sessionIdFromCookie(cookie: string): string {
  const token = cookie.replace(/^seqora_session=/, '')
  const payload = parseIssuedSessionToken(token, localAuthConfig().AUTH_SECRET)
  if (!payload) throw new Error('Could not parse session cookie payload')
  return payload.sessionId
}
