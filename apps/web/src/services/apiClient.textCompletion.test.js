import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, AUTH_EXPIRED_EVENT } from './apiClient'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('text completion read-only API client', () => {
  it('uses an authenticated GET with encoded task ID, no cache, and the caller abort signal', async () => {
    const value = { reason: 'missing-receipt', receipt: null }
    const fetch = vi.fn().mockResolvedValue(Response.json(value))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    expect(await api.textCompletion('task/id ?文本', { signal })).toEqual(value)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/generation/tasks/task%2Fid%20%3F%E6%96%87%E6%9C%AC/text-completion',
      {
        credentials: 'include',
        method: 'GET',
        cache: 'no-store',
        signal,
        headers: {},
      },
    )
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('body')
  })

  it('uses a timeout signal when a caller does not provide one and clears the timer after success', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValue(Response.json({ receipt: null }))
    vi.stubGlobal('fetch', fetch)
    await api.textCompletion('task-1')
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a stalled default request after fifteen seconds', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(
      (_url, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    )
    vi.stubGlobal('fetch', fetch)
    const pending = api.textCompletion('task-1')
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    [401, 'SESSION_INVALID'],
    [401, 'AUTHENTICATION_REQUIRED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [409, 'TEXT_COMPLETION_STALE'],
  ])('propagates %s errors and preserves session expiration for %s', async (status, code) => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { code, message: '来源查询不可用' } }, { status })),
    )
    await expect(api.textCompletion('task-1')).rejects.toMatchObject({
      status,
      code,
      message: '来源查询不可用',
    })
    if (status === 401) expect(dispatchEvent.mock.calls[0][0].type).toBe(AUTH_EXPIRED_EVENT)
    else expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('passes caller cancellation through without converting it to an empty snapshot', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
          ),
      ),
    )
    const pending = api.textCompletion('task-1', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('preserves malformed successful payloads for strict snapshot rejection instead of inventing receipt data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json')))
    expect(await api.textCompletion('task-1')).toBeNull()
  })
})
