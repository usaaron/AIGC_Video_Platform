import { z } from 'zod'
import { passwordSchema, planSchema } from './account.js'
import {
  billingReconciliationAlertListSchema,
  billingReconciliationAlertSchema,
  ledgerEntrySchema,
} from './billing.js'
import { roleSchema } from './auth.js'
import { organizationTypeSchema } from './accountManagement.js'

export const adminOverviewSchema = z.object({
  users: z.number().int().nonnegative(),
  activeTasks: z.number().int().nonnegative(),
  creditsConsumedToday: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
})

export const adminAccountStatusSchema = z.enum(['active', 'disabled', 'deleted'])
export const adminMembershipStatusSchema = z.enum(['active', 'disabled'])
export const adminTenantStatusSchema = z.enum(['active', 'disabled'])
export const adminOrganizationStatusSchema = adminTenantStatusSchema
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
  isSystem: z.boolean().default(false),
  organizationType: organizationTypeSchema.optional(),
  createdByUserId: z.string().min(1).nullable(),
  createdByEmail: z.string().email().nullable(),
  createdByName: z.string().min(1).max(80).nullable(),
  membershipCount: z.number().int().nonnegative(),
  activeMembershipCount: z.number().int().nonnegative(),
  activeOrganizationAdminCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const adminMembershipSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80),
  tenantStatus: adminTenantStatusSchema,
  organizationType: organizationTypeSchema.optional(),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1).max(80),
  organizationStatus: adminOrganizationStatusSchema,
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
  organizationId: z.string().min(1),
  organizationName: z.string().min(1).max(80),
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
  organizationId: z.string().min(1),
  organizationName: z.string().min(1).max(80),
  organizationStatus: adminOrganizationStatusSchema,
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
  organizationId: z.string().min(1).nullable(),
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

export const adminCompliancePromptSourceSchema = z.enum(['generation_task', 'ai_job'])
export const adminComplianceRiskCategorySchema = z.enum([
  'political_sensitive',
  'terrorism',
  'sexual_content',
  'graphic_violence',
  'extremism',
  'self_harm',
  'other',
])
export const adminComplianceSeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])

export const adminComplianceRiskTagSchema = z.object({
  category: adminComplianceRiskCategorySchema,
  label: z.string().min(1).max(40),
  severity: adminComplianceSeveritySchema,
  hits: z.number().int().nonnegative(),
})

export const adminComplianceReviewStatusSchema = z.enum(['pending', 'reviewed', 'warned'])

export const adminComplianceReviewActionEntrySchema = z.object({
  action: z.enum(['reviewed', 'warned']),
  reason: z.string().min(1).max(500).nullable(),
  category: adminComplianceRiskCategorySchema.nullable(),
  actorUserId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
})

export const adminCompliancePromptItemSchema = z.object({
  id: z.string().min(1),
  source: adminCompliancePromptSourceSchema,
  sourceId: z.string().min(1),
  clientRequestId: z.string().min(1),
  projectId: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).max(80).nullable(),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1).max(80).nullable(),
  organizationType: organizationTypeSchema.optional(),
  userId: z.string().min(1),
  email: z.string().email().nullable(),
  name: z.string().min(1).max(80),
  userStatus: adminAccountStatusSchema,
  membershipId: z.string().min(1).nullable(),
  kind: z.string().min(1).max(128),
  label: z.string().min(1).max(200),
  provider: z.string().min(1).max(64),
  status: z.string().min(1).max(40),
  promptPreview: z.string().max(500),
  promptText: z.string().max(4_000),
  inputKeys: z.array(z.string().min(1).max(120)),
  riskTags: z.array(adminComplianceRiskTagSchema),
  riskScore: z.number().int().nonnegative(),
  reviewStatus: adminComplianceReviewStatusSchema.default('pending'),
  lastReviewAction: adminComplianceReviewActionEntrySchema.nullable().default(null),
  reviewActions: z.array(adminComplianceReviewActionEntrySchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const adminCompliancePromptListSchema = z.object({
  items: z.array(adminCompliancePromptItemSchema),
  meta: adminListMetaSchema,
  generatedAt: z.string().datetime(),
})

export const adminCompliancePromptActionSchema = z.object({
  action: z.enum(['reviewed', 'warned']),
  reason: z.string().trim().min(1).max(500),
  category: adminComplianceRiskCategorySchema.optional(),
})

export const adminBillingPaymentReconciliationItemSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  providerEventId: z.string().min(1),
  eventType: z.string().min(1),
  paymentSessionId: z.string().min(1).nullable(),
  billingWebhookEventId: z.string().min(1).nullable(),
  ledgerEntryId: z.string().min(1).nullable(),
  tenantId: z.string().min(1).nullable(),
  organizationId: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  membershipId: z.string().min(1).nullable(),
  status: z.enum(['processed', 'ignored', 'failed']),
  amount: z.number().int().nullable(),
  currency: z.string().min(1).nullable(),
  credits: z.number().int().nullable(),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
})

