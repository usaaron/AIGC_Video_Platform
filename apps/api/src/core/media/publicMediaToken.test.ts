import { describe, expect, it } from 'vitest'
import { createPublicMediaToken, verifyPublicMediaToken } from './publicMediaToken.js'

describe('public media token', () => {
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
