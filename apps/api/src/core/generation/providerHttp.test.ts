import { describe, expect, it, vi } from 'vitest'
import { fetchWithProviderTimeout } from './providerHttp.js'

describe('fetchWithProviderTimeout', () => {
  it('maps abort errors to provider timeout errors', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('signal timed out', 'TimeoutError')
    }) as unknown as typeof fetch

    await expect(
      fetchWithProviderTimeout('Aideos Img2', fetcher, 'https://provider.example/tasks', {}, 5_000),
    ).rejects.toThrow('Aideos Img2 request timed out after 5000ms')
  })
})
