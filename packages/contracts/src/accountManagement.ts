import { z } from 'zod'
import { sessionSchema } from './account.js'
import { roleSchema } from './auth.js'

export const workspaceStatusSchema = z.enum(['active', 'disabled'])
export const membershipStatusSchema = z.enum(['active', 'disabled'])

export const registerAccountSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(12).max(128),
  workspaceName: z.string().min(1).max(80).optional(),
})

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
})

export const addTenantMemberSchema = z.object({
  email: z.string().email(),
  roles: z.array(roleSchema).min(1),
})

export const updateMembershipRolesSchema = z.object({
  roles: z.array(roleSchema).min(1),
})

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  status: workspaceStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const membershipSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80),
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(80),
  roles: z.array(roleSchema).min(1),
  status: membershipStatusSchema,
  isPrimary: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const sessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80),
  roles: z.array(roleSchema).min(1),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  current: z.boolean(),
})

export const accountSessionSchema = sessionSchema.extend({
  workspace: workspaceSchema,
})

export const workspaceMembershipSchema = z.object({
  workspace: workspaceSchema,
  membership: membershipSchema,
})

export type RegisterAccountInput = z.infer<typeof registerAccountSchema>
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type AddTenantMemberInput = z.infer<typeof addTenantMemberSchema>
export type UpdateMembershipRolesInput = z.infer<typeof updateMembershipRolesSchema>
export type Workspace = z.infer<typeof workspaceSchema>
export type Membership = z.infer<typeof membershipSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type AccountSession = z.infer<typeof accountSessionSchema>
export type WorkspaceMembership = z.infer<typeof workspaceMembershipSchema>
