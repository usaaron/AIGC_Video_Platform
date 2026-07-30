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
}

export type AuthSession = {
  sessionId: string
  userId: string
  tenantId: string
  roles: Role[]
  tokenSecretHash: string
  expiresAt: string
  revokedAt: string | null
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
  ): Promise<boolean>
  resolveSession(sessionId: string): Promise<AuthSession | null>
  touchSession(sessionId: string): Promise<void>
  revokeSession(sessionId: string): Promise<void>
  revokeSessionsForUser(userId: string, tenantId: string): Promise<void>
  toAccount(user: AuthAccount): Account
}
