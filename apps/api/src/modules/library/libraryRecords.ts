import type {
  AssetLibraryItemRecord,
  AssetLibraryItemVersionRecord,
  AssetLibraryStatsResponse,
} from '@seqora/contracts'
import type { AssetLibraryDuplicateRecordGroup } from './repository.js'

export function computeStats(
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

export function duplicateGroups(
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

export function canonicalSort(left: AssetLibraryItemRecord, right: AssetLibraryItemRecord): number {
  if (left.duplicateOfItemId === null && right.duplicateOfItemId !== null) return -1
  if (left.duplicateOfItemId !== null && right.duplicateOfItemId === null) return 1
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

export function groupVersionsByItem(
  versions: readonly AssetLibraryItemVersionRecord[],
): Map<string, AssetLibraryItemVersionRecord[]> {
  const grouped = new Map<string, AssetLibraryItemVersionRecord[]>()
  for (const version of versions) {
    grouped.set(version.itemId, [...(grouped.get(version.itemId) ?? []), version])
  }
  return grouped
}

export function versionFromItem(item: AssetLibraryItemRecord): AssetLibraryItemVersionRecord {
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
