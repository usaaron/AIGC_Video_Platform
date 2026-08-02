import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionToken,
  hashSessionSecret,
  issueSessionToken,
  parseIssuedSessionToken,
  verifySessionToken,
} from './sessionToken.js'

describe('session token', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips legacy session tokens and rejects tampering, invalid payloads, and expiry', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const secret = 'legacy-secret-with-at-least-thirty-two-characters'
    const token = createSessionToken('user-1', secret, 60)

    expect(verifySessionToken(token, secret)).toEqual({
      userId: 'user-1',
      expiresAt: 1_060,
    })
    expect(verifySessionToken(`${token}x`, secret)).toBeNull()
    expect(verifySessionToken(token, 'wrong-secret-with-at-least-thirty-two-characters')).toBeNull()
    expect(verifySessionToken(invalidSignedToken(secret, '{'), secret)).toBeNull()

    now.mockReturnValue(1_061_000)
    expect(verifySessionToken(token, secret)).toBeNull()
  })

  it('issues and parses structured session tokens', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
    const secret = 'structured-secret-with-at-least-thirty-two-characters'
    const issued = issueSessionToken(secret, 120)

    expect(issued.payload).toMatchObject({
      sessionId: expect.any(String),
      tokenSecret: expect.any(String),
      expiresAt: 2_120,
    })
    expect(parseIssuedSessionToken(issued.token, secret)).toEqual(issued.payload)
    expect(parseIssuedSessionToken(`${issued.token}x`, secret)).toBeNull()
    expect(parseIssuedSessionToken(issued.token, 'wrong-secret-with-at-least-thirty-two-characters')).toBeNull()
    expect(parseIssuedSessionToken(invalidSignedToken(secret, '{'), secret)).toBeNull()

    now.mockReturnValue(2_121_000)
    expect(parseIssuedSessionToken(issued.token, secret)).toBeNull()
  })

  it('hashes session secrets deterministically', () => {
    expect(hashSessionSecret('session-secret')).toBe(hashSessionSecret('session-secret'))
    expect(hashSessionSecret('session-secret')).not.toBe(hashSessionSecret('other-secret'))
  })
})

function invalidSignedToken(secret: string, rawPayload: string): string {
  const encoded = Buffer.from(rawPayload).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}
