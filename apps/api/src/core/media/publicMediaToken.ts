import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const payloadSchema = z.object({
  storageKey: z.string().min(1).max(1_000),
  contentType: z.string().min(1).max(120),
  expiresAt: z.number().int().positive(),
})

export type PublicMediaPayload = z.infer<typeof payloadSchema>

export function createPublicMediaToken(
  input: Omit<PublicMediaPayload, 'expiresAt'>,
  secret: string,
  expiresAt: number,
): string {
  const encoded = Buffer.from(JSON.stringify({ ...input, expiresAt })).toString('base64url')
  return `${encoded}.${signature(encoded, secret)}`
}

export function verifyPublicMediaToken(
  token: string,
  secret: string,
  now = Date.now(),
): PublicMediaPayload | null {
  const [encoded, suppliedSignature, extra] = token.split('.')
  if (!encoded || !suppliedSignature || extra) return null
  const expectedSignature = signature(encoded, secret)
  const supplied = Buffer.from(suppliedSignature)
  const expected = Buffer.from(expectedSignature)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  try {
    const payload = payloadSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
    return payload.expiresAt > now ? payload : null
  } catch {
    return null
  }
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}
