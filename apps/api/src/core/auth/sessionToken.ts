import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

type LegacySessionPayload = {
  userId: string
  expiresAt: number
}

export type IssuedSessionPayload = {
  sessionId: string
  tokenSecret: string
  expiresAt: number
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodePayload<T>(encoded: string): T | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

export function createSessionToken(
  userId: string,
  secret: string,
  lifetimeSeconds = 60 * 60 * 24 * 7,
): string {
  const payload: LegacySessionPayload = {
    userId,
    expiresAt: Math.floor(Date.now() / 1_000) + lifetimeSeconds,
  }
  const encoded = encodePayload(payload)
  return `${encoded}.${signature(encoded, secret)}`
}

export function verifySessionToken(token: string, secret: string): LegacySessionPayload | null {
  const [encoded, providedSignature] = token.split('.')
  if (!encoded || !providedSignature) return null

  const expectedSignature = signature(encoded, secret)
  const expected = Buffer.from(expectedSignature)
  const provided = Buffer.from(providedSignature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null

  const payload = decodePayload<LegacySessionPayload>(encoded)
  if (!payload || !payload.userId || payload.expiresAt <= Math.floor(Date.now() / 1_000)) return null
  return payload
}

export function issueSessionToken(
  secret: string,
  lifetimeSeconds = 60 * 60 * 24 * 7,
): {
  token: string
  payload: IssuedSessionPayload
} {
  const payload: IssuedSessionPayload = {
    sessionId: randomUUID(),
    tokenSecret: randomBytes(32).toString('base64url'),
    expiresAt: Math.floor(Date.now() / 1_000) + lifetimeSeconds,
  }
  const encoded = encodePayload(payload)
  return {
    token: `${encoded}.${signature(encoded, secret)}`,
    payload,
  }
}

export function parseIssuedSessionToken(token: string, secret: string): IssuedSessionPayload | null {
  const [encoded, providedSignature] = token.split('.')
  if (!encoded || !providedSignature) return null

  const expectedSignature = signature(encoded, secret)
  const expected = Buffer.from(expectedSignature)
  const provided = Buffer.from(providedSignature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null

  const payload = decodePayload<IssuedSessionPayload>(encoded)
  if (
    !payload ||
    !payload.sessionId ||
    !payload.tokenSecret ||
    payload.expiresAt <= Math.floor(Date.now() / 1_000)
  ) {
    return null
  }
  return payload
}

export function hashSessionSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}
