import type { QueryResult, QueryResultRow } from 'pg'
import { vi } from 'vitest'

export function mockQueryRows(rows: QueryResultRow[]) {
  const execute = async <T extends QueryResultRow = QueryResultRow>(
    _text: string,
    _params?: readonly unknown[],
  ): Promise<QueryResult<T>> => ({
    rows: structuredClone(rows) as T[],
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  })
  const query = vi.fn(execute)
  return query as typeof execute & typeof query
}
