import {
  ASSET_LIBRARY_CATEGORY_KINDS,
  type AssetLibraryItemRecord,
  type ListAssetLibraryItemsQuery,
  type Principal,
} from '@seqora/contracts'

export function listConditions(query: ListAssetLibraryItemsQuery, principal: Principal) {
  const conditions = ['tenant_id = $1', 'owner_user_id = $2']
  const params: unknown[] = [principal.tenantId, principal.userId]
  if (query.deleted === 'trashed') conditions.push('deleted_at IS NOT NULL')
  else if (query.deleted !== 'all') conditions.push('deleted_at IS NULL')
  if (query.kind) {
    params.push(query.kind)
    conditions.push(`kind = $${params.length}`)
  }
  if (query.category) {
    params.push(ASSET_LIBRARY_CATEGORY_KINDS[query.category])
    conditions.push(`kind = ANY($${params.length}::text[])`)
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

export function matchesStoreFilter(
  item: AssetLibraryItemRecord,
  query: ListAssetLibraryItemsQuery,
  principal: Principal,
): boolean {
  if (item.tenantId !== principal.tenantId || item.ownerUserId !== principal.userId) return false
  if (query.deleted === 'trashed' && item.deletedAt === null) return false
  if (query.deleted !== 'trashed' && query.deleted !== 'all' && item.deletedAt !== null) return false
  if (query.kind && item.kind !== query.kind) return false
  if (query.category && !ASSET_LIBRARY_CATEGORY_KINDS[query.category].includes(item.kind)) return false
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
