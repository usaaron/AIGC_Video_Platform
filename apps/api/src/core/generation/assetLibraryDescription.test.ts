import { describe, expect, it } from 'vitest'
import { DoraRouterAssetLibraryProvider } from './doraRouterAssetLibraryProvider.js'
import { VolcArkAssetLibraryProvider } from './volcArkAssetLibraryProvider.js'

describe.each([DoraRouterAssetLibraryProvider, VolcArkAssetLibraryProvider])(
  '%s material group description',
  (Provider) => {
    it.each([
      ['', ''],
      ['林晚，标准版，黑色长发，白色衬衫。', '林晚，标准版，黑色长发，白色衬衫。'],
      ['人'.repeat(300), '人'.repeat(300)],
      ['人'.repeat(301), '人'.repeat(300)],
      ['林晚的角色描述'.repeat(100), '林晚的角色描述'.repeat(100).slice(0, 300)],
      ['人'.repeat(299) + '🎬后续描述', '人'.repeat(299) + '🎬'],
    ])('submits a valid description (case %#)', async (description, expected) => {
      let submitted: Record<string, unknown> = {}
      const provider = new Provider({
        baseUrl: 'https://material.example.com',
        apiKey: 'test-key',
        accessKey: 'test-ak',
        secretKey: 'test-sk',
        projectName: 'default',
        requestTimeoutMs: 1_000,
        fetcher: async (input, init) => {
          expect(new URL(String(input)).searchParams.get('Action')).toBe('CreateAssetGroup')
          submitted = JSON.parse(String(init?.body)) as Record<string, unknown>
          if (Array.from(String(submitted.Description)).length > 300) {
            return Response.json(
              { ResponseMetadata: { Error: { Message: 'Description exceeds 300 characters' } } },
              { status: 400 },
            )
          }
          return Response.json({ ResponseMetadata: {}, Result: { Id: 'group-test' } })
        },
      })

      await expect(provider.createVirtualGroup('林晚-标准版', description)).resolves.toBe('group-test')
      expect(submitted).toMatchObject({ Name: '林晚-标准版', Description: expected })
    })
  },
)
