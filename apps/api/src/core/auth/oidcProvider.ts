import { createPublicKey, verify as verifySignature } from 'node:crypto'
import type { Principal } from '@seqora/contracts'
import type { FastifyRequest } from 'fastify'
import type { AppConfig } from '../../config.js'
import { AppError } from '../errors.js'
import type { AuthProvider } from './provider.js'
import type { UserReader } from '../../modules/users/repository.js'

type JwtHeader = {
  alg?: string
  kid?: string
  typ?: string
}

type JwtClaims = Record<string, unknown> & {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
}

type JwksCache = {
  expiresAt: number
  keys: OidcJwk[]
}

type DiscoveryCache = {
  expiresAt: number
  jwksUrl: string
}

type OidcJwk = JsonWebKey & {
  kid?: string
}

const DEFAULT_CACHE_MS = 5 * 60_000

export class OidcAuthProvider implements AuthProvider {
  private jwksCache: JwksCache | null = null
  private discoveryCache: DiscoveryCache | null = null

  constructor(
    private readonly config: Pick<
      AppConfig,
      | 'OIDC_ISSUER_URL'
      | 'OIDC_JWKS_URL'
      | 'OIDC_AUDIENCE'
      | 'OIDC_EMAIL_CLAIM'
      | 'OIDC_SUBJECT_CLAIM'
      | 'OIDC_CLOCK_TOLERANCE_SECONDS'
    >,
    private readonly users: UserReader,
  ) {}

  async resolvePrincipal(request: FastifyRequest): Promise<Principal | null> {
    const token = bearerToken(request.headers.authorization)
    if (!token) return null

    const claims = await this.verifyToken(token)
    const user = await this.resolveUser(claims)
    if (!user) {
      throw new AppError(401, 'OIDC_USER_NOT_FOUND', 'OIDC token is valid but no local user matched it')
    }

    return { userId: user.id, tenantId: user.tenantId, roles: user.roles }
  }

  private async resolveUser(claims: JwtClaims) {
    const email = claimString(claims[this.config.OIDC_EMAIL_CLAIM])
    if (email) {
      const user = await this.users.findByEmail(email)
      if (user) return user
    }

    const subject = claimString(claims[this.config.OIDC_SUBJECT_CLAIM]) ?? claimString(claims.sub)
    if (subject) {
      const user = await this.users.findById(subject)
      if (user) return user
    }

    return null
  }

  private async verifyToken(token: string): Promise<JwtClaims> {
    const [headerPart, payloadPart, signaturePart] = token.split('.')
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new AppError(401, 'OIDC_TOKEN_INVALID', 'Invalid OIDC token format')
    }

    const header = decodeJson<JwtHeader>(headerPart)
    if (header.alg !== 'RS256') {
      throw new AppError(
        401,
        'OIDC_ALG_UNSUPPORTED',
        `Unsupported OIDC algorithm: ${header.alg ?? 'unknown'}`,
      )
    }

    const claims = decodeJson<JwtClaims>(payloadPart)
    validateClaims(claims, this.config)

    const jwk = await this.selectKey(header)
    const signingInput = `${headerPart}.${payloadPart}`
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
    const verified = verifySignature(
      'RSA-SHA256',
      Buffer.from(signingInput),
      publicKey,
      Buffer.from(signaturePart, 'base64url'),
    )
    if (!verified) {
      throw new AppError(401, 'OIDC_SIGNATURE_INVALID', 'OIDC token signature verification failed')
    }

