import type { Principal } from '@seqora/contracts'
import { readFile } from 'node:fs/promises'
import type { PoolClient, QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'
import type { PostgresTransactionRunner } from './postgresStore.js'
import { PostgresAdminRepository } from '../modules/admin/repository.js'
import { PostgresCreditLedger } from '../modules/billing/postgresCreditLedger.js'
import { PostgresMediaRepository } from '../modules/media/postgresRepository.js'
import { PostgresProjectRepository } from '../modules/projects/postgresRepository.js'
import { PostgresUserRepository } from '../modules/users/postgresRepository.js'

describe('Postgres SQL repositories', () => {
  it('reads local users from the users table without loading application state', async () => {
    const { calls, runner } = createTransactionRunner([userRows()])
    const repository = new PostgresUserRepository(runner)

    const user = await repository.findByEmail('Creator@Example.com')

    expect(user).toMatchObject({ id: 'user-1', email: 'creator@example.com' })
    expect(calls[0]?.sql.toLowerCase()).toContain('from users')
    expect(calls[0]?.sql.toLowerCase()).toContain('lower(email)')
    expect(calls[0]?.params).toEqual(['Creator@Example.com'])
  })

  it('creates shots with a project row lock and per-table writes', async () => {
    const { calls, runner } = createTransactionRunner([
      projectRows(),
      [{ order: 2 }],
      shotRows({ order: 3, title: 'Shot 3' }),
      [],
    ])
    const repository = new PostgresProjectRepository(runner)

    const shot = await repository.createShot(
      'project-1',
      {
        title: 'Shot 3',
        framing: 'wide',
        duration: 4,
        prompt: 'Track the character into frame',
        assetIds: ['asset-1'],
        imageUrl: null,
      },
      principal,
    )

    expect(shot).toMatchObject({ order: 3, title: 'Shot 3' })
    const sql = joinedSql(calls)
    expect(sql).toContain('from projects')
    expect(sql).toContain('for update')
    expect(sql).toContain('select max(order_index)')
    expect(sql).toContain('insert into shots')
    expect(sql).not.toContain('truncate')
  })

  it('updates assets through locked project and asset rows', async () => {
    const { calls, runner } = createTransactionRunner([
      projectRows(),
      assetRows(),
      assetRows({ name: 'Updated Asset' }),
      [],
    ])
    const repository = new PostgresProjectRepository(runner)

    const asset = await repository.updateAsset(
      'project-1',
      'asset-1',
      { name: 'Updated Asset', customPrompt: 'Use stronger rim light' },
      principal,
    )

    expect(asset).toMatchObject({ id: 'asset-1', name: 'Updated Asset' })
    const sql = joinedSql(calls)
    expect(sql).toContain('from projects')
    expect(sql).toContain('from assets')
    expect(sql).toContain('for update')
    expect(sql).toContain('update assets')
    expect(sql).toContain('references = $13::jsonb')
    expect(sql).toContain('attributes = $14::jsonb')
  })

  it('updates plans with a locked user row and ledger entry', async () => {
    const { calls, runner } = createTransactionRunner([
      userRows({ plan: 'free', credits: 100 }),
      userRows({ plan: 'member', credits: 600 }),
      [],
      ledgerRows({ amount: 500, balance: 600 }),
    ])
    const ledger = new PostgresCreditLedger(runner)

    const summary = await ledger.updatePlan(principal, 'member')

    expect(summary).toMatchObject({ plan: 'member', credits: 600, concurrency: 3 })
    const sql = joinedSql(calls)
    expect(sql).toContain('from users')
    expect(sql).toContain('for update')
    expect(sql).toContain('update users')
    expect(sql).toContain('insert into ledger_entries')
  })

  it('creates media metadata with project ownership checked by SQL', async () => {
    const { calls, runner } = createTransactionRunner([[{ id: 'project-1' }], mediaRows()])
    const repository = new PostgresMediaRepository(runner)

    const media = await repository.create(
      'project-1',
      'image',
      'reference.png',
      'image/png',
      128,
      'tenant-1/project-1/reference.png',
      principal,
    )

    expect(media).toMatchObject({ kind: 'image', url: `/api/v1/media/${media.id}` })
    const sql = joinedSql(calls)
    expect(sql).toContain('from projects')
    expect(sql).toContain('for key share')
    expect(sql).toContain('insert into media')
  })

  it('returns admin overview from aggregate SQL', async () => {
    const { calls, runner } = createTransactionRunner([
      [{ count: '2' }],
      [{ count: '1' }],
      [{ total: '-18' }],
    ])
    const repository = new PostgresAdminRepository(runner)

    const overview = await repository.overview()

    expect(overview).toMatchObject({ users: 2, activeTasks: 1, creditsConsumedToday: 18 })
    const sql = joinedSql(calls)
    expect(sql).toContain('count(*)')
    expect(sql).toContain('from users')
    expect(sql).toContain('from generation_tasks')
    expect(sql).toContain('from ledger_entries')
  })
})

describe('Postgres repository migration constraints', () => {
  it('adds tenant-scoped unique constraints and foreign keys without truncation', async () => {
    const sql = await readFile(
      new URL('../../migrations/003_repository_constraints.sql', import.meta.url),
      'utf8',
    )
    const normalized = sql.toLowerCase()

    expect(normalized).toContain('users_id_tenant_unique_idx')
    expect(normalized).toContain('projects_id_tenant_unique_idx')
    expect(normalized).toContain('assets_project_tenant_fk')
    expect(normalized).toContain('generation_tasks_user_tenant_fk')
    expect(normalized).toContain('ledger_entries_user_tenant_fk')
    expect(normalized).toContain('media_storage_key_unique_idx')
    expect(normalized).not.toContain('truncate')
  })

  it('adds durable audit log storage for production security events', async () => {
    const sql = await readFile(new URL('../../migrations/004_audit_logs.sql', import.meta.url), 'utf8')
    const normalized = sql.toLowerCase()

    expect(normalized).toContain('create table if not exists audit_logs')
    expect(normalized).toContain('request_id text not null')
    expect(normalized).toContain('trace_id text not null')
    expect(normalized).toContain('audit_logs_tenant_created_idx')
    expect(normalized).toContain('audit_logs_request_idx')
    expect(normalized).not.toContain('truncate')
  })
})

const principal: Principal = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['creator'],
}

