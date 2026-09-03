import type {
  AssetLibraryItemRecord,
  AssetLibraryItemVersionRecord,
  AssetLibraryStatsResponse,
  ListAssetLibraryItemsQuery,
  Principal,
  UpdateAssetLibraryItem,
} from '@seqora/contracts'
import type { PoolClient, QueryResultRow } from 'pg'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppState, AppStore } from '../../infra/store.js'

type AssetLibraryItemRow = QueryResultRow & {
  id: string
  tenant_id: string
  owner_user_id: string
  kind: AssetLibraryItemRecord['kind']
  title: string
  description: string
  source_project_id: string | null
  source_project_name: string | null
  source_asset_id: string | null
  source_task_id: string | null
  source_media_id: string | null
  source_snapshot: unknown
  storage_key: string
  preview_storage_key: string | null
  content_hash: string
  content_type: string
  size_bytes: number | string
  duplicate_of_item_id: string | null
  current_version: number | string
  tags: unknown
  created_at: Date | string
  updated_at: Date | string
  restored_at: Date | string | null
  deleted_at: Date | string | null
}

type AssetLibraryItemVersionRow = QueryResultRow & {
  id: string
  item_id: string
  tenant_id: string
  owner_user_id: string
  version: number | string
  source_snapshot: unknown
  storage_key: string
  content_hash: string
  content_type: string
  size_bytes: number | string
  created_at: Date | string
  created_by: string
}

export type AssetLibraryListResult = {
  items: AssetLibraryItemRecord[]
  page: number
  pageSize: number
  total: number
}

export type AssetLibraryJsonImportResult = {
  assetLibraryItems: { inserted: number; skipped: number }
  assetLibraryItemVersions: { inserted: number; skipped: number }
}

export type AssetLibraryVersionItemPatch = {
  title?: string
  description?: string
  tags?: string[]
  sourceSnapshot: Record<string, unknown>
  storageKey: string
  previewStorageKey: string | null
  contentHash: string
  contentType: string
  sizeBytes: number
  duplicateOfItemId: string | null
  updatedAt: string
}

export type AssetLibraryDuplicateRecordGroup = {
  contentHash: string
  kind: AssetLibraryItemRecord['kind']
  itemCount: number
  duplicateCount: number
  totalBytes: number
  wastedBytes: number
  canonicalItemId: string | null
  items: AssetLibraryItemRecord[]
}

const itemColumns = `
  id,
  tenant_id,
  owner_user_id,
  kind,
  title,
  description,
  source_project_id,
  source_project_name,
  source_asset_id,
  source_task_id,
  source_media_id,
  source_snapshot,
  storage_key,
  preview_storage_key,
  content_hash,
  content_type,
  size_bytes,
  duplicate_of_item_id,
  current_version,
  tags,
  created_at,
  updated_at,
  restored_at,
  deleted_at
`

const versionColumns = `
  id,
  item_id,
  tenant_id,
  owner_user_id,
  version,
  source_snapshot,
  storage_key,
  content_hash,
  content_type,
  size_bytes,
  created_at,
  created_by
`

export class AssetLibraryRepository {
  constructor(
    private readonly store: AppStore | null,
    private readonly database: AccountDatabase | null = null,
  ) {}

  async importFromStore(): Promise<AssetLibraryJsonImportResult> {
    const result: AssetLibraryJsonImportResult = {
      assetLibraryItems: { inserted: 0, skipped: 0 },
      assetLibraryItemVersions: { inserted: 0, skipped: 0 },
    }
    if (!this.database || !this.store) return result
    const { items, versions } = this.store.read((state) => ({
      items: state.assetLibraryItems,
      versions: state.assetLibraryItemVersions,
    }))
    const versionsByItem = groupVersionsByItem(versions)
    await this.database.transaction(async (client) => {
      for (const item of items) {
        if (await insertItemFromStore(client, item)) result.assetLibraryItems.inserted += 1
        else result.assetLibraryItems.skipped += 1
        const itemVersions = versionsByItem.get(item.id) ?? [versionFromItem(item)]
        for (const version of itemVersions) {
          if (await insertVersionFromStore(client, version)) result.assetLibraryItemVersions.inserted += 1
          else result.assetLibraryItemVersions.skipped += 1
        }
      }
    })
    await this.refreshRuntimeCacheFromDatabase()
    return result
  }

