import { describe, expect, it, vi } from 'vitest'
import { DoraRouterAssetLibraryProvider } from './doraRouterAssetLibraryProvider.js'

describe('DoraRouterAssetLibraryProvider', () => {
  it('uses the DoraRouter bearer token for trusted portrait lifecycle calls', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/v1/material')) {
        return new Response(Buffer.from('preview'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const action = new URL(url).searchParams.get('Action')
      requests.push({
        url,
        body,
        authorization: String(new Headers(init?.headers).get('Authorization')),
      })
      if (action === 'CreateAssetGroup') return Response.json({ Result: { Id: 'group-aigc-1' } })
      if (action === 'CreateAsset') return Response.json({ Result: { Id: 'asset-aigc-1' } })
      if (action === 'CreateVisualValidateSession') {
        return Response.json({
          Result: {
            BytedToken: 'server-only-token',
            H5Link: 'https://www.dorarouter.com/material/h5/session-1',
            QrCode: 'data:image/png;base64,qr',
          },
        })
      }
      if (action === 'GetVisualValidateResult') {
        return Response.json({ Result: { GroupId: 'group-live-1' } })
      }
      if (action === 'GetAsset') {
        return Response.json({
          Result: {
            Id: 'asset-aigc-1',
            GroupId: 'group-aigc-1',
            Name: '林晚-面部基准',
            AssetType: 'Image',
            Status: 'Active',
            URL: 'https://cdn.example.com/portrait.png',
          },
        })
      }
      if (action === 'GetAssetGroup') {
        return Response.json({ Result: { Id: 'group-aigc-1', Name: '林晚' } })
      }
      if (action === 'ListAssetGroups') {
        const filter = body.Filter as { GroupType?: string }
        return Response.json({
          Result: {
            Items: [{ Id: 'group-aigc-1', Name: '林晚', GroupType: filter.GroupType }],
          },
        })
      }
      if (action === 'ListAssets') {
        return Response.json({
          Result: {
            Items: [
              {
                Id: 'asset-aigc-1',
                GroupId: 'group-aigc-1',
                Name: '林晚-面部基准',
                AssetType: 'Image',
                Status: 'Active',
                URL: 'https://cdn.example.com/portrait.png',
              },
            ],
          },
        })
      }
      throw new Error(`unexpected action: ${action}`)
    })

    const provider = new DoraRouterAssetLibraryProvider({
      baseUrl: 'https://www.dorarouter.com/',
      apiKey: 'test-dora-token',
      projectName: 'default',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await expect(provider.createVirtualGroup('林晚', '末日人物')).resolves.toBe('group-aigc-1')
    await expect(
      provider.createVirtualAsset('group-aigc-1', '林晚-面部基准', 'https://api.example.com/source/token'),
    ).resolves.toMatchObject({
      assetId: 'asset-aigc-1',
      groupType: 'AIGC',
      status: 'processing',
    })
    await expect(provider.getPortrait('asset-aigc-1')).resolves.toMatchObject({
      assetId: 'asset-aigc-1',
      groupType: 'AIGC',
      status: 'active',
    })
    await expect(provider.listAuthorizedPortraits()).resolves.toHaveLength(1)
    await expect(provider.listPortraits('AIGC')).resolves.toHaveLength(1)
    await expect(provider.getPortraitPreview('asset-aigc-1')).resolves.toMatchObject({
      content: Buffer.from('preview'),
      contentType: 'image/png',
    })
    await expect(provider.createVisualValidateSession()).resolves.toEqual({
      providerToken: 'server-only-token',
      h5Link: 'https://www.dorarouter.com/material/h5/session-1',
      qrCode: 'data:image/png;base64,qr',
    })
    await expect(provider.getVisualValidateResult('server-only-token')).resolves.toEqual({
      groupId: 'group-live-1',
    })
    await expect(
      provider.createAuthorizedAsset(
        'group-live-1',
        '林晚-真人面部基准',
        'https://api.example.com/source/live',
      ),
    ).resolves.toMatchObject({ groupId: 'group-live-1', groupType: 'LivenessFace' })

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.authorization === 'Bearer test-dora-token')).toBe(true)
    expect(requests[0]?.url).toBe(
      'https://www.dorarouter.com/v1/material?Action=CreateAssetGroup&Version=2024-01-01',
    )
    expect(requests[0]?.body).toEqual({ Name: '林晚', Description: '末日人物' })
    expect(requests[1]?.body).toEqual({
      GroupId: 'group-aigc-1',
      URL: 'https://api.example.com/source/token',
      AssetType: 'Image',
      Name: '林晚-面部基准',
    })
    expect(requests.find((request) => request.url.includes('CreateVisualValidateSession'))?.body).toEqual({})
    expect(requests.find((request) => request.url.includes('GetVisualValidateResult'))?.body).toEqual({
      BytedToken: 'server-only-token',
    })
    expect(
      requests.find(
        (request) => request.url.includes('CreateAsset') && request.body.GroupId === 'group-live-1',
      )?.body,
    ).toEqual({
      GroupId: 'group-live-1',
      URL: 'https://api.example.com/source/live',
      AssetType: 'Image',
      Name: '林晚-真人面部基准',
    })
  })

  it('retries a transient material gateway response once', async () => {
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls += 1
      if (calls === 1) return new Response('busy', { status: 503 })
      return Response.json({ Result: { Id: 'group-after-retry' } })
    })
    const provider = new DoraRouterAssetLibraryProvider({
      baseUrl: 'https://www.dorarouter.com',
      apiKey: 'test-dora-token',
      projectName: 'default',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await expect(provider.createVirtualGroup('重试组', '测试')).resolves.toBe('group-after-retry')
    expect(calls).toBe(2)
  })
})
