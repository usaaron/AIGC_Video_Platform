import { describe, expect, it, vi } from 'vitest'
import { createProjectSchema, type Principal } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { ProjectRepository } from '../projects/repository.js'
import { MediaRepository } from '../media/repository.js'
import { AssetLibraryRepository } from './repository.js'
import { AssetLibraryService } from './service.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'

describe('automatic library catalog', () => {
  it('archives all image outputs and scripts without copying images, keeps trash and isolates accounts', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
    const projects = new ProjectRepository(store)
    const project = await projects.create(
      createProjectSchema.parse({ name: '自动入库测试', contentType: 'short-drama', aspectRatio: '9:16' }),
      principal,
    )
    await projects.update(project.id, { script: '林晚回到诊所。' }, principal)
    const media = new MediaRepository(store)
    await media.create(project.id, 'image', '人物候选图', 'image/png', 8, 'fixture/image.png', principal)
    const repository = new AssetLibraryRepository(store)
    const storage = { get: vi.fn(async () => Buffer.from('image')), put: vi.fn() } as unknown as ObjectStorage
    const service = new AssetLibraryService(repository, projects, media, storage)
    const list = () =>
      service.list({ page: 1, pageSize: 24, deleted: 'active', sourceProjectId: project.id }, principal)
    const first = await list()
    expect(first.items.map((item) => item.kind).sort()).toEqual(['image', 'script'])
    const script = first.items.find((item) => item.kind === 'script')!
    expect(script.sourceSnapshot.inlineContent).toBeUndefined()
    expect((await service.readContent(script.id, principal)).content.toString()).toBe('林晚回到诊所。')
    expect((await service.readVersionContent(script.id, 1, principal)).content.toString()).toBe(
      '林晚回到诊所。',
    )
    expect(storage.put).not.toHaveBeenCalled()
    const target = await projects.create(
      createProjectSchema.parse({ name: '导入目标', contentType: 'short-drama', aspectRatio: '9:16' }),
      principal,
    )
    await service.importToProject(target.id, { itemId: script.id, target: 'auto' }, principal)
    expect((await projects.workspace(target.id, principal))?.scriptEpisodes[0]?.draftContent).toBe(
      '林晚回到诊所。',
    )
    expect((await list()).total).toBe(2)
    await service.delete(script.id, principal)
    expect((await list()).total).toBe(1)
    const outsider = { ...principal, userId: 'user-free' }
    expect(
      (await service.list({ page: 1, pageSize: 24, deleted: 'active' }, outsider)).items.some(
        (item) => item.sourceProjectId === project.id,
      ),
    ).toBe(false)
    await expect(service.readContent(script.id, outsider)).rejects.toMatchObject({
      code: 'LIBRARY_ITEM_NOT_FOUND',
    })
  })
})