  async bootstrapFromStore(): Promise<void> {
    await this.importFromStore()
  }

  async refreshRuntimeCacheFromDatabase(): Promise<void> {
    if (!this.database || !this.store) return
    const [items, versions] = await Promise.all([
      this.database.query<AssetLibraryItemRow>(
        `SELECT ${itemColumns} FROM asset_library_items ORDER BY created_at DESC, id DESC`,
      ),
      this.database.query<AssetLibraryItemVersionRow>(
        `SELECT ${versionColumns} FROM asset_library_item_versions ORDER BY created_at DESC, version DESC`,
      ),
    ])
    await this.store.replaceLibraryRuntimeCacheAsync({
      assetLibraryItems: items.rows.map(itemFromRow),
      assetLibraryItemVersions: versions.rows.map(versionFromRow),
    })
  }

  async list(query: ListAssetLibraryItemsQuery, principal: Principal): Promise<AssetLibraryListResult> {
    if (!this.database) return this.listFromStore(query, principal)

    const { conditions, params } = listConditions(query, principal)
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (query.page - 1) * query.pageSize
    const [count, items] = await Promise.all([
      this.database.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM asset_library_items ${where}`,
        params,
      ),
      this.database.query<AssetLibraryItemRow>(
        `
        SELECT ${itemColumns}
        FROM asset_library_items
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, query.pageSize, offset],
      ),
    ])

    return {
      items: items.rows.map(itemFromRow),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(count.rows[0]?.total ?? 0),
    }
  }

  async find(
    itemId: string,
    principal: Principal,
    options: { includeDeleted?: boolean } = {},
  ): Promise<AssetLibraryItemRecord | null> {
    if (!this.database) {
      return this.requireStore().read(
        (state) =>
          state.assetLibraryItems.find(
            (item) =>
              item.id === itemId &&
              item.tenantId === principal.tenantId &&
              item.ownerUserId === principal.userId &&
              (options.includeDeleted || item.deletedAt === null),
          ) ?? null,
      )
    }
    const deletedCondition = options.includeDeleted ? '' : 'AND deleted_at IS NULL'
    const result = await this.database.query<AssetLibraryItemRow>(
      `
      SELECT ${itemColumns}
      FROM asset_library_items
      WHERE id = $1
        AND tenant_id = $2
        AND owner_user_id = $3
        ${deletedCondition}
      LIMIT 1
      `,
      [itemId, principal.tenantId, principal.userId],
    )
    return result.rows[0] ? itemFromRow(result.rows[0]) : null
  }

  async findDuplicate(
    kind: AssetLibraryItemRecord['kind'],
    contentHash: string,
    principal: Principal,
  ): Promise<AssetLibraryItemRecord | null> {
    if (contentHash.startsWith('legacy:')) return null
    if (!this.database) {
      return (
        this.requireStore()
          .read((state) => state.assetLibraryItems)
          .filter(
            (item) =>
              item.tenantId === principal.tenantId &&
              item.ownerUserId === principal.userId &&
              item.kind === kind &&
              item.contentHash === contentHash &&
              item.deletedAt === null,
          )
          .sort(canonicalSort)[0] ?? null
      )
    }
    const result = await this.database.query<AssetLibraryItemRow>(
      `
      SELECT ${itemColumns}
      FROM asset_library_items
      WHERE tenant_id = $1
        AND owner_user_id = $2
        AND kind = $3
        AND content_hash = $4
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN duplicate_of_item_id IS NULL THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
      LIMIT 1
      `,
      [principal.tenantId, principal.userId, kind, contentHash],
    )
    return result.rows[0] ? itemFromRow(result.rows[0]) : null
  }

  async create(
    item: AssetLibraryItemRecord,
    initialVersion: AssetLibraryItemVersionRecord,
  ): Promise<AssetLibraryItemRecord> {
    if (!this.database) {
      return this.requireStore().mutateLibraryRuntimeCache((state) => {
        state.assetLibraryItems.unshift(item)
        state.assetLibraryItemVersions.unshift(initialVersion)
        return item
      })
    }
    const inserted = await this.database.transaction(async (client) => {
      const itemResult = await client.query<AssetLibraryItemRow>(
        `
        INSERT INTO asset_library_items (
          id,
          tenant_id,
          owner_user_id,
          kind,
          title,
          description,
          source_project_id,
          source_project_name,
          source_asset_id,
          source_task_id,
          source_media_id,
          source_snapshot,
          storage_key,
          preview_storage_key,
          content_hash,
          content_type,
          size_bytes,
          duplicate_of_item_id,
          current_version,
          tags,
          created_at,
          updated_at,
          restored_at,
          deleted_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12::jsonb, $13, $14, $15, $16, $17, $18,
          $19, $20::jsonb, $21, $22, $23, $24
        )
        RETURNING ${itemColumns}
        `,
        itemParams(item),
      )
      await insertVersion(client, initialVersion)
      return itemFromRow(itemResult.rows[0]!)
    })
    await this.mirrorItem(inserted)
    await this.mirrorVersion(initialVersion)
    return inserted
  }

  async update(
    itemId: string,
    input: UpdateAssetLibraryItem,
    principal: Principal,
  ): Promise<AssetLibraryItemRecord | null> {
    if (!this.database) {
      return this.requireStore().mutateLibraryRuntimeCache((state) => {
        const item = findOwnedItem(state, itemId, principal, false)
        if (!item) return null
        if (input.title !== undefined) item.title = input.title
        if (input.description !== undefined) item.description = input.description
        if (input.tags !== undefined) item.tags = input.tags
        item.updatedAt = new Date().toISOString()
        return item
      })
    }

    const updatedAt = new Date().toISOString()
    const current = await this.find(itemId, principal)
    if (!current) return null
    const updated: AssetLibraryItemRecord = {
      ...current,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      tags: input.tags ?? current.tags,
      updatedAt,
    }
    const result = await this.database.query<AssetLibraryItemRow>(
      `
      UPDATE asset_library_items
      SET title = $4,
          description = $5,
          tags = $6::jsonb,
          updated_at = $7
      WHERE id = $1
        AND tenant_id = $2
        AND owner_user_id = $3
        AND deleted_at IS NULL
      RETURNING ${itemColumns}
      `,
      [
        itemId,
        principal.tenantId,
        principal.userId,
        updated.title,
        updated.description,
        JSON.stringify(updated.tags),
        updated.updatedAt,
      ],
    )
    const item = result.rows[0] ? itemFromRow(result.rows[0]) : null
    if (item) await this.mirrorItem(item)
    return item
  }

  async addVersion(
    itemId: string,
    version: AssetLibraryItemVersionRecord,
    patch: AssetLibraryVersionItemPatch,
    principal: Principal,
  ): Promise<AssetLibraryItemRecord | null> {
    if (!this.database) {
      return this.requireStore().mutateLibraryRuntimeCache((state) => {
        const item = findOwnedItem(state, itemId, principal, false)
        if (!item) return null
        applyVersionPatch(item, version.version, patch)
        state.assetLibraryItemVersions.unshift(version)
        return item
      })
    }

    const item = await this.database.transaction(async (client) => {
      await insertVersion(client, version)
      const result = await client.query<AssetLibraryItemRow>(
        `
        UPDATE asset_library_items
        SET title = COALESCE($4, title),
            description = COALESCE($5, description),
            tags = COALESCE($6::jsonb, tags),
            source_snapshot = $7::jsonb,
            storage_key = $8,
            preview_storage_key = $9,
            content_hash = $10,
            content_type = $11,
            size_bytes = $12,
            duplicate_of_item_id = $13,
            current_version = $14,
            updated_at = $15
        WHERE id = $1
          AND tenant_id = $2
          AND owner_user_id = $3
          AND deleted_at IS NULL
        RETURNING ${itemColumns}
        `,
        [
          itemId,
          principal.tenantId,
          principal.userId,
          patch.title ?? null,
          patch.description ?? null,
          patch.tags === undefined ? null : JSON.stringify(patch.tags),
          JSON.stringify(patch.sourceSnapshot),
          patch.storageKey,
          patch.previewStorageKey,
          patch.contentHash,
          patch.contentType,
          patch.sizeBytes,
          patch.duplicateOfItemId,
          version.version,
          patch.updatedAt,
        ],
      )
      return result.rows[0] ? itemFromRow(result.rows[0]) : null
    })
    if (item) await this.mirrorItem(item)
    await this.mirrorVersion(version)
    return item
  }

  async listVersions(itemId: string, principal: Principal): Promise<AssetLibraryItemVersionRecord[]> {
    const item = await this.find(itemId, principal, { includeDeleted: true })
    if (!item) return []
    if (!this.database) {
      return this.requireStore()
        .read((state) => state.assetLibraryItemVersions)
        .filter(
          (version) =>
            version.itemId === itemId &&
            version.tenantId === principal.tenantId &&
            version.ownerUserId === principal.userId,
        )
        .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt))
    }
    const result = await this.database.query<AssetLibraryItemVersionRow>(
      `
      SELECT ${versionColumns}
      FROM asset_library_item_versions
      WHERE item_id = $1
        AND tenant_id = $2
        AND owner_user_id = $3
      ORDER BY version DESC, created_at DESC
      `,
      [itemId, principal.tenantId, principal.userId],
    )
    return result.rows.map(versionFromRow)
  }

  async findVersion(
    itemId: string,
    versionNumber: number,
    principal: Principal,
  ): Promise<AssetLibraryItemVersionRecord | null> {
    const item = await this.find(itemId, principal, { includeDeleted: true })
    if (!item) return null
    if (!this.database) {
      return (
        this.requireStore().read(
          (state) =>
            state.assetLibraryItemVersions.find(
              (version) =>
                version.itemId === itemId &&
                version.version === versionNumber &&
                version.tenantId === principal.tenantId &&
                version.ownerUserId === principal.userId,
            ) ?? null,
        ) ?? null
      )
    }
    const result = await this.database.query<AssetLibraryItemVersionRow>(
      `
      SELECT ${versionColumns}
      FROM asset_library_item_versions
      WHERE item_id = $1
        AND version = $2
        AND tenant_id = $3
        AND owner_user_id = $4
      LIMIT 1
      `,
      [itemId, versionNumber, principal.tenantId, principal.userId],
    )
    return result.rows[0] ? versionFromRow(result.rows[0]) : null
  }

  async delete(itemId: string, principal: Principal): Promise<boolean> {
    const deletedAt = new Date().toISOString()
    if (!this.database) {
      return this.requireStore().mutateLibraryRuntimeCache((state) => {
        const item = findOwnedItem(state, itemId, principal, false)
        if (!item) return false
        item.deletedAt = deletedAt
        item.updatedAt = deletedAt
        return true
      })
    }
    const result = await this.database.query<AssetLibraryItemRow>(
      `
      UPDATE asset_library_items
      SET deleted_at = $4,
          updated_at = $4
      WHERE id = $1
        AND tenant_id = $2
        AND owner_user_id = $3
        AND deleted_at IS NULL
      RETURNING ${itemColumns}
      `,
      [itemId, principal.tenantId, principal.userId, deletedAt],
    )
    const item = result.rows[0] ? itemFromRow(result.rows[0]) : null
    if (item) await this.mirrorItem(item)
    return Boolean(item)
  }

  async restore(itemId: string, principal: Principal): Promise<AssetLibraryItemRecord | null> {
    const restoredAt = new Date().toISOString()
    if (!this.database) {
      return this.requireStore().mutateLibraryRuntimeCache((state) => {
        const item = findOwnedItem(state, itemId, principal, true)
        if (!item || item.deletedAt === null) return item ?? null
        item.deletedAt = null
        item.restoredAt = restoredAt
        item.updatedAt = restoredAt
        return item
      })
    }
    const result = await this.database.query<AssetLibraryItemRow>(
      `
      UPDATE asset_library_items
      SET deleted_at = NULL,
          restored_at = $4,
          updated_at = $4
      WHERE id = $1
        AND tenant_id = $2
        AND owner_user_id = $3
      RETURNING ${itemColumns}
      `,
      [itemId, principal.tenantId, principal.userId, restoredAt],
    )
    const item = result.rows[0] ? itemFromRow(result.rows[0]) : null
    if (item) await this.mirrorItem(item)
    return item
  }

  async permanentDelete(itemId: string, principal: Principal): Promise<boolean> {
    if (!this.database) {
      return this.requireStore().mutateLibraryRuntimeCache((state) => {
        const item = findOwnedItem(state, itemId, principal, true)
        if (!item) return false
        state.assetLibraryItems = state.assetLibraryItems.filter((candidate) => candidate.id !== itemId)
        state.assetLibraryItemVersions = state.assetLibraryItemVersions.filter(
          (version) => version.itemId !== itemId,
        )
        for (const candidate of state.assetLibraryItems) {
          if (candidate.duplicateOfItemId === itemId) candidate.duplicateOfItemId = null
        }
        return true
      })
    }
    const result = await this.database.query<AssetLibraryItemRow>(
      `
      DELETE FROM asset_library_items
      WHERE id = $1
        AND tenant_id = $2
        AND owner_user_id = $3
      RETURNING ${itemColumns}
      `,
      [itemId, principal.tenantId, principal.userId],
    )
    if (result.rows[0]) {
      await this.refreshRuntimeCacheFromDatabase()
      return true
    }
    return false
  }

  async stats(principal: Principal): Promise<AssetLibraryStatsResponse> {
    const [items, versions] = await this.readOwnedLibrary(principal)
    return computeStats(items, versions)
  }

  async duplicates(principal: Principal): Promise<AssetLibraryDuplicateRecordGroup[]> {
    const [items] = await this.readOwnedLibrary(principal)
    return duplicateGroups(items)
  }

  async dedupe(
    principal: Principal,
  ): Promise<{ groups: AssetLibraryDuplicateRecordGroup[]; updatedItems: number }> {
    const [items] = await this.readOwnedLibrary(principal)
    const groups = duplicateGroups(items, true)
    let updatedItems = 0
    if (!groups.length) return { groups: [], updatedItems }

    if (!this.database) {
      this.requireStore().mutateLibraryRuntimeCache((state) => {
        for (const group of groups) {
          for (const item of group.items) {
            const target = state.assetLibraryItems.find((candidate) => candidate.id === item.id)
            if (!target) continue
            const duplicateOfItemId = target.id === group.canonicalItemId ? null : group.canonicalItemId
            if (target.duplicateOfItemId === duplicateOfItemId) continue
            target.duplicateOfItemId = duplicateOfItemId
            target.updatedAt = new Date().toISOString()
            updatedItems += 1
          }
        }
      })
      return { groups: await this.duplicates(principal), updatedItems }
    }

    await this.database.transaction(async (client) => {
      for (const group of groups) {
        for (const item of group.items) {
          const duplicateOfItemId = item.id === group.canonicalItemId ? null : group.canonicalItemId
          const result = await client.query(
            `
            UPDATE asset_library_items
            SET duplicate_of_item_id = $4,
                updated_at = $5
            WHERE id = $1
              AND tenant_id = $2
              AND owner_user_id = $3
              AND duplicate_of_item_id IS DISTINCT FROM $4
            `,
            [item.id, principal.tenantId, principal.userId, duplicateOfItemId, new Date().toISOString()],
          )
          updatedItems += result.rowCount ?? 0
        }
      }
    })
    await this.refreshRuntimeCacheFromDatabase()
    return { groups: await this.duplicates(principal), updatedItems }
  }

  private listFromStore(query: ListAssetLibraryItemsQuery, principal: Principal): AssetLibraryListResult {
    const filtered = this.requireStore()
      .read((state) => state.assetLibraryItems)
      .filter((item) => matchesStoreFilter(item, query, principal))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    const offset = (query.page - 1) * query.pageSize
    return {
      items: filtered.slice(offset, offset + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
    }
  }

  private async readOwnedLibrary(
    principal: Principal,
  ): Promise<[AssetLibraryItemRecord[], AssetLibraryItemVersionRecord[]]> {
    if (!this.database) {
      return this.requireStore().read((state) => [
        state.assetLibraryItems.filter(
          (item) => item.tenantId === principal.tenantId && item.ownerUserId === principal.userId,
        ),
        state.assetLibraryItemVersions.filter(
          (version) => version.tenantId === principal.tenantId && version.ownerUserId === principal.userId,
        ),
      ])
    }
    const [items, versions] = await Promise.all([
      this.database.query<AssetLibraryItemRow>(
        `
        SELECT ${itemColumns}
        FROM asset_library_items
        WHERE tenant_id = $1
          AND owner_user_id = $2
        `,
        [principal.tenantId, principal.userId],
      ),
      this.database.query<AssetLibraryItemVersionRow>(
        `
        SELECT ${versionColumns}
        FROM asset_library_item_versions
        WHERE tenant_id = $1
          AND owner_user_id = $2
        `,
        [principal.tenantId, principal.userId],
      ),
    ])
    return [items.rows.map(itemFromRow), versions.rows.map(versionFromRow)]
  }

  private async mirrorItem(item: AssetLibraryItemRecord): Promise<void> {
    if (!this.store) return
    this.store.mutateLibraryRuntimeCache((state) => {
      const index = state.assetLibraryItems.findIndex((candidate) => candidate.id === item.id)
      if (index >= 0) state.assetLibraryItems[index] = item
      else state.assetLibraryItems.unshift(item)
    })
  }

  private async mirrorVersion(version: AssetLibraryItemVersionRecord): Promise<void> {
    if (!this.store) return
    this.store.mutateLibraryRuntimeCache((state) => {
      const index = state.assetLibraryItemVersions.findIndex((candidate) => candidate.id === version.id)
      if (index >= 0) state.assetLibraryItemVersions[index] = version
      else state.assetLibraryItemVersions.unshift(version)
    })
  }

  private requireStore(): AppStore {
    if (!this.store) {
      throw new Error('JSON AppStore is unavailable; AssetLibraryRepository must use Postgres in runtime')
    }
    return this.store
  }
}

