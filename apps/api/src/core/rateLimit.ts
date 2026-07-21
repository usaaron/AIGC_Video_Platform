import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import type { FastifyRequest } from 'fastify'

export type RateLimitDecision = {
  allowed: boolean
  remaining: number
  resetAt: number
}

export interface RateLimiter {
  consume(key: string, limit: number, windowMs?: number): Promise<RateLimitDecision>
}

type MemoryBucket = {
  count: number
  resetAt: number
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, MemoryBucket>()

  async consume(key: string, limit: number, windowMs = 60_000): Promise<RateLimitDecision> {
    const now = Date.now()
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + windowMs
      this.buckets.set(key, { count: 1, resetAt })
      return { allowed: true, remaining: Math.max(0, limit - 1), resetAt }
    }

    bucket.count += 1
    if (bucket.count <= limit) {
      return { allowed: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt }
    }

    return { allowed: false, remaining: 0, resetAt: bucket.resetAt }
  }
}

export class RedisRateLimiter implements RateLimiter {
  private readonly redis: Redis

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
  }

  async consume(key: string, limit: number, windowMs = 60_000): Promise<RateLimitDecision> {
    const normalizedKey = `seqora:rate-limit:${key}`
    const count = await this.redis.incr(normalizedKey)
    if (count === 1) {
      await this.redis.pexpire(normalizedKey, windowMs)
    }

    const ttl = await this.redis.pttl(normalizedKey)
    const resetAt = Date.now() + Math.max(0, ttl)
    const remaining = Math.max(0, limit - count)
    return {
      allowed: count <= limit,
      remaining,
      resetAt,
    }
  }

  async close(): Promise<void> {
    await this.redis.quit()
  }
}

export function createRateLimiter(redisUrl?: string): RateLimiter {
  if (!redisUrl) return new MemoryRateLimiter()
  return new RedisRateLimiter(redisUrl)
}

export function rateLimitKeyFromRequest(request: FastifyRequest): string {
  const principal = request.principal
  if (principal) return `${principal.tenantId}:${principal.userId}`
  return request.ip || randomUUID()
}

export function rateLimitKeyFromIp(request: FastifyRequest): string {
  return request.ip || randomUUID()
}
