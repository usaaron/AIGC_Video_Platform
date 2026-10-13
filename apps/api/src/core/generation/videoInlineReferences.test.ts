import { describe, expect, it, vi } from 'vitest'
import { boundedInlineVideoBody, VIDEO_INLINE_BODY_BUDGET } from './videoInlineReferences.js'
import { DoraRouterSeedanceProvider } from './doraRouterSeedanceProvider.js'

const large = (marker: string) => `data:image/png;base64,${marker.repeat(700_000)}`

describe('bounded inline video transport', () => {
  it('keeps small requests byte-for-byte unchanged', async () => {
    const images = [{ url: 'data:image/png;base64,YQ==', role: 'first_frame' }]
    const encode = vi.fn()
    expect(await boundedInlineVideoBody(images, JSON.stringify, encode)).toBe(JSON.stringify(images))
    expect(encode).not.toHaveBeenCalled()
  })

  it('preserves slot order, roles, remote addresses and source data under a UTF-8 budget', async () => {
    const images = [
      { url: large('A'), role: 'first_frame' },
      { url: 'https://assets.example/scene.png', role: 'reference_image' },
      { url: large('B'), role: 'reference_image' },
      { url: 'data:image/png;base64,YQ==', role: 'reference_image' },
    ]
    const original = structuredClone(images)
    const encode = vi.fn(async (source: string, maxBytes: number) => {
      expect(maxBytes).toBeGreaterThan(32_000)
      return `data:image/jpeg;base64,${Buffer.alloc(maxBytes, source.endsWith('A') ? 1 : 2).toString('base64')}`
    })
    const body = await boundedInlineVideoBody(images, (refs) => JSON.stringify({ prompt: '人物前行'.repeat(1000), refs }), encode)
    const result = JSON.parse(body)
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(VIDEO_INLINE_BODY_BUDGET)
    expect(result.refs.map((ref: { role: string }) => ref.role)).toEqual(images.map((ref) => ref.role))
    expect(result.refs[1]).toEqual(images[1])
    expect(result.refs[3]).toEqual(images[3])
    expect(encode.mock.calls.map(([source]) => source)).toEqual([images[0].url, images[2].url])
    expect(images).toEqual(original)
  })

  it('rejects unshrinkable text before encoding and rejects an oversized encoder result', async () => {
    const encode = vi.fn(async (source: string) => source)
    await expect(boundedInlineVideoBody([{ url: large('A') }], (refs) => JSON.stringify({ prompt: '中'.repeat(300_000), refs }), encode)).rejects.toThrow('文字或参考地址过长')
    expect(encode).not.toHaveBeenCalled()
    await expect(boundedInlineVideoBody([{ url: large('A') }, { url: large('B') }], JSON.stringify, encode)).rejects.toThrow('仍超过传输体积限制')
  })

  it('submits one compact provider request without changing prompt bindings or idempotency', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body)
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(VIDEO_INLINE_BODY_BUDGET)
      const parsed = JSON.parse(body)
      expect(parsed.content).toHaveLength(3)
      expect(parsed.content[0].text).toBe('图片1承接，图片2人物')
      expect(parsed.content.slice(1).map((item: { image_url: { url: string } }) => item.image_url.url)).toEqual(['data:image/jpeg;base64,QQ==', 'data:image/jpeg;base64,Qg=='])
      expect(init?.headers).toMatchObject({ 'Idempotency-Key': 'same-request' })
      return Response.json({ id: 'real-task' })
    })
    const provider = new DoraRouterSeedanceProvider({
      baseUrl: 'https://example.test', apiKey: 'test', defaultModel: 'test', requestTimeoutMs: 1000,
      fetcher: fetcher as typeof fetch,
      inlineReferenceEncoder: async (source) => `data:image/jpeg;base64,${source.endsWith('A') ? 'QQ==' : 'Qg=='}`,
    })
    await provider.submit({ taskId: 'task', idempotencyKey: 'same-request', model: 'test', prompt: '图片1承接，图片2人物', seconds: 4, ratio: '16:9', resolution: '720p', generateAudio: true, images: [large('A'), large('B')] })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('never contacts the provider when reference preparation fails', async () => {
    const fetcher = vi.fn()
    const provider = new DoraRouterSeedanceProvider({
      baseUrl: 'https://example.test', apiKey: 'test', defaultModel: 'test', requestTimeoutMs: 1000,
      fetcher,
      inlineReferenceEncoder: async () => { throw new Error('invalid reference') },
    })
    await expect(provider.submit({ taskId: 'task', model: 'test', prompt: 'a shot', seconds: 4, ratio: '16:9', resolution: '720p', generateAudio: true, images: [large('A'), large('B')] })).rejects.toThrow('invalid reference')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
