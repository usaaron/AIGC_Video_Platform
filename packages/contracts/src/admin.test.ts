import { describe, expect, it } from 'vitest'
import {
  adminConsoleSchema,
  adminCompliancePromptActionSchema,
  adminCompliancePromptListSchema,
  adminMembershipSchema,
  adminPasswordResetRequirementUpdateSchema,
  adminSetUserPasswordSchema,
  adminUserSchema,
} from './admin.js'
import {
  adminAdjustCreditsSchema,
  adminGrantCreditsSchema,
  adminUpdateMembershipPlanSchema,
  billingSummarySchema,
  organizationBillingSummarySchema,
} from './billing.js'

const now = '2026-08-01T00:00:00.000Z'
const meta = { limit: 50, offset: 0, total: 1 }

const user = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Platform Admin',
  status: 'active',
  roles: ['admin'],
  membershipCount: 1,
  activeMembershipCount: 1,
  passwordResetRequired: false,
  createdAt: now,
  updatedAt: now,
}

const organization = {
  id: 'tenant-system',
  name: 'System Organization',
  status: 'active',
  isSystem: true,
  createdByUserId: null,
  createdByEmail: null,
  createdByName: null,
  membershipCount: 1,
  activeMembershipCount: 1,
  activeOrganizationAdminCount: 0,
  createdAt: now,
  updatedAt: now,
}

const membership = {
  id: 'membership-admin',
  tenantId: 'tenant-system',
  tenantName: 'System Organization',
  tenantStatus: 'active',
  organizationId: 'tenant-system',
  organizationName: 'System Organization',
  organizationStatus: 'active',
  userId: 'user-admin',
  email: 'admin@example.com',
  name: 'Platform Admin',
  userStatus: 'active',
  roles: ['admin'],
  status: 'active',
  isPrimary: true,
  plan: 'free',
  credits: 100,
  createdAt: now,
  updatedAt: now,
}

const billingAccount = {
  membershipId: 'membership-admin',
  tenantId: 'tenant-system',
  tenantName: 'System Organization',
  organizationId: 'tenant-system',
  organizationName: 'System Organization',
  userId: 'user-admin',
  email: 'admin@example.com',
  name: 'Platform Admin',
  userStatus: 'active',
  membershipStatus: 'active',
  roles: ['admin'],
  plan: 'free',
  credits: 100,
  updatedAt: now,
}

