import { describe, expect, it } from 'vitest'
import { VolcArkAssetLibraryProvider } from './volcArkAssetLibraryProvider.js'

describe('VolcArkAssetLibraryProvider', () => {
  it('signs GetAsset with the documented Volcengine SigV4 algorithm', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!capturedUrl) {
        capturedUrl = String(input)
        capturedInit = init
      }
      return Response.json({
        ResponseMetadata: { RequestId: 'request-1' },
        Result: {
          Id: 'asset-live-1',
          GroupId: 'group-live-1',
          Name: '演员 A',
          AssetType: 'Image',
          Status: 'Active',
          URL: 'https://assets.example/portrait.jpg',
        },
      })
    }) as typeof fetch
    const provider = createProvider(fetcher)

    await expect(provider.getPortrait('asset-live-1')).rejects.toThrow()
    expect(capturedUrl).toBe('https://maas-ark.stringx.top/?Action=GetAsset&Version=2024-01-01')
    expect(capturedInit?.headers).toMatchObject({
      'X-Date': '20260719T123456Z',
      'X-Content-Sha256': '11273014103ce99e0ef854d73a93c06de7bc2d880d5b2115f29dbb33a89b8297',
      Authorization:
        'HMAC-SHA256 Credential=test-ak/20260719/cn-beijing/ark/request, SignedHeaders=x-content-sha256;x-date, Signature=903def247b98ba131bc4d6dacb2c59ac81435f65a7fe50331b24809140ced2a5',
    })
  })

  it('verifies the group type and maps an authorized portrait', async () => {
    const responses = [
      {
        ResponseMetadata: { RequestId: 'request-1' },
        Result: {
          Id: 'asset-live-1',
          GroupId: 'group-live-1',
          Name: '演员 A',
          AssetType: 'Image',
          Status: 'Active',
          URL: 'https://assets.example/portrait.jpg',
        },
      },
      {
        ResponseMetadata: { RequestId: 'request-2' },
        Result: { Id: 'group-live-1', Name: '演员 A', GroupType: 'LivenessFace' },
      },
    ]
    const fetcher = (async () => Response.json(responses.shift())) as typeof fetch

    await expect(createProvider(fetcher).getPortrait('asset-live-1')).resolves.toEqual({
      assetId: 'asset-live-1',
      groupId: 'group-live-1',
      groupType: 'LivenessFace',
      name: '演员 A',
      assetType: 'Image',
      status: 'active',
      previewUrl: 'https://assets.example/portrait.jpg',
      errorCode: null,
      errorMessage: null,
    })
  })

  it('downloads an active portrait preview through the provider', async () => {
    const requests: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('Action=GetAsset&')) {
        return Response.json({
          ResponseMetadata: { RequestId: 'request-1' },
          Result: {
            Id: 'asset-live-1',
            GroupId: 'group-live-1',
            Name: '演员 A',
            AssetType: 'Image',
            Status: 'Active',
            URL: 'https://assets.example/portrait.jpg',
          },
        })
      }
      if (url.includes('Action=GetAssetGroup&')) {
        return Response.json({
          ResponseMetadata: { RequestId: 'request-2' },
          Result: { Id: 'group-live-1', Name: '演员 A', GroupType: 'LivenessFace' },
        })
      }
      return new Response(Buffer.from('portrait-preview'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }) as typeof fetch

    await expect(createProvider(fetcher).getPortraitPreview('asset-live-1')).resolves.toEqual({
      content: Buffer.from('portrait-preview'),
      contentType: 'image/png',
    })
    expect(requests).toEqual([
      'https://maas-ark.stringx.top/?Action=GetAsset&Version=2024-01-01',
      'https://maas-ark.stringx.top/?Action=GetAssetGroup&Version=2024-01-01',
      'https://assets.example/portrait.jpg',
    ])
  })

  it('maps an upstream validation failure with actionable details', async () => {
    const responses = [
      {
        ResponseMetadata: { RequestId: 'request-1' },
        Result: {
          Id: 'asset-aigc-failed',
          GroupId: 'group-aigc-1',
          Name: 'Virtual character',
          AssetType: 'Image',
          Status: 'Failed',
          Error: { Code: 'FACE_NOT_CLEAR', Message: 'Face is not clear enough' },
        },
      },
      {
        ResponseMetadata: { RequestId: 'request-2' },
        Result: { Id: 'group-aigc-1', Name: 'Virtual character', GroupType: 'AIGC' },
      },
    ]
    const fetcher = (async () => Response.json(responses.shift())) as typeof fetch

    await expect(createProvider(fetcher).getPortrait('asset-aigc-failed')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'FACE_NOT_CLEAR',
      errorMessage: 'Face is not clear enough',
    })
  })

  it('retries a transient material library network failure once', async () => {
    let calls = 0
    const fetcher = (async (input: RequestInfo | URL) => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      const url = String(input)
      if (url.includes('Action=GetAsset&')) {
        return Response.json({
          ResponseMetadata: { RequestId: 'request-1' },
          Result: {
            Id: 'asset-aigc-1',
            GroupId: 'group-aigc-1',
            Name: '角色甲',
            AssetType: 'Image',
            Status: 'Processing',
            URL: '',
          },
        })
      }
      return Response.json({
        ResponseMetadata: { RequestId: 'request-2' },
        Result: { Id: 'group-aigc-1', Name: '角色甲', GroupType: 'AIGC' },
      })
    }) as typeof fetch

    await expect(createProvider(fetcher).getPortrait('asset-aigc-1')).resolves.toMatchObject({
      assetId: 'asset-aigc-1',
      status: 'processing',
    })
    expect(calls).toBe(3)
  })

  it('creates an asynchronous AIGC image resource', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const responses = [
      { ResponseMetadata: { RequestId: 'request-1' }, Result: { Id: 'group-aigc-1' } },
      { ResponseMetadata: { RequestId: 'request-2' }, Result: { Id: 'asset-aigc-1' } },
    ]
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return Response.json(responses.shift())
    }) as typeof fetch
    const provider = createProvider(fetcher)

    const groupId = await provider.createVirtualGroup('角色甲', '主角')
    const portrait = await provider.createVirtualAsset(
      groupId,
      '角色甲-面部基准',
      'https://api.example.com/source/token',
    )

    expect(requests[0]).toMatchObject({
      url: 'https://maas-ark.stringx.top/?Action=CreateAssetGroup&Version=2024-01-01',
      body: { GroupType: 'AIGC', ProjectName: 'default' },
    })
    expect(requests[1]).toMatchObject({
      url: 'https://maas-ark.stringx.top/?Action=CreateAsset&Version=2024-01-01',
      body: {
        GroupId: 'group-aigc-1',
        AssetType: 'Image',
        URL: 'https://api.example.com/source/token',
      },
    })
    expect(portrait).toMatchObject({
      assetId: 'asset-aigc-1',
      groupId: 'group-aigc-1',
      groupType: 'AIGC',
      status: 'processing',
    })
  })

  it('lists whitelist portraits through groups before querying assets', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const responses = [
      {
        ResponseMetadata: { RequestId: 'request-groups' },
        Result: {
          Items: [{ Id: 'group-live-1', Name: '演员白名单', GroupType: 'LivenessFace' }],
          TotalCount: 1,
        },
      },
      {
        ResponseMetadata: { RequestId: 'request-assets' },
        Result: {
          Items: [
            {
              Id: 'asset-live-1',
              GroupId: 'group-live-1',
              Name: '演员 A',
              AssetType: 'Image',
              Status: 'Active',
              URL: 'https://assets.example/portrait.jpg',
            },
          ],
          TotalCount: 1,
        },
      },
    ]
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return Response.json(responses.shift())
    }) as typeof fetch

    await expect(createProvider(fetcher).listPortraits('LivenessFace')).resolves.toMatchObject([
      { assetId: 'asset-live-1', groupId: 'group-live-1', groupType: 'LivenessFace', status: 'active' },
    ])
    expect(requests).toMatchObject([
      {
        url: 'https://maas-ark.stringx.top/?Action=ListAssetGroups&Version=2024-01-01',
        body: { Filter: { GroupType: 'LivenessFace' }, ProjectName: 'default' },
      },
      {
        url: 'https://maas-ark.stringx.top/?Action=ListAssets&Version=2024-01-01',
        body: {
          Filter: { GroupIds: ['group-live-1'], Statuses: ['Active', 'Processing', 'Failed'] },
          ProjectName: 'default',
        },
      },
    ])
  })
})

function createProvider(fetcher: typeof fetch) {
  return new VolcArkAssetLibraryProvider({
    baseUrl: 'https://maas-ark.stringx.top',
    accessKey: 'test-ak',
    secretKey: 'test-sk',
    projectName: 'default',
    requestTimeoutMs: 30_000,
    fetcher,
    now: () => new Date('2026-07-19T12:34:56.000Z'),
  })
}
