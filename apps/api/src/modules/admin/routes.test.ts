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
      meta: { total: 3, limit: 50, offset: 0 },
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
      url: '/api/v1/admin/tenants?q=seqora',
      headers: { cookie: adminCookie },
    })
    expect(tenants.statusCode).toBe(200)
    expect(tenants.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'tenant-seqora-demo',
          status: 'active',
          activeMembershipCount: 3,
          activeOwnerCount: 1,
        }),
      ],
    })

    const memberships = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/memberships?tenantId=tenant-seqora-demo&role=creator',
      headers: { cookie: adminCookie },
    })
    expect(memberships.statusCode).toBe(200)
    expect(memberships.json()).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'membership-tenant-seqora-demo-user-creator',
          userId: 'user-creator',
          email: 'creator@seqora.local',
          plan: 'free',
          credits: 286,
        }),
      ],
    })

    const adjusted = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-creator/adjustments',
      headers: { cookie: adminCookie },
      payload: {
        amount: 15,
        reason: 'Admin console audit top-up',
      },
    })
    expect(adjusted.statusCode).toBe(200)

    const billingAccounts = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/accounts?membershipId=membership-tenant-seqora-demo-user-creator',
      headers: { cookie: adminCookie },
    })
    expect(billingAccounts.statusCode).toBe(200)
    expect(billingAccounts.json()).toMatchObject({
      items: [
        expect.objectContaining({
          membershipId: 'membership-tenant-seqora-demo-user-creator',
          credits: 301,
          plan: 'free',
        }),
      ],
    })

    const ledger = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/ledger?membershipId=membership-tenant-seqora-demo-user-creator&type=adjustment',
      headers: { cookie: adminCookie },
    })
    expect(ledger.statusCode).toBe(200)
    expect(ledger.json()).toMatchObject({
      items: [
        expect.objectContaining({
          membershipId: 'membership-tenant-seqora-demo-user-creator',
          userId: 'user-creator',
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
      url: '/api/v1/admin/billing/memberships/membership-tenant-seqora-demo-user-creator',
      headers: { cookie: adminCookie },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      membership: expect.objectContaining({ userId: 'user-creator', roles: ['creator'] }),
      billing: expect.objectContaining({ credits: 301 }),
      entries: expect.arrayContaining([
        expect.objectContaining({ amount: 15, description: 'Admin console audit top-up' }),
      ]),
    })
  })

  it('enables and disables ordinary accounts without touching membership status', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const creator = await login('creator@seqora.local', 'Creator123!')

    const disabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-creator/status',
      headers: { cookie: cookieValue(admin) },
      payload: { status: 'disabled' },
    })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({
      id: 'user-creator',
      status: 'disabled',
      activeMembershipCount: 1,
    })

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(creator) },
    })
    expect(oldSession.statusCode).toBe(401)

    const blockedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'creator@seqora.local',
        password: 'Creator123!',
      },
    })
    expect(blockedLogin.statusCode).toBe(401)

    const enabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-creator/status',
      headers: { cookie: cookieValue(admin) },
      payload: { status: 'active' },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({
      id: 'user-creator',
      status: 'active',
      activeMembershipCount: 1,
    })

    const loginAfterEnable = await login('creator@seqora.local', 'Creator123!')
    expect(loginAfterEnable.statusCode).toBe(200)
  })

  it('enforces elevated account and self-disable boundaries', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const admin = await login('admin@seqora.local', 'Admin123!')
    const owner = await login('owner@seqora.local', 'OwnerPassword123!')

    const adminDisablesOwner = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/user-owner/status',
      headers: { cookie: cookieValue(admin) },
      payload: { status: 'disabled' },
    })
    expect(adminDisablesOwner.statusCode).toBe(403)
    expect(adminDisablesOwner.json()).toMatchObject({
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

  it('denies non-admin accounts from admin console APIs', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const creator = await login('creator@seqora.local', 'Creator123!')

    const users = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: cookieValue(creator) },
    })
    expect(users.statusCode).toBe(403)

    const billing = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/accounts',
      headers: { cookie: cookieValue(creator) },
    })
    expect(billing.statusCode).toBe(403)
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
  return await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  })
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