type QueryCall = {
  sql: string
  params: unknown[] | undefined
}

function createTransactionRunner(responses: QueryResultRow[][]): {
  calls: QueryCall[]
  runner: PostgresTransactionRunner
} {
  const calls: QueryCall[] = []
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params })
      const rows = responses.shift() ?? []
      return { rows, rowCount: rows.length }
    },
  } as unknown as PoolClient
  return {
    calls,
    runner: {
      withTransaction: (operation) => operation(client),
    },
  }
}

function joinedSql(calls: QueryCall[]): string {
  return calls.map((call) => call.sql.toLowerCase()).join('\n')
}

function userRows(overrides: Partial<QueryResultRow> = {}): QueryResultRow[] {
  return [
    {
      id: 'user-1',
      email: 'creator@example.com',
      name: 'Creator',
      passwordHash: 'hash',
      tenantId: 'tenant-1',
      roles: ['creator'],
      plan: 'free',
      credits: 100,
      ...overrides,
    },
  ]
}

function projectRows(overrides: Partial<QueryResultRow> = {}): QueryResultRow[] {
  return [
    {
      id: 'project-1',
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: 'Project',
      contentType: 'short-drama',
      aspectRatio: '9:16',
      status: 'draft',
      synopsis: '',
      script: '',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  ]
}

function assetRows(overrides: Partial<QueryResultRow> = {}): QueryResultRow[] {
  return [
    {
      id: 'asset-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      kind: 'character',
      sourceMode: 'generate',
      name: 'Character',
      description: '',
      prompt: '',
      promptMode: 'standard',
      customPromptMode: 'append',
      customPrompt: '',
      negativePrompt: '',
      references: [],
      attributes: {
        type: 'character',
        subjectType: 'human',
        gender: 'female',
        ageGroup: 'young',
        exactAge: null,
        species: '',
        anthropomorphic: false,
        visualStyle: 'cinematic-cg',
        framing: 'full',
        bodyType: 'balanced',
        background: 'solid',
        faceStatus: 'pending',
        bodyStatus: 'pending',
        faceReference: null,
        bodyReference: null,
        legStretch: false,
        faceBrightening: false,
        turnaround: false,
        turnaroundReferences: [],
        turnaroundLayout: 'sheet',
      },
      imageUrl: null,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  ]
}

function shotRows(overrides: Partial<QueryResultRow> = {}): QueryResultRow[] {
  return [
    {
      id: 'shot-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      order: 1,
      title: 'Shot 1',
      framing: 'wide',
      duration: 4,
      prompt: 'Prompt',
      assetIds: [],
      imageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  ]
}

function ledgerRows(overrides: Partial<QueryResultRow> = {}): QueryResultRow[] {
  return [
    {
      id: 'ledger-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      amount: -6,
      balance: 94,
      type: 'generation',
      description: 'Task',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  ]
}

function mediaRows(overrides: Partial<QueryResultRow> = {}): QueryResultRow[] {
  return [
    {
      id: 'media-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      kind: 'image',
      name: 'reference.png',
      contentType: 'image/png',
      size: 128,
      storageKey: 'tenant-1/project-1/reference.png',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  ]
}