    return claims
  }

  private async selectKey(header: JwtHeader): Promise<OidcJwk> {
    const keys = await this.loadJwks()
    const matches = keys.filter((key) => key.kty === 'RSA' && (!header.kid || key.kid === header.kid))
    const jwk = matches[0] ?? keys.find((key) => key.kty === 'RSA')
    if (!jwk) throw new AppError(503, 'OIDC_JWKS_EMPTY', 'OIDC JWKS did not contain a usable RSA key')
    return jwk
  }

  private async loadJwks(): Promise<OidcJwk[]> {
    const now = Date.now()
    if (this.jwksCache && this.jwksCache.expiresAt > now) return this.jwksCache.keys

    const jwksUrl = await this.resolveJwksUrl()
    const response = await fetch(jwksUrl, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      throw new AppError(503, 'OIDC_JWKS_UNAVAILABLE', `Failed to load OIDC JWKS: ${response.status}`)
    }

    const body = (await response.json()) as { keys?: OidcJwk[] }
    const keys = Array.isArray(body.keys) ? body.keys.filter((key) => Boolean(key.kty)) : []
    this.jwksCache = { keys, expiresAt: now + DEFAULT_CACHE_MS }
    return keys
  }

  private async resolveJwksUrl(): Promise<string> {
    if (this.config.OIDC_JWKS_URL) return this.config.OIDC_JWKS_URL
    const now = Date.now()
    if (this.discoveryCache && this.discoveryCache.expiresAt > now) return this.discoveryCache.jwksUrl

    const discoveryUrl = buildDiscoveryUrl(this.config.OIDC_ISSUER_URL)
    const response = await fetch(discoveryUrl, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      throw new AppError(
        503,
        'OIDC_DISCOVERY_UNAVAILABLE',
        `Failed to load OIDC discovery metadata: ${response.status}`,
      )
    }

    const body = (await response.json()) as { jwks_uri?: string; issuer?: string }
    const jwksUrl = claimString(body.jwks_uri)
    if (!jwksUrl)
      throw new AppError(503, 'OIDC_DISCOVERY_INVALID', 'OIDC discovery metadata did not include jwks_uri')
    const discoveredIssuer = claimString(body.issuer)
    if (
      discoveredIssuer &&
      normalizeIssuer(discoveredIssuer) !== normalizeIssuer(this.config.OIDC_ISSUER_URL)
    ) {
      throw new AppError(401, 'OIDC_ISSUER_MISMATCH', 'OIDC issuer did not match configured issuer')
    }

    this.discoveryCache = { jwksUrl, expiresAt: now + DEFAULT_CACHE_MS }
    return jwksUrl
  }
}

function bearerToken(value: string | undefined): string | null {
  if (!value) return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1] ?? null
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
  } catch {
    throw new AppError(401, 'OIDC_TOKEN_INVALID', 'OIDC token is not valid base64url JSON')
  }
}

function validateClaims(
  claims: JwtClaims,
  config: Pick<AppConfig, 'OIDC_ISSUER_URL' | 'OIDC_AUDIENCE' | 'OIDC_CLOCK_TOLERANCE_SECONDS'>,
): void {
  const now = Math.floor(Date.now() / 1_000)
  const tolerance = config.OIDC_CLOCK_TOLERANCE_SECONDS
  const issuer = claimString(claims.iss)

  if (!issuer) {
    throw new AppError(401, 'OIDC_ISSUER_MISSING', 'OIDC token issuer is required')
  }

  if (normalizeIssuer(issuer) !== normalizeIssuer(config.OIDC_ISSUER_URL)) {
    throw new AppError(401, 'OIDC_ISSUER_INVALID', 'OIDC token issuer mismatch')
  }

  if (!audienceMatches(claims.aud, config.OIDC_AUDIENCE)) {
    throw new AppError(401, 'OIDC_AUDIENCE_INVALID', 'OIDC token audience mismatch')
  }

  if (typeof claims.exp !== 'number' || claims.exp <= now - tolerance) {
    throw new AppError(401, 'OIDC_TOKEN_EXPIRED', 'OIDC token has expired')
  }

  if (typeof claims.nbf === 'number' && claims.nbf > now + tolerance) {
    throw new AppError(401, 'OIDC_TOKEN_NOT_YET_VALID', 'OIDC token is not yet valid')
  }

  if (typeof claims.iat === 'number' && claims.iat > now + tolerance) {
    throw new AppError(401, 'OIDC_TOKEN_ISSUED_IN_FUTURE', 'OIDC token iat is in the future')
  }

  if (!claimString(claims.sub)) {
    throw new AppError(401, 'OIDC_SUBJECT_MISSING', 'OIDC token subject is required')
  }
}

function audienceMatches(value: string | string[] | undefined, expected: string): boolean {
  if (!expected) return false
  if (typeof value === 'string') return value === expected
  if (Array.isArray(value)) return value.includes(expected)
  return false
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, '')
}

function buildDiscoveryUrl(issuer: string): string {
  return `${normalizeIssuer(issuer)}/.well-known/openid-configuration`
}

function claimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
