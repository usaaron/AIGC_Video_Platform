import type { AssetLibraryItemRecord, AssetLibraryItemVersionRecord, Principal } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { AssetLibraryRepository } from './repository.js'

const principal: Principal = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['member'],
}

describe('AssetLibraryRepository phase 3 library state', () => {
  it('tracks duplicates, stats, recycle bin state and versions in the JSON store', async () => {
    const store = new AppStore(null, undefined, false, false)
    await store.initialize()
    const repository = new AssetLibraryRepository(store)
    const first = itemRecord('asset-1', 'sha256:same', '2026-08-15T00:00:00.000Z')
    const second = itemRecord('asset-2', 'sha256:same', '2026-08-15T00:01:00.000Z')

    await repository.create(first, versionRecord(first))
    await repository.create(second, versionRecord(second))

    expect(await repository.stats(principal)).toMatchObject({
      activeItems: 2,
      duplicateItems: 0,
      versionCount: 2,
    })

    const dedupe = await repository.dedupe(principal)
    expect(dedupe.updatedItems).toBe(1)
    expect(dedupe.groups[0]).toMatchObject({
      canonicalItemId: 'asset-1',
      duplicateCount: 1,
      wastedBytes: 12,
    })
    expect((await repository.find('asset-2', principal))?.duplicateOfItemId).toBe('asset-1')

    await repository.delete('asset-2', principal)
    expect((await repository.list({ deleted: 'trashed', page: 1, pageSize: 24 }, principal)).total).toBe(1)
    expect(await repository.find('asset-2', principal)).toBeNull()

    await repository.restore('asset-2', principal)
    expect((await repository.find('asset-2', principal))?.deletedAt).toBeNull()

    const version = versionRecord(first, 2, 'sha256:new')
    const updated = await repository.addVersion(
      first.id,
      version,
      {
        sourceSnapshot: { sourceType: 'text', marker: 'v2' },
        storageKey: 'tenant-1/library/user-1/asset-1-v2.txt',
        previewStorageKey: null,
        contentHash: version.contentHash,
        contentType: version.contentType,
        sizeBytes: version.sizeBytes,
        duplicateOfItemId: null,
        updatedAt: '2026-08-15T00:02:00.000Z',
      },
      principal,
    )
    expect(updated?.currentVersion).toBe(2)
    expect((await repository.listVersions(first.id, principal)).map((item) => item.version)).toEqual([2, 1])
  })
})

function itemRecord(id: string, contentHash: string, createdAt: string): AssetLibraryItemRecord {
  return {
    id,
    tenantId: principal.tenantId,
    ownerUserId: principal.userId,
    kind: 'script',
    title: id,
    description: '',
    sourceProjectId: 'project-1',
    sourceProjectName: 'Project 1',
    sourceAssetId: null,
    sourceTaskId: null,
    sourceMediaId: null,
    sourceSnapshot: { sourceType: 'text' },
    storageKey: `tenant-1/library/user-1/${id}.txt`,
    previewStorageKey: null,
    contentHash,
    contentType: 'text/plain; charset=utf-8',
    sizeBytes: 12,
    duplicateOfItemId: null,
    currentVersion: 1,
    tags: [],
    createdAt,
    updatedAt: createdAt,
    restoredAt: null,
    deletedAt: null,
  }
}

function versionRecord(
  item: AssetLibraryItemRecord,
  version = 1,
  contentHash = item.contentHash,
): AssetLibraryItemVersionRecord {
  return {
    id: `${item.id}:v${version}`,
    itemId: item.id,
    tenantId: item.tenantId,
    ownerUserId: item.ownerUserId,
    version,
    sourceSnapshot: item.sourceSnapshot,
    storageKey: version === 1 ? item.storageKey : `tenant-1/library/user-1/${item.id}-v${version}.txt`,
    contentHash,
    contentType: item.contentType,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    createdBy: item.ownerUserId,
  }
}
