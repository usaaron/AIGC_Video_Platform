import type { AssetLibraryItemRecord, AssetLibraryItemVersionRecord } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'

export type AssetLibraryItemRow = QueryResultRow & {
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

export type AssetLibraryItemVersionRow = QueryResultRow & {
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

export function itemFromRow(row: AssetLibraryItemRow): AssetLibraryItemRecord {
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

export function versionFromRow(row: AssetLibraryItemVersionRow): AssetLibraryItemVersionRecord {
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
