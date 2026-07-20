import type { PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import { loadPostgresState } from './postgresState.js'

describe('loadPostgresState', () => {
  it('adds row locks when loading a mutable state snapshot', async () => {
    const queries: string[] = []
    const client = {
      async query(sql: string) {
        queries.push(sql)
        return { rows: [], rowCount: 0 }
      },
    } as unknown as PoolClient

    await loadPostgresState(client, { lockRows: true })

    expect(queries).toHaveLength(7)
    expect(queries.every((sql) => sql.toLowerCase().includes('for update'))).toBe(true)
  })
})
