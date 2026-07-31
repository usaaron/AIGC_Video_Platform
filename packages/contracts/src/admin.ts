import { z } from 'zod'
import { planSchema } from './account.js'
import { ledgerEntrySchema } from './billing.js'
import { roleSchema } from './auth.js'

export const adminOverviewSchema = z.object({
  users: z.number().int().nonnegative(),
  activeTasks: z.number().int().nonnegative(),
  creditsConsumedToday: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
})

export const adminAccountStatusSchema = z.enum(['active', 'disabled'])
export const adminMembershipStatusSchema = z.enum(['active', 'disabled'])
export const adminTenantStatusSchema = z.enum(['active', 'disabled'])
export const adminSessionStatusSchema = z.enum(['active', 'revoked', 'expired'])

export const adminListMetaSchema = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})

export const adminUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().nullable(),
  name: z.string().min(1).max(80),
  status: adminAccountStatusSchema,
  roles: z.array(roleSchema),
  membershipCount: z.number().int().nonnegative(),
  activeMembershipCount: z.number().int().nonnegative(),
  passwordResetRequired: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const adminTenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  status: adminTenantStatusSchema,
  createdByUserId: z.string().min(1).nullable(),
  createdByEmail: z.string().email().nullable(),
  createdByName: z.string().min(1).max(80).nullable(),
  membershipCount: z.number().int().nonnegative(),
  activeMembershipCount: z.number().int().nonnegative(),
  activeOwnerCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const adminMembershipSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80),
  tenantStatus: adminTenantStatusSchema,
  userId: z.string().min(1),
  email: z.string().email().nullable(),
  name: z.string().min(1).max(80),
  userStatus: adminAccountStatusSchema,
  roles: z.array(roleSchema).min(1),
  status: adminMembershipStatusSchema,
  isPrimary: z.boolean(),
  plan: planSchema,
  credits: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const adminBillingAccountSchema = z.object({
  membershipId: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80),
  userId: z.string().min(1),
  email: z.string().email().nullable(),
  name: z.string().min(1).max(80),
  userStatus: adminAccountStatusSchema,
  membershipStatus: adminMembershipStatusSchema,
  roles: z.array(roleSchema).min(1),
  plan: planSchema,
  credits: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
})

export const adminBillingLedgerEntrySchema = ledgerEntrySchema.extend({
  membershipId: z.string().min(1),
  referenceId: z.string().min(1),
  relatedEntryId: z.string().min(1).nullable(),
  createdByUserId: z.string().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()),
})

export const adminSessionSchema = z.object({
  sessionId: z.string().min(1),
  membershipId: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80),
  tenantStatus: adminTenantStatusSchema,
  userId: z.string().min(1),
  email: z.string().email().nullable(),
  name: z.string().min(1).max(80),
  userStatus: adminAccountStatusSchema,
  membershipStatus: adminMembershipStatusSchema,
  roles: z.array(roleSchema).min(1),
  status: adminSessionStatusSchema,
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  deviceLabel: z.string().nullable(),
  current: z.boolean(),
})

export const adminAuditLogEntrySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  actorUserId: z.string().min(1).nullable(),
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().min(1).nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
})

export const adminUserListSchema = z.object({
  items: z.array(adminUserSchema),
  meta: adminListMetaSchema,
})

export const adminTenantListSchema = z.object({
  items: z.array(adminTenantSchema),
  meta: adminListMetaSchema,
})

export const adminMembershipListSchema = z.object({
  items: z.array(adminMembershipSchema),
  meta: adminListMetaSchema,
})

export const adminBillingAccountListSchema = z.object({
  items: z.array(adminBillingAccountSchema),
  meta: adminListMetaSchema,
})

export const adminBillingLedgerEntryListSchema = z.object({
  items: z.array(adminBillingLedgerEntrySchema),
  meta: adminListMetaSchema,
})

export const adminSessionListSchema = z.object({
  items: z.array(adminSessionSchema),
  meta: adminListMetaSchema,
})

export const adminAuditLogEntryListSchema = z.object({
  items: z.array(adminAuditLogEntrySchema),
  meta: adminListMetaSchema,
})

export const adminMembershipDetailSchema = z.object({
  membership: adminMembershipSchema,
  billing: adminBillingAccountSchema,
  entries: z.array(adminBillingLedgerEntrySchema),
})

export const adminAccountStatusUpdateSchema = z.object({
  status: adminAccountStatusSchema,
})

export const adminPasswordResetRequirementUpdateSchema = z.object({
  required: z.boolean(),
  revokeSessions: z.boolean().default(true),
})

export const adminSetUserPasswordSchema = z.object({
  newPassword: z.string().min(12).max(128),
  requireChange: z.boolean().default(true),
  revokeSessions: z.boolean().default(true),
})

export const adminConsoleSchema = z.object({
  overview: adminOverviewSchema,
  users: adminUserListSchema,
  tenants: adminTenantListSchema,
  memberships: adminMembershipListSchema,
  billingAccounts: adminBillingAccountListSchema,
  billingLedgerEntries: adminBillingLedgerEntryListSchema,
  sessions: adminSessionListSchema,
  auditLogs: adminAuditLogEntryListSchema,
  generatedAt: z.string().datetime(),
})

export type AdminOverview = z.infer<typeof adminOverviewSchema>
export type AdminAccountStatus = z.infer<typeof adminAccountStatusSchema>
export type AdminSessionStatus = z.infer<typeof adminSessionStatusSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminTenant = z.infer<typeof adminTenantSchema>
export type AdminMembership = z.infer<typeof adminMembershipSchema>
export type AdminBillingAccount = z.infer<typeof adminBillingAccountSchema>
export type AdminBillingLedgerEntry = z.infer<typeof adminBillingLedgerEntrySchema>
export type AdminSession = z.infer<typeof adminSessionSchema>
export type AdminAuditLogEntry = z.infer<typeof adminAuditLogEntrySchema>
export type AdminUserList = z.infer<typeof adminUserListSchema>
export type AdminTenantList = z.infer<typeof adminTenantListSchema>
export type AdminMembershipList = z.infer<typeof adminMembershipListSchema>
export type AdminMembershipDetail = z.infer<typeof adminMembershipDetailSchema>
export type AdminBillingAccountList = z.infer<typeof adminBillingAccountListSchema>
export type AdminBillingLedgerEntryList = z.infer<typeof adminBillingLedgerEntryListSchema>
export type AdminSessionList = z.infer<typeof adminSessionListSchema>
export type AdminAuditLogEntryList = z.infer<typeof adminAuditLogEntryListSchema>
export type AdminConsole = z.infer<typeof adminConsoleSchema>
export type AdminAccountStatusUpdateInput = z.infer<typeof adminAccountStatusUpdateSchema>
export type AdminPasswordResetRequirementUpdateInput = z.infer<
  typeof adminPasswordResetRequirementUpdateSchema
>
export type AdminSetUserPasswordInput = z.infer<typeof adminSetUserPasswordSchema>
