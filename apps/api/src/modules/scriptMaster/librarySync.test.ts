import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Principal } from '@seqora/contracts'
import type { AppConfig } from '../../config.js'
import { AppStore } from '../../infra/store.js'
import { AssetLibraryRepository } from '../library/repository.js'
import { syncScriptMasterLibrary } from './librarySync.js'
afterEach(() => vi.unstubAllGlobals())
const principal: Principal = { userId: 'fixture-user', tenantId: 'fixture-tenant', roles: ['member'] }
const config = {
  SCRIPT_MASTER_URL: 'https://script.fixture',
  SCRIPT_MASTER_INTERNAL_URL: 'http://script-master-web:3000/script-master',
  SCRIPT_MASTER_SHARED_SECRET: 'fixture-signing-secret',
} as AppConfig

describe('Script Master catalog bridge', () => {
  it('uses scoped auth, imports paginated scripts once, and keeps accounts separate', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new AssetLibraryRepository(store)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        expect(new URL(url).origin).toBe(new URL(config.SCRIPT_MASTER_INTERNAL_URL).origin)
        expect(new URL(url).pathname).toBe('/script-master/api/library')
        const token = options.headers.Authorization.slice(7)
        const claims = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
        expect(claims).toMatchObject({
          tenantId: principal.tenantId,
          actorId: principal.userId,
          projectId: null,
        })
        const second = new URL(url).searchParams.get('offset') === '1'
        return Response.json({
          documents: [
            {
              projectId: 'source-project',
              projectName: '归来',
              title: second ? '第二集' : '第一集',
              content: second ? '林晚走进诊所。' : '林晚回到故乡。',
              createdAt: '2026-09-16T00:00:00Z',
            },
          ],
          nextOffset: second ? null : 1,
        })
      }),
    )
    await syncScriptMasterLibrary(config, repository, principal)
    await syncScriptMasterLibrary(config, repository, principal)
    const result = await repository.list({ deleted: 'active', page: 1, pageSize: 24 }, principal)
    expect(result.total).toBe(2)
    expect(
      result.items.every((item) => item.tags.includes('剧本大师') && item.sourceProjectId === null),
    ).toBe(true)
    expect(
      (
        await repository.list(
          { deleted: 'active', page: 1, pageSize: 24 },
          { ...principal, userId: 'another-user' },
        )
      ).total,
    ).toBe(0)
  })
  it('does not store unauthenticated responses', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const repository = new AssetLibraryRepository(store)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    )
    await expect(syncScriptMasterLibrary(config, repository, principal)).rejects.toMatchObject({
      code: 'SCRIPT_MASTER_LIBRARY_UNAVAILABLE',
    })
    expect((await repository.list({ deleted: 'active', page: 1, pageSize: 24 }, principal)).total).toBe(0)
  })
})