describe('admin console contracts', () => {
  it('accepts the unified admin console payload with organization aliases', () => {
    const parsed = adminConsoleSchema.parse({
      overview: {
        users: 1,
        activeTasks: 0,
        creditsConsumedToday: 0,
        generatedAt: now,
      },
      users: { items: [user], meta },
      tenants: { items: [organization], meta },
      organizations: { items: [organization], meta },
      memberships: { items: [membership], meta },
      billingAccounts: { items: [billingAccount], meta },
      billingLedgerEntries: {
        items: [
          {
            id: 'ledger-admin-grant',
            membershipId: 'membership-admin',
            userId: 'user-admin',
            tenantId: 'tenant-system',
            amount: 100,
            balance: 100,
            type: 'grant',
            description: 'Initial grant',
            referenceId: 'seed-grant',
            relatedEntryId: null,
            createdByUserId: null,
            metadata: { source: 'contract-test' },
            createdAt: now,
          },
        ],
        meta,
      },
      billingPaymentReconciliation: {
        items: [],
        meta: { ...meta, total: 0 },
      },
      billingReconciliationAlerts: {
        items: [],
        meta: { ...meta, total: 0 },
      },
      sessions: {
        items: [
          {
            sessionId: 'session-admin',
            membershipId: 'membership-admin',
            tenantId: 'tenant-system',
            tenantName: 'System Organization',
            tenantStatus: 'active',
            organizationId: 'tenant-system',
            organizationName: 'System Organization',
            organizationStatus: 'active',
            userId: 'user-admin',
            email: 'admin@example.com',
            name: 'Platform Admin',
            userStatus: 'active',
            membershipStatus: 'active',
            roles: ['admin'],
            status: 'active',
            createdAt: now,
            lastSeenAt: now,
            expiresAt: '2026-08-02T00:00:00.000Z',
            revokedAt: null,
            ipAddress: '127.0.0.1',
            userAgent: 'ContractTest/1.0',
            deviceLabel: 'Contract Test',
            current: true,
          },
        ],
        meta,
      },
      auditLogs: {
        items: [
          {
            id: 'audit-admin-login',
            tenantId: 'tenant-system',
            organizationId: 'tenant-system',
            userId: 'user-admin',
            actorUserId: 'user-admin',
            action: 'auth.login.succeeded',
            resourceType: 'session',
            resourceId: 'session-admin',
            ipAddress: '127.0.0.1',
            userAgent: 'ContractTest/1.0',
            metadata: { scope: 'admin_console' },
            createdAt: now,
          },
        ],
        meta,
      },
      generatedAt: now,
    })

    expect(parsed.organizations.items[0]).toMatchObject({
      id: 'tenant-system',
      isSystem: true,
    })
    expect(parsed.billingLedgerEntries.items[0]).toMatchObject({
      membershipId: 'membership-admin',
      referenceId: 'seed-grant',
    })
  })

  it('rejects removed creator roles from admin response contracts', () => {
    expect(adminUserSchema.safeParse({ ...user, roles: ['creator'] }).success).toBe(false)
    expect(adminMembershipSchema.safeParse({ ...membership, roles: ['creator'] }).success).toBe(false)
  })

  it('validates sensitive admin mutation payloads', () => {
    expect(adminSetUserPasswordSchema.parse({ newPassword: 'TemporaryPass123!' })).toEqual({
      newPassword: 'TemporaryPass123!',
      requireChange: true,
      revokeSessions: true,
    })
    expect(
      adminPasswordResetRequirementUpdateSchema.parse({
        required: true,
      }),
    ).toEqual({ required: true, revokeSessions: true })
    expect(adminGrantCreditsSchema.safeParse({ amount: 50, reason: 'Manual top-up' }).success).toBe(true)
    expect(adminAdjustCreditsSchema.safeParse({ amount: 0, reason: 'No-op' }).success).toBe(false)
    expect(adminUpdateMembershipPlanSchema.parse({ plan: 'member' })).toEqual({
      plan: 'member',
      grantMonthlyCredits: true,
    })
    expect(
      adminCompliancePromptActionSchema.parse({
        action: 'warned',
        reason: 'Manual compliance warning',
        category: 'graphic_violence',
      }),
    ).toMatchObject({ action: 'warned', category: 'graphic_violence' })
  })

  it('accepts compliance prompt review lists', () => {
    expect(
      adminCompliancePromptListSchema.parse({
        items: [
          {
            id: 'generation_task:task-1',
            source: 'generation_task',
            sourceId: 'task-1',
            clientRequestId: 'request-1',
            projectId: 'project-1',
            tenantId: 'tenant-system',
            tenantName: 'System Organization',
            organizationId: 'tenant-system',
            organizationName: 'System Organization',
            organizationType: 'system',
            userId: 'user-admin',
            email: 'admin@example.com',
            name: 'Platform Admin',
            userStatus: 'active',
            membershipId: 'membership-admin',
            kind: 'image',
            label: 'Prompt Review',
            provider: 'local',
            status: 'queued',
            promptPreview: 'Prompt preview',
            promptText: 'Prompt preview',
            inputKeys: ['prompt'],
            riskTags: [
              {
                category: 'graphic_violence',
                label: '极端血腥暴力',
                severity: 'high',
                hits: 1,
              },
            ],
            riskScore: 71,
            createdAt: now,
            updatedAt: now,
          },
        ],
        meta,
        generatedAt: now,
      }),
    ).toMatchObject({ items: [{ source: 'generation_task', riskScore: 71 }] })
  })

  it('accepts organization billing summaries', () => {
    expect(
      billingSummarySchema.parse({
        plan: 'member',
        credits: 150,
        billingScope: 'organization',
        organizationPool: { tenantId: 'tenant-enterprise', organizationId: 'tenant-enterprise', credits: 150 },
        concurrency: 3,
        unlimitedConcurrency: false,
        planSelfServiceEnabled: false,
        monthlyUsage: {
          periodStart: now,
          consumedCredits: 7,
          refundedCredits: 0,
          netCredits: 7,
          generationCount: 1,
          includedCredits: 0,
        },
        entries: [],
      }),
    ).toMatchObject({ billingScope: 'organization', organizationPool: { credits: 150 } })

    expect(
      organizationBillingSummarySchema.parse({
        tenantId: 'tenant-enterprise',
        organizationId: 'tenant-enterprise',
        credits: 150,
        monthlyUsage: {
          periodStart: now,
          consumedCredits: 0,
          refundedCredits: 0,
          netCredits: 0,
          generationCount: 0,
          includedCredits: 0,
        },
        entries: [
          {
            id: 'organization-adjustment-1',
            userId: null,
            tenantId: 'tenant-enterprise',
            membershipId: null,
            referenceId: 'organization-adjustment-1',
            relatedEntryId: null,
            amount: 150,
            balance: 150,
            type: 'adjustment',
            description: 'Organization top-up',
            createdByUserId: 'user-owner',
            metadata: { source: 'contract-test' },
            createdAt: now,
          },
        ],
      }),
    ).toMatchObject({ credits: 150, entries: [expect.objectContaining({ userId: null })] })
  })
})