async function insertItemFromStore(client: PoolClient, item: AssetLibraryItemRecord): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO asset_library_items (
      id,
      tenant_id,
      owner_user_id,
      kind,
      title,
      description,
      source_project_id,
      source_project_name,
      source_asset_id,
      source_task_id,
      source_media_id,
      source_snapshot,
      storage_key,
      preview_storage_key,
      content_hash,
      content_type,
      size_bytes,
      duplicate_of_item_id,
      current_version,
      tags,
      created_at,
      updated_at,
      restored_at,
      deleted_at
    )
    SELECT
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12::jsonb, $13, $14, $15, $16, $17, $18,
      $19, $20::jsonb, $21, $22, $23, $24
    WHERE EXISTS (SELECT 1 FROM tenants WHERE id = $2)
      AND EXISTS (SELECT 1 FROM users WHERE id = $3)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
    `,
    itemParams(item),
  )
  return (result.rowCount ?? 0) > 0
}

async function insertVersionFromStore(
  client: PoolClient,
  version: AssetLibraryItemVersionRecord,
): Promise<boolean> {
  const result = await client.query(
    `
    INSERT INTO asset_library_item_versions (
      id,
      item_id,
      tenant_id,
      owner_user_id,
      version,
      source_snapshot,
      storage_key,
      content_hash,
      content_type,
      size_bytes,
      created_at,
      created_by
    )
    SELECT
      $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12
    WHERE EXISTS (SELECT 1 FROM asset_library_items WHERE id = $2)
      AND EXISTS (SELECT 1 FROM users WHERE id = $12)
    ON CONFLICT (item_id, version) DO NOTHING
    RETURNING id
    `,
    versionParams(version),
  )
  return (result.rowCount ?? 0) > 0
}

async function insertVersion(client: PoolClient, version: AssetLibraryItemVersionRecord): Promise<void> {
  await client.query(
    `
    INSERT INTO asset_library_item_versions (
      id,
      item_id,
      tenant_id,
      owner_user_id,
      version,
      source_snapshot,
      storage_key,
      content_hash,
      content_type,
      size_bytes,
      created_at,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
    `,
    versionParams(version),
  )
}

function itemParams(item: AssetLibraryItemRecord): unknown[] {
  return [
    item.id,
    item.tenantId,
    item.ownerUserId,
    item.kind,
    item.title,
    item.description,
    item.sourceProjectId,
    item.sourceProjectName,
    item.sourceAssetId,
    item.sourceTaskId,
    item.sourceMediaId,
    JSON.stringify(item.sourceSnapshot),
    item.storageKey,
    item.previewStorageKey,
    item.contentHash,
    item.contentType,
    item.sizeBytes,
    item.duplicateOfItemId,
    item.currentVersion,
    JSON.stringify(item.tags),
    item.createdAt,
    item.updatedAt,
    item.restoredAt,
    item.deletedAt,
  ]
}

function versionParams(version: AssetLibraryItemVersionRecord): unknown[] {
  return [
    version.id,
    version.itemId,
    version.tenantId,
    version.ownerUserId,
    version.version,
    JSON.stringify(version.sourceSnapshot),
    version.storageKey,
    version.contentHash,
    version.contentType,
    version.sizeBytes,
    version.createdAt,
    version.createdBy,
  ]
}

function listConditions(query: ListAssetLibraryItemsQuery, principal: Principal) {
  const conditions = ['tenant_id = $1', 'owner_user_id = $2']
  const params: unknown[] = [principal.tenantId, principal.userId]
  if (query.deleted === 'trashed') conditions.push('deleted_at IS NOT NULL')
  else if (query.deleted !== 'all') conditions.push('deleted_at IS NULL')
  if (query.kind) {
    params.push(query.kind)
    conditions.push(`kind = $${params.length}`)
  }
  if (query.sourceProjectId) {
    params.push(query.sourceProjectId)
    conditions.push(`source_project_id = $${params.length}`)
  }
  if (query.tag) {
    params.push(JSON.stringify([query.tag]))
    conditions.push(`tags @> $${params.length}::jsonb`)
  }
  if (query.q) {
    params.push(`%${query.q}%`)
    const index = params.length
    conditions.push(
      `(title ILIKE $${index} OR description ILIKE $${index} OR source_project_name ILIKE $${index} OR source_snapshot::text ILIKE $${index})`,
    )
  }
  return { conditions, params }
}

function matchesStoreFilter(
  item: AssetLibraryItemRecord,
  query: ListAssetLibraryItemsQuery,
  principal: Principal,
): boolean {
  if (item.tenantId !== principal.tenantId || item.ownerUserId !== principal.userId) return false
  if (query.deleted === 'trashed' && item.deletedAt === null) return false
  if (query.deleted !== 'trashed' && query.deleted !== 'all' && item.deletedAt !== null) return false
  if (query.kind && item.kind !== query.kind) return false
  if (query.sourceProjectId && item.sourceProjectId !== query.sourceProjectId) return false
  if (query.tag && !item.tags.includes(query.tag)) return false
  if (query.q) {
    const needle = query.q.toLowerCase()
    const source = [
      item.title,
      item.description,
      item.sourceProjectName ?? '',
      JSON.stringify(item.sourceSnapshot),
    ]
      .join(' ')
      .toLowerCase()
    if (!source.includes(needle)) return false
  }
  return true
}

function findOwnedItem(
  state: AppState,
  itemId: string,
  principal: Principal,
  includeDeleted: boolean,
): AssetLibraryItemRecord | null {
  return (
    state.assetLibraryItems.find(
      (item) =>
        item.id === itemId &&
        item.tenantId === principal.tenantId &&
        item.ownerUserId === principal.userId &&
        (includeDeleted || item.deletedAt === null),
    ) ?? null
  )
}

function applyVersionPatch(
  item: AssetLibraryItemRecord,
  version: number,
  patch: AssetLibraryVersionItemPatch,
): void {
  if (patch.title !== undefined) item.title = patch.title
  if (patch.description !== undefined) item.description = patch.description
  if (patch.tags !== undefined) item.tags = patch.tags
  item.sourceSnapshot = patch.sourceSnapshot
  item.storageKey = patch.storageKey
  item.previewStorageKey = patch.previewStorageKey
  item.contentHash = patch.contentHash
  item.contentType = patch.contentType
  item.sizeBytes = patch.sizeBytes
  item.duplicateOfItemId = patch.duplicateOfItemId
  item.currentVersion = version
  item.updatedAt = patch.updatedAt
}

function computeStats(
  items: AssetLibraryItemRecord[],
  versions: AssetLibraryItemVersionRecord[],
): AssetLibraryStatsResponse {
  const activeItems = items.filter((item) => item.deletedAt === null)
  const byKind = new Map<AssetLibraryItemRecord['kind'], AssetLibraryStatsResponse['byKind'][number]>()
  for (const item of items) {
    const current = byKind.get(item.kind) ?? {
      kind: item.kind,
      count: 0,
      trashed: 0,
      duplicates: 0,
      sizeBytes: 0,
      versions: 0,
    }
    if (item.deletedAt) current.trashed += 1
    else {
      current.count += 1
      current.sizeBytes += item.sizeBytes
      if (item.duplicateOfItemId) current.duplicates += 1
    }
    byKind.set(item.kind, current)
  }
  const itemKind = new Map(items.map((item) => [item.id, item.kind]))
  for (const version of versions) {
    const kind = itemKind.get(version.itemId)
    if (!kind) continue
    const current = byKind.get(kind)
    if (current) current.versions += 1
  }

  const bySourceProject = new Map<string, AssetLibraryStatsResponse['bySourceProject'][number]>()
  for (const item of activeItems) {
    const key = item.sourceProjectId ?? '__none__'
    const current = bySourceProject.get(key) ?? {
      sourceProjectId: item.sourceProjectId,
      sourceProjectName: item.sourceProjectName,
      count: 0,
      sizeBytes: 0,
    }
    current.count += 1
    current.sizeBytes += item.sizeBytes
    bySourceProject.set(key, current)
  }

  return {
    totalItems: items.length,
    activeItems: activeItems.length,
    trashedItems: items.length - activeItems.length,
    duplicateItems: activeItems.filter((item) => item.duplicateOfItemId).length,
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    activeBytes: activeItems.reduce((total, item) => total + item.sizeBytes, 0),
    versionCount: versions.length,
    byKind: [...byKind.values()].sort((left, right) => left.kind.localeCompare(right.kind)),
    bySourceProject: [...bySourceProject.values()].sort((left, right) => right.count - left.count),
  }
}

function duplicateGroups(
  items: AssetLibraryItemRecord[],
  scanOnly = false,
): AssetLibraryDuplicateRecordGroup[] {
  const groups = new Map<string, AssetLibraryItemRecord[]>()
  for (const item of items) {
    if (item.deletedAt !== null || item.contentHash.startsWith('legacy:')) continue
    const key = `${item.kind}:${item.contentHash}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()]
    .filter((group) => group.length > 1 || (!scanOnly && group.some((item) => item.duplicateOfItemId)))
    .map((group) => {
      const sorted = [...group].sort(canonicalSort)
      const canonical = sorted[0]!
      const totalBytes = sorted.reduce((total, item) => total + item.sizeBytes, 0)
      return {
        contentHash: canonical.contentHash,
        kind: canonical.kind,
        itemCount: sorted.length,
        duplicateCount: Math.max(0, sorted.length - 1),
        totalBytes,
        wastedBytes: Math.max(0, totalBytes - canonical.sizeBytes),
        canonicalItemId: canonical.id,
        items: sorted,
      }
    })
    .sort((left, right) => right.wastedBytes - left.wastedBytes || right.itemCount - left.itemCount)
}

