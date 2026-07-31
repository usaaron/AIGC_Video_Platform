import type { Account, Plan, Role } from '@seqora/contracts'

export type AuthAccount = {
  id: string
  email: string
  name: string
  passwordHash: string
  tenantId: string
  roles: Role[]
  plan: Plan
  credits: number
  passwordResetRequired: boolean
}

export type AuthSession = {
  sessionId: string
  userId: string
  tenantId: string
  roles: Role[]
  passwordResetRequired: boolean
  tokenSecretHash: string
  expiresAt: string
  revokedAt: string | null
}

export type SessionMetadata = {
  ipAddress: string | null
  userAgent: string | null
  deviceLabel: string | null
}

export type PasswordResetTokenInput = {
  email: string
  tokenSecretHash: string
  expiresAt: string
  ipAddress: string | null
  userAgent: string | null
}

export type PasswordResetTokenResult = {
  userId: string
  identityId: string
  expiresAt: string
}

export type ResetPasswordTokenInput = {
  tokenSecretHash: string
  passwordHash: string
  ipAddress: string | null
  userAgent: string | null
}

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

export interface AuthAccounts {
  hasDatabase: boolean
  findByEmail(email: string): Promise<AuthAccount | null>
  findById(id: string, tenantId?: string): Promise<AuthAccount | null>
  updatePassword(userId: string, tenantId: string, passwordHash: string): Promise<boolean>
  createSession(
    userId: string,
    tenantId: string,
    sessionId: string,
    tokenSecretHash: string,
    expiresAt: string,
    metadata?: SessionMetadata,
  ): Promise<boolean>
  createPasswordResetToken(input: PasswordResetTokenInput): Promise<PasswordResetTokenResult | null>
  resetPasswordWithToken(input: ResetPasswordTokenInput): Promise<boolean>
  recordAuditLog(input: AuditLogInput): Promise<void>
  resolveSession(sessionId: string): Promise<AuthSession | null>
  touchSession(sessionId: string): Promise<void>
  revokeSession(sessionId: string): Promise<void>
  revokeSessionsForUser(userId: string, tenantId: string): Promise<void>
  toAccount(user: AuthAccount): Account
}
