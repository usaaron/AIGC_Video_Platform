import { describe, expect, it } from 'vitest'
import {
  createPublicMediaToken,
  createPublicMediaUrlSigner,
  verifyPublicMediaToken,
} from './publicMediaToken.js'

describe('public media token', () => {
  it('uses the same expiring source URL signer for inline and standalone workers', () => {
    expect(createPublicMediaUrlSigner('test-secret', '')).toBeNull()
    const sign = createPublicMediaUrlSigner('test-secret', 'https://app.example/')!
    const now = Date.now()
    const url = sign({ storageKey: 'tenant/project/face.png', contentType: 'image/png' })
    expect(url).toMatch(/^https:\/\/app.example\/api\/v1\/trusted-assets\/source\//)
    const token = url.split('/').at(-1)!
    const payload = verifyPublicMediaToken(token, 'test-secret')!
    expect(payload.storageKey).toBe('tenant/project/face.png')
    expect(payload.expiresAt).toBeGreaterThanOrEqual(now + 24 * 60 * 60_000)
    expect(verifyPublicMediaToken(token, 'test-secret', payload.expiresAt)).toBeNull()
  })
  it('round-trips a bounded source token and rejects tampering or expiry', () => {
    const secret = 'test-secret-with-at-least-32-characters'
    const token = createPublicMediaToken(
      { storageKey: 'tenant/project/generated/face.png', contentType: 'image/png' },
      secret,
      2_000,
    )

    expect(verifyPublicMediaToken(token, secret, 1_000)).toEqual({
      storageKey: 'tenant/project/generated/face.png',
      contentType: 'image/png',
      expiresAt: 2_000,
    })
    expect(verifyPublicMediaToken(`${token}x`, secret, 1_000)).toBeNull()
    expect(verifyPublicMediaToken(token, secret, 2_000)).toBeNull()
  })
})
