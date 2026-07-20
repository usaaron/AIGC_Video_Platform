import type { CreateGenerationTask, Principal } from '@seqora/contracts'
import type { PoolClient, QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import { PostgresGenerationTaskRepository } from './postgresRepository.js'

describe('PostgresGenerationTaskRepository', () => {
  it('creates a task and reserves credits in one row-locked transaction', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    const { calls, runner } = createTransactionRunner([
      [],
      [{ id: 'project-1' }],
      [{ id: 'user-1', tenantId: 'tenant-1', credits: 10 }],
      [],
      [],
      [],
      [],
      [
        {
          id: 'task-1',
          clientRequestId: 'client-1',
          projectId: 'project-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          kind: 'image',
          label: 'Image task',
          prompt: 'character',
          negativePrompt: '',
          provider: 'img2',
          model: null,
          metadata: {},
          status: 'queued',
          progress: 0,
          estimatedCredits: 6,
          resultUrl: null,
          outputs: [],
          error: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    ])
    const repository = new PostgresGenerationTaskRepository(runner)
    const principal: Principal = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['creator'],
    }
    const input: CreateGenerationTask = {
      clientRequestId: 'client-1',
      projectId: 'project-1',
      kind: 'image',
      label: 'Image task',
      provider: 'img2',
      estimatedCredits: 6,
      prompt: 'character',
    }

    const result = await repository.createWithCredit(input, principal)

    expect(result).toMatchObject({ task: { id: 'task-1', status: 'queued' } })
    const sql = calls.map((call) => call.sql.toLowerCase()).join('\n')
    expect(sql).toContain('from users')
    expect(sql).toContain('for update')
    expect(sql).toContain('from ledger_entries')
    expect(sql).toContain('insert into ledger_entries')
    expect(sql).toContain('insert into generation_tasks')
    expect(calls.find((call) => call.sql.toLowerCase().includes('update users'))?.params).toEqual([
      4,
      expect.any(String),
      'user-1',
      'tenant-1',
    ])
  })
})

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
