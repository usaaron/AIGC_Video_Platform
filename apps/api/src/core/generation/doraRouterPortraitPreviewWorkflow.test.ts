import type { Principal } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { TrustedAssetService } from '../../modules/trustedAssets/service.js'
import type { PortraitGroupType } from './volcArkAssetLibraryProvider.js'
import { DoraRouterAssetLibraryProvider } from './doraRouterAssetLibraryProvider.js'

const principal: Principal = { userId: 'test-user', tenantId: 'test-tenant', roles: ['creator'] }
const portrait = {
  Id: 'portrait-1',
  GroupId: 'group-1',
  AssetType: 'Image',
  Status: 'Active',
  URL: '/previews/portrait-1.png',
}

async function previewFixture(
  groupType: PortraitGroupType | null,
  deniedGroupLists: PortraitGroupType[] = [],
) {
  const actions: string[] = []
  const download = vi.fn(
    async () => new Response(Buffer.from('synthetic-preview'), { headers: { 'content-type': 'image/png' } }),
  )
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const action = url.searchParams.get('Action')
    if (!action) {
      expect(url.href).toBe('https://provider.example.test/previews/portrait-1.png')
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
      return download()
    }
    actions.push(action)
    const body = JSON.parse(String(init?.body)) as { Filter?: { GroupType: PortraitGroupType } }
    if (action === 'GetAsset') return Response.json({ Result: portrait })
    if (
      action === 'GetAssetGroup' ||
      (action === 'ListAssetGroups' && body.Filter && deniedGroupLists.includes(body.Filter.GroupType))
    ) {
      return Response.json({ code: 'AccessDenied', message: 'Synthetic permission denial' }, { status: 403 })
    }
    if (action === 'ListAssetGroups') {
      const requestedType = body.Filter?.GroupType
      return Response.json({
        Result: {
          Items: [
            {
              Id: requestedType === groupType ? portrait.GroupId : `unrelated-${requestedType}`,
              GroupType: requestedType,
            },
          ],
        },
      })
    }
    if (action === 'ListAssets') return Response.json({ Result: { Items: [portrait] } })
    throw new Error(`Unexpected provider action: ${action}`)
  })
  const provider = new DoraRouterAssetLibraryProvider({
    baseUrl: 'https://provider.example.test',
    apiKey: 'synthetic-test-key',
    projectName: 'test-project',
    requestTimeoutMs: 1_000,
    fetcher,
  })
  const store = new AppStore(null, undefined, false, false)
  await store.initialize()
  const service = new TrustedAssetService(
    store,
    provider,
    {
      put: async () => {},
      get: async () => Buffer.alloc(0),
      delete: async () => {},
    },
    'synthetic-secret-with-at-least-32-characters',
    'https://studio.example.test',
    'test-project',
  )
  return { service, actions, download }
}

describe('DoraRouter portrait preview authorization', () => {
  it('previews an unbound authorized portrait using verified group lists when group details return 403', async () => {
    const { service, actions, download } = await previewFixture('LivenessFace')

    await expect(service.listPortraits('LivenessFace', principal)).resolves.toMatchObject([
      { assetId: portrait.Id, groupType: 'LivenessFace' },
    ])
    await expect(service.preview(portrait.Id, principal)).resolves.toEqual({
      content: Buffer.from('synthetic-preview'),
      contentType: 'image/png',
    })
    expect(actions).toEqual([
      'ListAssetGroups',
      'ListAssets',
      'GetAsset',
      'GetAssetGroup',
      'ListAssetGroups',
      'ListAssetGroups',
      'GetAsset',
    ])
    expect(download).toHaveBeenCalledOnce()
  })

  it.each(['AIGC', null] as const)(
    'does not preview an unbound portrait whose verified group type is %s',
    async (groupType) => {
      const { service, download } = await previewFixture(groupType)

      await expect(service.preview(portrait.Id, principal)).rejects.toMatchObject({
        statusCode: 404,
        code: 'TRUSTED_PORTRAIT_NOT_FOUND',
      })
      expect(download).not.toHaveBeenCalled()
    },
  )

  it('verifies an authorized portrait even when only its own group list is accessible', async () => {
    const { service, download } = await previewFixture('LivenessFace', ['AIGC'])

    await expect(service.preview(portrait.Id, principal)).resolves.toMatchObject({
      contentType: 'image/png',
    })
    expect(download).toHaveBeenCalledOnce()
  })

  it('does not preview an unbound portrait when group ownership cannot be verified', async () => {
    const { service, download } = await previewFixture('LivenessFace', ['AIGC', 'LivenessFace'])

    await expect(service.preview(portrait.Id, principal)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TRUSTED_PORTRAIT_NOT_FOUND',
    })
    expect(download).not.toHaveBeenCalled()
  })
})
