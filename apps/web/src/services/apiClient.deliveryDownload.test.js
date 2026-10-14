import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, AUTH_EXPIRED_EVENT } from './apiClient'

const input = {
  expectedUpdatedAt: '2026-10-14T00:00:00.000Z',
  contractHash: 'a'.repeat(64),
  clientRequestId: 'download-1',
}
const receiptId = '93ff0e41-08d8-45f2-900e-e9f74c592a84'
const headers = {
  'Content-Type': 'video/mp4',
  'Content-Disposition': 'attachment; filename="delivery.mp4"',
  'X-Delivery-Receipt-Id': receiptId,
  'X-Delivery-Sha256': 'b'.repeat(64),
}
afterEach(() => vi.unstubAllGlobals())

describe('delivery download API', () => {
  it('uses authenticated JSON POST with the verified snapshot and reads the binary receipt', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('verified-video', { headers }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    const result = await api.downloadDelivery('task/id', input, { signal })
    expect(fetch).toHaveBeenCalledWith('/api/v1/generation/tasks/task%2Fid/delivery-download', {
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify(input),
      signal,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(result).toMatchObject({ filename: 'delivery.mp4', receiptId, sha256: 'b'.repeat(64) })
    expect(await result.blob.text()).toBe('verified-video')
  })

  it('sanitizes attachment names and decodes UTF-8 names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('image', {
          headers: {
            ...headers,
            'Content-Type': 'image/png',
            'Content-Disposition': "attachment; filename*=UTF-8''%E6%AD%A3%E5%BC%8F%2Fimage.png",
          },
        }),
      ),
    )
    expect((await api.downloadDelivery('task-1', input)).filename).toBe('正式_image.png')
  })

  it('propagates stale and blocked API errors without treating JSON as downloadable media', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'DELIVERY_DOWNLOAD_STALE', message: '任务已变化' } },
            { status: 409 },
          ),
        ),
    )
    await expect(api.downloadDelivery('task-1', input)).rejects.toMatchObject({
      status: 409,
      code: 'DELIVERY_DOWNLOAD_STALE',
      message: '任务已变化',
    })
  })

  it('preserves session-expiration handling for download failures', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: 'SESSION_INVALID', message: '会话已失效' } }, { status: 401 }),
        ),
    )
    await expect(api.downloadDelivery('task-1', input)).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_INVALID',
    })
    expect(dispatchEvent.mock.calls[0][0].type).toBe(AUTH_EXPIRED_EVENT)
  })

  it.each([
    { 'X-Delivery-Receipt-Id': '' },
    { 'X-Delivery-Sha256': 'invalid' },
    { 'Content-Disposition': 'inline' },
    { 'Content-Type': 'application/json' },
  ])('rejects an incomplete or invalid download response: %j', async (override) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('media', { headers: { ...headers, ...override } })),
    )
    await expect(api.downloadDelivery('task-1', input)).rejects.toThrow('未返回完整的正式下载凭证')
  })

  it('rejects an empty attachment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { headers })))
    await expect(api.downloadDelivery('task-1', input)).rejects.toThrow('下载文件为空')
  })
})
