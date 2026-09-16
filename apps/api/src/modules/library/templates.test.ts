import { describe, expect, it } from 'vitest'
import {
  createAssetLibraryItemSchema,
  createAssetLibraryItemVersionSchema,
  type Principal,
} from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { ProjectRepository } from '../projects/repository.js'
import { MediaRepository } from '../media/repository.js'
import { AssetLibraryRepository } from './repository.js'
import { AssetLibraryService } from './service.js'

describe('personal prompt templates', () => {
  it('saves without a project, versions full text, deduplicates and protects trash previews', async () => {
    const store = new AppStore(null, undefined, false, false)
    await store.initialize()
    const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
    const files = new Map<string, Buffer>()
    const storage: ObjectStorage = {
      put: async (key, body) => {
        files.set(key, body)
      },
      get: async (key) => files.get(key)!,
      delete: async (key) => {
        files.delete(key)
      },
    }
    const service = new AssetLibraryService(
      new AssetLibraryRepository(store),
      new ProjectRepository(store),
      new MediaRepository(store),
      storage,
    )
    const content = '人物肖像，自然光照，保留衣料细节。'.repeat(200)
    const input = createAssetLibraryItemSchema.parse({
      sourceType: 'prompt-template',
      kind: 'prompt-template',
      title: '人物肖像',
      content,
    })
    const item = await service.create(input, principal)
    expect(item.sourceProjectId).toBeNull()
    expect(item.sourceSnapshot.contentPreview).toHaveLength(2000)
    expect((await service.readContent(item.id, principal, true)).content.toString()).toBe(content)
    const duplicate = await service.create(input, principal)
    expect(duplicate.duplicateOfItemId).toBe(item.id)
    expect(files.size).toBe(1)
    const updatedContent = '暮色中的人物近景'
    const update = createAssetLibraryItemVersionSchema.parse({ ...input, content: '暮色中的人物近景' })
    const version = await service.addVersion(item.id, update, principal)
    expect(version.item.currentVersion).toBe(2)
    expect(version.item.previewUrl).not.toBe(item.previewUrl)
    expect(version.item.downloadUrl).not.toBe(item.downloadUrl)
    expect((await service.readVersionContent(item.id, 1, principal)).content.toString()).toBe(content)
    expect((await service.readContent(item.id, principal, true)).content.toString()).toBe(updatedContent)
    await service.delete(item.id, principal)
    await expect(service.readContent(item.id, principal)).rejects.toMatchObject({
      code: 'LIBRARY_ITEM_NOT_FOUND',
    })
    expect((await service.readContent(item.id, principal, true)).content.toString()).toBe(updatedContent)
    for (const outsider of [
      { ...principal, userId: 'user-free' },
      { ...principal, tenantId: 'other-tenant' },
    ]) {
      await expect(service.readContent(item.id, outsider, true)).rejects.toMatchObject({
        code: 'LIBRARY_ITEM_NOT_FOUND',
      })
      await expect(service.addVersion(item.id, update, outsider)).rejects.toMatchObject({
        code: 'LIBRARY_ITEM_NOT_FOUND',
      })
    }
    await service.restore(item.id, principal)
    expect(
      (await service.list({ category: 'script', page: 1, pageSize: 12, deleted: 'active' }, principal)).total,
    ).toBe(0)
    expect(
      (
        await service.list(
          { category: 'prompt-template', page: 1, pageSize: 12, deleted: 'active' },
          principal,
        )
      ).total,
    ).toBe(2)
  })
})
