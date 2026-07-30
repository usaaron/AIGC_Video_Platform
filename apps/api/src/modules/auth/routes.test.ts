import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../../app.js'
import { loadConfig, type AppConfig } from '../../config.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let authDatabase: PostgresAuthFixture | undefined

const chromeWindowsUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
const firefoxMacUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:143.0) Gecko/20100101 Firefox/143.0'

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

describe('auth security api', { timeout: 30_000 }, () => {
  it('records session device info and supports password reset with session revocation', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const creator = await login('creator@seqora.local', 'Creator123!', chromeWindowsUserAgent)
    expect(creator.statusCode).toBe(200)
    const creatorCookie = cookieValue(creator)

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: creatorCookie },
    })
    expect(sessions.statusCode).toBe(200)
    expect(sessions.json()).toEqual([
      expect.objectContaining({
        userId: 'user-creator',
        current: true,
        userAgent: chromeWindowsUserAgent,
        deviceLabel: 'Chrome on Windows',
        ipAddress: expect.any(String),
      }),
    ])

    const unknownReset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset-request',
      headers: { 'user-agent': firefoxMacUserAgent },
      payload: { email: 'missing@example.com' },
    })
    expect(unknownReset.statusCode).toBe(202)
    expect(unknownReset.json()).toEqual({ ok: true })

    const resetRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset-request',
      headers: { 'user-agent': firefoxMacUserAgent },
      payload: { email: 'creator@seqora.local' },
    })
    expect(resetRequest.statusCode).toBe(202)
    const resetBody = resetRequest.json() as { resetToken?: string; expiresAt?: string; ok: true }
    expect(resetBody).toMatchObject({
      ok: true,
      resetToken: expect.any(String),
      expiresAt: expect.any(String),
    })
    const resetToken = resetBody.resetToken
    if (!resetToken) throw new Error('Expected test reset token')

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      headers: { 'user-agent': firefoxMacUserAgent },
      payload: { token: resetToken, newPassword: 'CreatorNewPassword123!' },
    })
    expect(reset.statusCode).toBe(204)

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: creatorCookie },
    })
    expect(oldSession.statusCode).toBe(401)

    const oldPassword = await login('creator@seqora.local', 'Creator123!', chromeWindowsUserAgent)
    expect(oldPassword.statusCode).toBe(401)

    const newPassword = await login(
      'creator@seqora.local',
      'CreatorNewPassword123!',
      chromeWindowsUserAgent,
    )
    expect(newPassword.statusCode).toBe(200)

    const reusedToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token: resetToken, newPassword: 'AnotherCreatorPassword123!' },
    })
    expect(reusedToken.statusCode).toBe(400)
    expect(reusedToken.json()).toMatchObject({
      error: { code: 'PASSWORD_RESET_TOKEN_INVALID' },
    })

    const admin = await login('admin@seqora.local', 'Admin123!', chromeWindowsUserAgent)
    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs?action=auth.password_reset.completed&userId=user-creator',
      headers: { cookie: cookieValue(admin) },
    })
    expect(audit.statusCode).toBe(200)
    expect(audit.json()).toMatchObject({
      meta: { total: 1 },
      items: [
        expect.objectContaining({
          action: 'auth.password_reset.completed',
          userId: 'user-creator',
          actorUserId: 'user-creator',
          resourceType: 'auth_identity',
          userAgent: firefoxMacUserAgent,
        }),
      ],
    })
  })

  it('denies audit log access to ordinary members', async () => {
    app = await buildApp({ config: localAuthConfig(), startWorker: false })
    const creator = await login('creator@seqora.local', 'Creator123!', chromeWindowsUserAgent)

    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs',
      headers: { cookie: cookieValue(creator) },
    })
    expect(audit.statusCode).toBe(403)
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

async function login(email: string, password: string, userAgent: string) {
  if (!app) throw new Error('App is not ready')
  return await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'user-agent': userAgent },
    payload: { email, password },
  })
}

function cookieValue(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((item) => item.name === 'seqora_session')
  if (!cookie) throw new Error('Missing seqora_session cookie')
  return `seqora_session=${cookie.value}`
}
