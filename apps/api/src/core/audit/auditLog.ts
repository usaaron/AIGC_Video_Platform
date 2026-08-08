import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'

export type AuditLogInput = {
  tenantId: string | null
  userId: string | null
  actorUserId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata?: Record<string, unknown>
}

export type AuditLogQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>
}

export async function insertAuditLog(client: AuditLogQueryable, input: AuditLogInput): Promise<void> {
  await client.query(
    `
    INSERT INTO audit_log_entries (
      id, tenant_id, user_id, actor_user_id, action, resource_type, resource_id,
      ip_address, user_agent, metadata, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
    `,
    [
      `audit-${randomUUID()}`,
      input.tenantId,
      input.userId,
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.ipAddress,
      input.userAgent,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
}