function canonicalSort(left: AssetLibraryItemRecord, right: AssetLibraryItemRecord): number {
  if (left.duplicateOfItemId === null && right.duplicateOfItemId !== null) return -1
  if (left.duplicateOfItemId !== null && right.duplicateOfItemId === null) return 1
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function groupVersionsByItem(
  versions: readonly AssetLibraryItemVersionRecord[],
): Map<string, AssetLibraryItemVersionRecord[]> {
  const grouped = new Map<string, AssetLibraryItemVersionRecord[]>()
  for (const version of versions) {
    grouped.set(version.itemId, [...(grouped.get(version.itemId) ?? []), version])
  }
  return grouped
}

function versionFromItem(item: AssetLibraryItemRecord): AssetLibraryItemVersionRecord {
  return {
    id: `${item.id}:v${item.currentVersion || 1}`,
    itemId: item.id,
    tenantId: item.tenantId,
    ownerUserId: item.ownerUserId,
    version: item.currentVersion || 1,
    sourceSnapshot: item.sourceSnapshot,
    storageKey: item.storageKey,
    contentHash: item.contentHash,
    contentType: item.contentType,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    createdBy: item.ownerUserId,
  }
}

function itemFromRow(row: AssetLibraryItemRow): AssetLibraryItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    sourceProjectId: row.source_project_id,
    sourceProjectName: row.source_project_name,
    sourceAssetId: row.source_asset_id,
    sourceTaskId: row.source_task_id,
    sourceMediaId: row.source_media_id,
    sourceSnapshot: jsonValue(row.source_snapshot, {}),
    storageKey: row.storage_key,
    previewStorageKey: row.preview_storage_key,
    contentHash: row.content_hash,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    duplicateOfItemId: row.duplicate_of_item_id,
    currentVersion: Number(row.current_version),
    tags: jsonValue(row.tags, []),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
    restoredAt: row.restored_at ? isoString(row.restored_at) : null,
    deletedAt: row.deleted_at ? isoString(row.deleted_at) : null,
  }
}

function versionFromRow(row: AssetLibraryItemVersionRow): AssetLibraryItemVersionRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id,
    version: Number(row.version),
    sourceSnapshot: jsonValue(row.source_snapshot, {}),
    storageKey: row.storage_key,
    contentHash: row.content_hash,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: isoString(row.created_at),
    createdBy: row.created_by,
  }
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return structuredClone(value) as T
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
