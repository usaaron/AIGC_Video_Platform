import type { FastifyRequest } from 'fastify'

export type RequestSessionMetadata = {
  ipAddress: string | null
  userAgent: string | null
  deviceLabel: string | null
}

export function sessionMetadataFromRequest(request: FastifyRequest): RequestSessionMetadata {
  const userAgent = truncate(getHeader(request, 'user-agent'), 512)
  return {
    ipAddress: truncate(request.ip, 128),
    userAgent,
    deviceLabel: deviceLabelFromUserAgent(userAgent),
  }
}

function getHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function deviceLabelFromUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null
  const browser = browserFromUserAgent(userAgent)
  const os = operatingSystemFromUserAgent(userAgent)
  return [browser, os].filter(Boolean).join(' on ') || 'Unknown device'
}

function browserFromUserAgent(userAgent: string): string | null {
  if (/\bEdg\//.test(userAgent)) return 'Edge'
  if (/\bChrome\//.test(userAgent) || /\bCriOS\//.test(userAgent)) return 'Chrome'
  if (/\bFirefox\//.test(userAgent) || /\bFxiOS\//.test(userAgent)) return 'Firefox'
  if (/\bSafari\//.test(userAgent)) return 'Safari'
  return null
}

function operatingSystemFromUserAgent(userAgent: string): string | null {
  if (/Windows NT/i.test(userAgent)) return 'Windows'
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macOS'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return null
}
