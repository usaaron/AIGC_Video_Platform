import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './apiClient'

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('sends login requests with cookie credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ account: { id: 'user-1' }, permissions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api.login({ email: 'creator@seqora.local', password: 'Creator123!' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('surfaces API error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(api.login({ email: 'bad@example.com', password: 'wrong-password' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: '邮箱或密码错误',
    })
  })
})
