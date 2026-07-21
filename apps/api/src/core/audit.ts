import type { Role } from '@seqora/contracts'

export type AuditOutcome = 'success' | 'failure'

export type AuditLogEntry = {
  id: string
  requestId: string
  traceId: string
  tenantId: string | null
  userId: string | null
  roles: Role[]
  method: string
  routePattern: string | null
  path: string
  action: string
  statusCode: number
  outcome: AuditOutcome
  ip: string | null
  userAgent: string | null
  details: Record<string, unknown>
  createdAt: string
}

export interface AuditLogWriter {
  record(entry: AuditLogEntry): Promise<void>
}

export interface AuditLogReader {
  list(tenantId: string, limit: number): Promise<AuditLogEntry[]>
}
