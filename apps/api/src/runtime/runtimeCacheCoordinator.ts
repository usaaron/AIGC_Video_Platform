import type { QueryResultRow } from 'pg'
import type { AccountDatabase } from '../infra/postgres.js'

export type RuntimeSyncRow = QueryResultRow & {
  id: string
  updated_at?: Date | string
  runtime_sync_updated_at?: string
}

type RuntimeSyncCursor = {
  updatedAt: string
  id: string
}

type RuntimeCacheCoordinatorOptions<T, Row extends RuntimeSyncRow> = {
  allQuery: string
  activeLoader: () => Promise<T[]>
  cursorQuery: string
  deltaQuery: string
  sameTimestampQuery: string
  rowToItem: (row: Row) => T
  itemKey: (item: T) => string
  replace: (items: T[]) => Promise<void>
  merge: (items: T[]) => Promise<void>
  reconcileActive?: (items: T[]) => Promise<void>
}

const BATCH_SIZE = 1_000
const CURSOR_OVERLAP_MS = 5_000

export class RuntimeCacheCoordinator<T, Row extends RuntimeSyncRow> {
  private cursor: RuntimeSyncCursor | null = null
  private mode: 'full' | 'active' = 'full'

  constructor(
    private readonly database: AccountDatabase | null,
    private readonly options: RuntimeCacheCoordinatorOptions<T, Row>,
  ) {}

  async refresh(activeOnly = false): Promise<T[]> {
    this.mode = activeOnly ? 'active' : 'full'
    if (!this.database) return []
    if (activeOnly) {
      // Establish the high-water mark before loading. The active query then
      // includes everything at or before that mark, while later writes remain
      // visible to the next delta refresh.
      const cursor = await this.readLatestCursor()
      const items = await this.options.activeLoader()
      await this.options.replace(items)
      this.cursor = cursor
      return items
    }

    const result = await this.database.query<Row>(this.options.allQuery)
    const items = result.rows.map(this.options.rowToItem)
    await this.options.replace(items)
    this.cursor = latestCursor(result.rows)
    return items
  }

  async refreshDelta(): Promise<void> {
    if (!this.database) return
    if (!this.cursor) {
      await this.refresh(this.mode === 'active')
      return
    }
    const result = await this.queryChangedRows()
    if (this.mode === 'active') {
      if (!result.length) return
      const changed = uniqueByKey(result.map(this.options.rowToItem), this.options.itemKey)
      if (this.options.reconcileActive) await this.options.reconcileActive(changed)
      else await this.options.replace(await this.options.activeLoader())
      this.cursor = latestCursor(result, this.cursor)
      return
    }
    if (!result.length) return
    await this.options.merge(uniqueByKey(result.map(this.options.rowToItem), this.options.itemKey))
    this.cursor = latestCursor(result, this.cursor)
  }

  private async queryChangedRows(): Promise<Row[]> {
    const cursor = this.cursor!
    const result = await this.database!.query<Row>(this.options.deltaQuery, [
      cursor.updatedAt,
      cursor.id,
      BATCH_SIZE,
    ])
    const rows = [...result.rows]
    if (Date.now() - Date.parse(cursor.updatedAt) >= CURSOR_OVERLAP_MS) return rows
    const sameTimestamp = await this.database!.query<Row>(this.options.sameTimestampQuery, [
      cursor.updatedAt,
      BATCH_SIZE,
    ])
    rows.push(...sameTimestamp.rows)
    return rows
  }

  private async readLatestCursor(): Promise<RuntimeSyncCursor | null> {
    const result = await this.database!.query<RuntimeSyncRow>(this.options.cursorQuery)
    return latestCursor(result.rows)
  }
}

function latestCursor(
  rows: ReadonlyArray<RuntimeSyncRow>,
  current: RuntimeSyncCursor | null = null,
): RuntimeSyncCursor | null {
  let latest = current
  for (const row of rows) {
    const updatedAt = row.runtime_sync_updated_at ?? (row.updated_at ? toIsoString(row.updated_at) : null)
    if (!updatedAt) continue
    if (!latest || compareCursor(updatedAt, row.id, latest) > 0) {
      latest = { updatedAt, id: row.id }
    }
  }
  return latest
}

function uniqueByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [keyOf(item), item])).values()]
}

function compareCursor(updatedAt: string, id: string, current: RuntimeSyncCursor): number {
  if (updatedAt !== current.updatedAt) return updatedAt.localeCompare(current.updatedAt)
  return id.localeCompare(current.id)
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
