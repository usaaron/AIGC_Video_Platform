import { z } from 'zod'
import { sessionSchema } from './account.js'
import { roleSchema } from './auth.js'

export const workspaceStatusSchema = z.enum(['active', 'disabled'])
export const membershipStatusSchema = z.enum(['active', 'disabled'])
export const invitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired'])

export const registerAccountSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(12).max(128),
  workspaceName: z.string().min(1).max(80).optional(),
})

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
})

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  roles: z.array(roleSchema).min(1),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
})

export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(512),
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

export const invitationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80),
  email: z.string().email(),
  roles: z.array(roleSchema).min(1),
  invitedByUserId: z.string().min(1),
  status: invitationStatusSchema,
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const invitationCreatedSchema = invitationSchema.extend({
  token: z.string().min(32),
  inviteUrl: z.string().min(1),
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

export type RegisterAccountInput = z.infer<typeof registerAccountSchema>
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
export type UpdateMembershipRolesInput = z.infer<typeof updateMembershipRolesSchema>
export type Workspace = z.infer<typeof workspaceSchema>
export type Membership = z.infer<typeof membershipSchema>
export type Invitation = z.infer<typeof invitationSchema>
export type InvitationCreated = z.infer<typeof invitationCreatedSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type AccountSession = z.infer<typeof accountSessionSchema>
