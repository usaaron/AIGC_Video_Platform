import type { AuditLogEntry, AuditLogReader, AuditLogWriter } from '../../core/audit.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'
import type { StateStore } from '../../infra/store.js'

export class StoreAuditLogRepository implements AuditLogWriter, AuditLogReader {
  constructor(private readonly store: StateStore) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.store.mutate((state) => {
      state.auditLogs.unshift(entry)
    })
  }

  async list(tenantId: string, limit: number): Promise<AuditLogEntry[]> {
    return this.store.read((state) =>
      state.auditLogs.filter((entry) => entry.tenantId === tenantId).slice(0, limit),
    )
  }
}

export class PostgresAuditLogRepository implements AuditLogWriter, AuditLogReader {
  constructor(private readonly transactions: PostgresTransactionRunner) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.transactions.withTransaction(async (client) => {
      await client.query(
        `
          insert into audit_logs (
            id, request_id, trace_id, tenant_id, user_id, roles, method, route_pattern,
            path, action, status_code, outcome, ip, user_agent, details, created_at
          )
          values (
            $1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16
          )
        `,
        [
          entry.id,
          entry.requestId,
          entry.traceId,
          entry.tenantId,
          entry.userId,
          entry.roles,
          entry.method,
          entry.routePattern,
          entry.path,
          entry.action,
          entry.statusCode,
          entry.outcome,
          entry.ip,
          entry.userAgent,
          JSON.stringify(entry.details),
          entry.createdAt,
        ],
      )
    })
  }

  async list(tenantId: string, limit: number): Promise<AuditLogEntry[]> {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query<AuditLogRow>(
        `
          select id, request_id as "requestId", trace_id as "traceId", tenant_id as "tenantId",
            user_id as "userId", roles, method, route_pattern as "routePattern", path, action,
            status_code as "statusCode", outcome, ip, user_agent as "userAgent", details,
            created_at as "createdAt"
          from audit_logs
          where tenant_id = $1
          order by created_at desc, id desc
          limit $2
        `,
        [tenantId, limit],
      )

      return result.rows.map(normalizeAuditRow)
    })
  }
}

type AuditLogRow = Omit<AuditLogEntry, 'details' | 'roles' | 'createdAt'> & {
  details: unknown
  roles: unknown
  createdAt: Date | string
}

function normalizeAuditRow(row: AuditLogRow): AuditLogEntry {
  return {
    ...row,
    details: normalizeDetails(row.details),
    roles: Array.isArray(row.roles) ? row.roles : [],
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  }
}

function normalizeDetails(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}
