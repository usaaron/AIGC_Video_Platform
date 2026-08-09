import {
  type AdminMembership,
  type AdminTenant,
  PERMISSIONS,
  usageRangeSchema,
  type Principal,
  type UsageMetrics,
  type UsageRange,
  type UsageSummary,
  type UsageSummaryItem,
} from '@seqora/contracts'
import type { FastifyInstance, preHandlerHookHandler } from 'fastify'
import { z } from 'zod'
import { permissionsFor } from '../../core/auth/authorization.js'
import { isPlatformAdmin } from '../../core/auth/roles.js'
import { AppError } from '../../core/errors.js'
import { usageCollector } from '../../core/observability/usage.js'
import { parse, requireAdminRepository, scopeAdminOptions, type AdminRouteContext } from './routeContext.js'
import type { AdminRepository } from './repository.js'

const usageQuery = z.object({
  range: usageRangeSchema.default('today'),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const aggregatePageSize = 100

export function registerAdminUsageRoutes(app: FastifyInstance, context: AdminRouteContext): void {
  app.get('/admin/usage', { preHandler: requireAdminUsageRead }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const repository = requireAdminRepository(context.adminRepository)
    const principal = request.principal!
    const query = parse(usageQuery, request.query)
    const now = new Date()
    const nowMs = now.getTime()
    const rangeSince = rangeStartMs(query.range, now)
    const generatedAt = now.toISOString()
    const platformAdmin = isPlatformAdmin(principal)
    const listOptions = scopeAdminOptions(principal, {
      limit: query.limit,
      offset: query.offset,
    })
    const [users, organizations, allVisibleOrganizations, allVisibleMemberships] = await Promise.all([
      repository.listUsers(listOptions),
      repository.listTenants(listOptions),
      readAllVisibleOrganizations(repository, principal),
      readAllVisibleMemberships(repository, principal),
    ])
    const organizationIdByUserId = indexVisibleMembershipOrganizations(allVisibleMemberships)

    return {
      range: query.range,
      generatedAt,
      global: summaryItem({
        subjectType: 'global',
        name: platformAdmin ? 'All platform usage' : 'Visible organization usage',
        range: query.range,
        generatedAt,
        metrics: platformAdmin
          ? usageCollector.snapshot({}, nowMs, rangeSince)
          : aggregateUsageMetrics(
              allVisibleOrganizations.map((organization) =>
                usageCollector.snapshot(
                  { tenantId: organization.id, organizationId: organization.id },
                  nowMs,
                  rangeSince,
                ),
              ),
            ),
      }),
      organizations: organizations.items.map((organization) =>
        summaryItem({
          subjectType: 'organization',
          organizationId: organization.id,
          name: organization.name,
          range: query.range,
          generatedAt,
          metrics: usageCollector.snapshot(
            { tenantId: organization.id, organizationId: organization.id },
            nowMs,
            rangeSince,
          ),
        }),
      ),
      users: users.items.map((user) => {
        const organizationId = organizationIdByUserId.get(user.id) ?? null
        const metrics =
          platformAdmin || organizationId
            ? usageCollector.snapshot(
                {
                  userId: user.id,
                  ...(platformAdmin || !organizationId ? {} : { tenantId: organizationId, organizationId }),
                },
                nowMs,
                rangeSince,
              )
            : zeroUsageMetrics()
        return summaryItem({
          subjectType: 'user',
          userId: user.id,
          organizationId,
          email: user.email,
          name: user.name,
          range: query.range,
          generatedAt,
          metrics,
        })
      }),
    } satisfies UsageSummary
  })
}

const requireAdminUsageRead: preHandlerHookHandler = async (request) => {
  const principal = request.principal
  if (!principal) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
  const permissions = permissionsFor(principal)
  if (!permissions.has(PERMISSIONS.ADMIN_DASHBOARD_READ)) {
    throw new AppError(403, 'PERMISSION_DENIED', `Missing permission: ${PERMISSIONS.ADMIN_DASHBOARD_READ}`)
  }
  if (
    !permissions.has(PERMISSIONS.USAGE_READ_ALL) &&
    !permissions.has(PERMISSIONS.USAGE_READ_SCOPED) &&
    !permissions.has(PERMISSIONS.USAGE_READ_SELF)
  ) {
    throw new AppError(403, 'PERMISSION_DENIED', 'Missing usage read permission')
  }
}

function summaryItem(input: {
  subjectType: UsageSummaryItem['subjectType']
  userId?: string | null
  organizationId?: string | null
  email?: string | null
  name: string | null
  range: UsageRange
  generatedAt: string
  metrics: UsageMetrics
}): UsageSummaryItem {
  return {
    subjectType: input.subjectType,
    userId: input.userId ?? null,
    organizationId: input.organizationId ?? null,
    email: input.email ?? null,
    name: input.name,
    range: input.range,
    generatedAt: input.generatedAt,
    metrics: input.metrics,
  }
}

async function readAllVisibleOrganizations(
  repository: AdminRepository,
  principal: Principal,
): Promise<AdminTenant[]> {
  return readAllPages((limit, offset) =>
    repository.listTenants(scopeAdminOptions(principal, { limit, offset })),
  )
}

async function readAllVisibleMemberships(
  repository: AdminRepository,
  principal: Principal,
): Promise<AdminMembership[]> {
  return readAllPages((limit, offset) =>
    repository.listMemberships(scopeAdminOptions(principal, { limit, offset })),
  )
}

async function readAllPages<T>(
  load: (
    limit: number,
    offset: number,
  ) => Promise<{
    items: T[]
    meta: { total: number }
  }>,
): Promise<T[]> {
  const items: T[] = []
  let offset = 0
  while (true) {
    const page = await load(aggregatePageSize, offset)
    items.push(...page.items)
    if (items.length >= page.meta.total || page.items.length === 0) return items
    offset += aggregatePageSize
  }
}

function indexVisibleMembershipOrganizations(memberships: AdminMembership[]): Map<string, string> {
  const index = new Map<string, string>()
  const primaryUsers = new Set<string>()
  for (const membership of memberships) {
    const alreadyPrimary = primaryUsers.has(membership.userId)
    if (alreadyPrimary) continue
    if (!index.has(membership.userId) || membership.isPrimary) {
      index.set(membership.userId, membership.organizationId)
      if (membership.isPrimary) primaryUsers.add(membership.userId)
    }
  }
  return index
}

function aggregateUsageMetrics(items: UsageMetrics[]): UsageMetrics {
  const total = zeroUsageMetrics()
  for (const item of items) {
    total.apiConcurrency += item.apiConcurrency
    total.jobConcurrency += item.jobConcurrency
    total.providerConcurrency += item.providerConcurrency
    total.rpm += item.rpm
    total.tpm += item.tpm
    total.requestCount += item.requestCount
    total.jobCount += item.jobCount
    total.inputTokens += item.inputTokens
    total.outputTokens += item.outputTokens
    total.totalTokens += item.totalTokens
    total.creditsUsed += item.creditsUsed
    total.errorCount += item.errorCount
    total.jobFailedCount += item.jobFailedCount
    total.providerUnits += item.providerUnits
  }
  total.errorRate = total.requestCount > 0 ? total.errorCount / total.requestCount : 0
  total.jobFailureRate = total.jobCount > 0 ? total.jobFailedCount / total.jobCount : 0
  return total
}

function zeroUsageMetrics(): UsageMetrics {
  return {
    apiConcurrency: 0,
    jobConcurrency: 0,
    providerConcurrency: 0,
    rpm: 0,
    tpm: 0,
    requestCount: 0,
    jobCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    creditsUsed: 0,
    errorCount: 0,
    errorRate: 0,
    jobFailedCount: 0,
    jobFailureRate: 0,
    providerUnits: 0,
  }
}

function rangeStartMs(range: UsageRange, now: Date): number {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000
  const chinaNow = new Date(now.getTime() + chinaOffsetMs)
  if (range === 'month') {
    return Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs
  }
  const startOfToday = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate())
  if (range === 'week') {
    const day = chinaNow.getUTCDay()
    const daysSinceMonday = (day + 6) % 7
    return startOfToday - daysSinceMonday * 24 * 60 * 60 * 1_000 - chinaOffsetMs
  }
  return startOfToday - chinaOffsetMs
}
