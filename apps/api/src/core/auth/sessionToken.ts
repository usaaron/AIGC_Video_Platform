import { createHmac, timingSafeEqual } from 'node:crypto'

type SessionPayload = {
  userId: string
  expiresAt: number
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function createSessionToken(
  userId: string,
  secret: string,
  lifetimeSeconds = 60 * 60 * 24 * 7,
): string {
  const payload: SessionPayload = { userId, expiresAt: Math.floor(Date.now() / 1_000) + lifetimeSeconds }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(encoded, secret)}`
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const [encoded, providedSignature] = token.split('.')
  if (!encoded || !providedSignature) return null

  const expectedSignature = signature(encoded, secret)
  const expected = Buffer.from(expectedSignature)
  const provided = Buffer.from(providedSignature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload
    if (!payload.userId || payload.expiresAt <= Math.floor(Date.now() / 1_000)) return null
    return payload
  } catch {
    return null
  }
}