export const adminBillingReconciliationAlertSchema = billingReconciliationAlertSchema

export const adminBillingReconciliationAlertListSchema = billingReconciliationAlertListSchema

export const adminUserListSchema = z.object({
  items: z.array(adminUserSchema),
  meta: adminListMetaSchema,
})

export const adminTenantListSchema = z.object({
  items: z.array(adminTenantSchema),
  meta: adminListMetaSchema,
})
export const adminOrganizationListSchema = adminTenantListSchema

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

export const adminBillingPaymentReconciliationListSchema = z.object({
  items: z.array(adminBillingPaymentReconciliationItemSchema),
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
  newPassword: passwordSchema,
  requireChange: z.boolean().default(true),
  revokeSessions: z.boolean().default(true),
})

export const adminConsoleSchema = z.object({
  overview: adminOverviewSchema,
  users: adminUserListSchema,
  tenants: adminTenantListSchema,
  organizations: adminOrganizationListSchema,
  memberships: adminMembershipListSchema,
  billingAccounts: adminBillingAccountListSchema,
  billingLedgerEntries: adminBillingLedgerEntryListSchema,
  billingPaymentReconciliation: adminBillingPaymentReconciliationListSchema,
  billingReconciliationAlerts: adminBillingReconciliationAlertListSchema,
  sessions: adminSessionListSchema,
  auditLogs: adminAuditLogEntryListSchema,
  generatedAt: z.string().datetime(),
})

export type AdminOverview = z.infer<typeof adminOverviewSchema>
export type AdminAccountStatus = z.infer<typeof adminAccountStatusSchema>
export type AdminSessionStatus = z.infer<typeof adminSessionStatusSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminTenant = z.infer<typeof adminTenantSchema>
export type AdminOrganization = z.infer<typeof adminTenantSchema>
export type AdminMembership = z.infer<typeof adminMembershipSchema>
export type AdminBillingAccount = z.infer<typeof adminBillingAccountSchema>
export type AdminBillingLedgerEntry = z.infer<typeof adminBillingLedgerEntrySchema>
export type AdminBillingPaymentReconciliationItem = z.infer<
  typeof adminBillingPaymentReconciliationItemSchema
>
export type AdminBillingReconciliationAlert = z.infer<typeof adminBillingReconciliationAlertSchema>
export type AdminBillingReconciliationAlertList = z.infer<typeof adminBillingReconciliationAlertListSchema>
export type AdminSession = z.infer<typeof adminSessionSchema>
export type AdminAuditLogEntry = z.infer<typeof adminAuditLogEntrySchema>
export type AdminCompliancePromptSource = z.infer<typeof adminCompliancePromptSourceSchema>
export type AdminComplianceRiskCategory = z.infer<typeof adminComplianceRiskCategorySchema>
export type AdminComplianceSeverity = z.infer<typeof adminComplianceSeveritySchema>
export type AdminComplianceRiskTag = z.infer<typeof adminComplianceRiskTagSchema>
export type AdminComplianceReviewStatus = z.infer<typeof adminComplianceReviewStatusSchema>
export type AdminComplianceReviewActionEntry = z.infer<typeof adminComplianceReviewActionEntrySchema>
export type AdminCompliancePromptItem = z.infer<typeof adminCompliancePromptItemSchema>
export type AdminCompliancePromptList = z.infer<typeof adminCompliancePromptListSchema>
export type AdminCompliancePromptActionInput = z.infer<typeof adminCompliancePromptActionSchema>
export type AdminUserList = z.infer<typeof adminUserListSchema>
export type AdminTenantList = z.infer<typeof adminTenantListSchema>
export type AdminOrganizationList = z.infer<typeof adminOrganizationListSchema>
export type AdminMembershipList = z.infer<typeof adminMembershipListSchema>
export type AdminMembershipDetail = z.infer<typeof adminMembershipDetailSchema>
export type AdminBillingAccountList = z.infer<typeof adminBillingAccountListSchema>
export type AdminBillingLedgerEntryList = z.infer<typeof adminBillingLedgerEntryListSchema>
export type AdminBillingPaymentReconciliationList = z.infer<
  typeof adminBillingPaymentReconciliationListSchema
>
export type AdminSessionList = z.infer<typeof adminSessionListSchema>
export type AdminAuditLogEntryList = z.infer<typeof adminAuditLogEntryListSchema>
export type AdminConsole = z.infer<typeof adminConsoleSchema>
export type AdminAccountStatusUpdateInput = z.infer<typeof adminAccountStatusUpdateSchema>
export type AdminPasswordResetRequirementUpdateInput = z.infer<
  typeof adminPasswordResetRequirementUpdateSchema
>
export type AdminSetUserPasswordInput = z.infer<typeof adminSetUserPasswordSchema>
