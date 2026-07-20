import { createHmac, timingSafeEqual } from 'node:crypto'

const MEDIA_SIGNATURE_PREFIX = 'seqora-media-v1'

export function createSignedMediaUrl(
  baseUrl: string,
  mediaId: string,
  secret: string,
  ttlSeconds: number,
): string {
  if (!baseUrl) throw new Error('API_PUBLIC_BASE_URL is required to sign media URLs')
  const expires = Math.floor(Date.now() / 1_000) + ttlSeconds
  const signature = signMediaAccess(mediaId, expires, secret)
  const url = new URL(`/api/v1/media/${mediaId}/signed`, baseUrl)
  url.searchParams.set('expires', String(expires))
  url.searchParams.set('signature', signature)
  return url.toString()
}

export function verifySignedMediaAccess(
  mediaId: string,
  expires: number,
  signature: string,
  secret: string,
): boolean {
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1_000)) return false
  const expected = signMediaAccess(mediaId, expires, secret)
  return safeEqual(signature, expected)
}

function signMediaAccess(mediaId: string, expires: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${MEDIA_SIGNATURE_PREFIX}:${mediaId}:${expires}`)
    .digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
