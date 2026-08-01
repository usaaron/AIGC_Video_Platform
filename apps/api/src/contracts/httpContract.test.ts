import type { AppConfig } from '../../config.js'
import {
  adminUserListSchema,
  billingSummarySchema,
  generationTaskSchema,
  projectWorkspaceSchema,
  sessionSchema,
} from '@seqora/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { AccountDatabase } from '../infra/postgres.js'
import { AppStore } from '../infra/store.js'
import { ProjectRepository } from '../modules/projects/repository.js'
import { UserRepository } from '../modules/users/repository.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../testing/postgresAuth.js'
import { createJsonSchemaValidator } from '../testing/jsonSchema.js'

let app: Awaited<ReturnType<typeof buildApp>> | undefined
let authDatabase: PostgresAuthFixture | undefined

const assertSession = createJsonSchemaValidator(sessionSchema, 'auth.session')
const assertBillingSummary = createJsonSchemaValidator(billingSummarySchema, 'billing.summary')
const assertProjectWorkspace = createJsonSchemaValidator(projectWorkspaceSchema, 'projects.workspace')
const assertAdminUserList = createJsonSchemaValidator(adminUserListSchema, 'admin.users')
const assertGenerationTask = createJsonSchemaValidator(generationTaskSchema, 'generation.task')

beforeAll(async () => {
  authDatabase = await startPostgresAuthFixture()
}, 120_000)

beforeEach(async () => {
  await authDatabase?.reset()
  await seedProjectWorkspace()
  app = await buildContractApp()
})

afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(resolve('./data/test-uploads'), { recursive: true, force: true })
})

afterAll(async () => {
  await authDatabase?.close()
})

describe('api contract layer', { timeout: 30_000 }, () => {
  it('validates successful HTTP payloads against strict JSON Schema', async () => {
    const member = await login('member@seqora.local', 'MemberPassword123!')
    assertSession(member.json())

    const me = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieValue(member) },
    })
    expect(me.statusCode).toBe(200)
    assertSession(me.json())

    const project = await app!.inject({
      method: 'GET',
      url: '/api/v1/projects/project-midnight-film',
      headers: { cookie: cookieValue(member) },
    })
    expect(project.statusCode).toBe(200)
    assertProjectWorkspace(project.json())

    const summary = await app!.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: cookieValue(member) },
    })
    expect(summary.statusCode).toBe(200)
    assertBillingSummary(summary.json())
  })

  it('rejects missing fields, boundary values and SQL-injection style inputs', async () => {
    const missingPassword = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'member@seqora.local' },
    })
    expect(missingPassword.statusCode).toBe(400)
    expect(missingPassword.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })

    const member = await login('member@seqora.local', 'MemberPassword123!')
    const tooLongName = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: cookieValue(member) },
      payload: {
        name: 'A'.repeat(121),
        contentType: 'short-drama',
        aspectRatio: '9:16',
      },
    })
    expect(tooLongName.statusCode).toBe(400)
    expect(tooLongName.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })

    const admin = await login('admin@seqora.local', 'Admin123!')
    const injection = await app!.inject({
      method: 'GET',
      url: `/api/v1/admin/users?q=${encodeURIComponent("' OR 1=1 --")}&limit=10`,
      headers: { cookie: cookieValue(admin) },
    })
    expect(injection.statusCode).toBe(200)
    assertAdminUserList(injection.json())
    expect(injection.json().meta.total).toBeLessThanOrEqual(4)
  })

  it('keeps generation task submission idempotent by clientRequestId', async () => {
    const member = await login('member@seqora.local', 'MemberPassword123!')
    const beforeSummary = await app!.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: cookieValue(member) },
    })
    expect(beforeSummary.statusCode).toBe(200)
    assertBillingSummary(beforeSummary.json())

    const payload = {
      clientRequestId: 'api-contract-idempotent-task',
      projectId: 'project-midnight-film',
      kind: 'image' as const,
      label: 'API contract idempotency task',
      provider: 'img2',
      estimatedCredits: 4,
    }

    const first = await app!.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { cookie: cookieValue(member) },
      payload,
    })
    expect(first.statusCode).toBe(202)
    assertGenerationTask(first.json())

    const second = await app!.inject({
      method: 'POST',
      url: '/api/v1/generation/tasks',
      headers: { cookie: cookieValue(member) },
      payload,
    })
    expect(second.statusCode).toBe(202)
    assertGenerationTask(second.json())
    expect(second.json()).toMatchObject({
      id: first.json().id,
      clientRequestId: payload.clientRequestId,
      estimatedCredits: 4,
    })

    const afterSummary = await app!.inject({
      method: 'GET',
      url: '/api/v1/billing/summary',
      headers: { cookie: cookieValue(member) },
    })
    expect(afterSummary.statusCode).toBe(200)
    assertBillingSummary(afterSummary.json())
    expect(afterSummary.json().credits).toBe(beforeSummary.json().credits - 4)
  })
})

async function buildContractApp() {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  return await buildApp({
    config: localContractConfig(),
    store: new AppStore(null),
    startWorker: false,
  })
}

function localContractConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    DATABASE_URL: authDatabase.connectionString,
    DATA_FILE: ':memory:',
    STORAGE_DRIVER: 'local',
    EMAIL_PROVIDER: 'none',
    PAYMENT_PROVIDER: 'none',
    UPLOAD_DIR: resolve('./data/test-uploads'),
    ...overrides,
  })
}

async function seedProjectWorkspace(): Promise<void> {
  if (!authDatabase) throw new Error('Postgres auth fixture is not ready')
  const store = new AppStore(null)
  await store.initialize()
  await withDatabase(async (database) => {
    const users = new UserRepository(store, database)
    await users.bootstrapFromStore()
    const projects = new ProjectRepository(store, database)
    await projects.importFromStore()
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
  assertSession(response.json())
  return response
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
