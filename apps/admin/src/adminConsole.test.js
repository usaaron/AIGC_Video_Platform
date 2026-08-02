import { describe, expect, it } from 'vitest'
import {
  auditLogTone,
  assignableRoleOptions,
  buildSessionRiskRows,
  canCreateOrganizationUser,
  canAssignRole,
  canDisableOrganization,
  canManageMembership,
  canManageOrganization,
  canReadAdminConsole,
  canTransferOrganizationAdmin,
  classifyOrganization,
  filterRows,
  formatSignedAmount,
  roleName,
  summarizeAuditLogs,
  summarizeBillingAdjustments,
  summarizeConsole,
  summarizeSessionRisks,
} from './adminConsole'

describe('admin console helpers', () => {
  const ownerSession = sessionFor('user-owner', 'tenant-a', ['owner'])
  const superAdminSession = sessionFor('user-superadmin', 'tenant-a', ['super_admin'])
  const adminSession = sessionFor('user-admin', 'tenant-a', ['admin'])
  const memberSession = sessionFor('user-member', 'tenant-a', ['member'], ['project.read'])

  it('checks admin console permission from the session', () => {
    expect(canReadAdminConsole({ permissions: ['admin.dashboard.read'] })).toBe(true)
    expect(canReadAdminConsole({ permissions: ['project.read'] })).toBe(false)
    expect(canReadAdminConsole(null)).toBe(false)
  })

  it('keeps the admin console entry hidden from ordinary members', () => {
    expect(canReadAdminConsole(ownerSession)).toBe(true)
    expect(canReadAdminConsole(superAdminSession)).toBe(true)
    expect(canReadAdminConsole(adminSession)).toBe(true)
    expect(canReadAdminConsole(memberSession)).toBe(false)
  })

  it('calculates organization management scope from platform and organization roles', () => {
    expect(canManageOrganization(ownerSession, 'tenant-b')).toBe(true)
    expect(canManageOrganization(superAdminSession, 'tenant-b')).toBe(true)
    expect(canManageOrganization(adminSession, 'tenant-a')).toBe(true)
    expect(canManageOrganization(adminSession, 'tenant-b')).toBe(false)
    expect(canDisableOrganization(ownerSession, 'tenant-a')).toBe(true)
    expect(canDisableOrganization(superAdminSession, 'tenant-a')).toBe(false)
    expect(canTransferOrganizationAdmin(ownerSession, 'tenant-a')).toBe(true)
    expect(canTransferOrganizationAdmin(superAdminSession, 'tenant-a')).toBe(true)
    expect(canTransferOrganizationAdmin(adminSession, 'tenant-a')).toBe(false)
  })

  it('protects system organizations in the admin console helpers', () => {
    const systemOrganization = { id: 'tenant-seqora-demo', name: 'Seqora Local', isSystem: true }
    const organizationAdminSession = sessionFor('user-org-admin', 'tenant-seqora-demo', [
      'organization_admin',
    ])

    expect(canManageOrganization(organizationAdminSession, systemOrganization)).toBe(false)
    expect(canDisableOrganization(ownerSession, systemOrganization)).toBe(false)
    expect(canTransferOrganizationAdmin(ownerSession, systemOrganization)).toBe(false)
    expect(assignableRoleOptions(ownerSession, systemOrganization)).toEqual(['admin', 'super_admin'])
    expect(assignableRoleOptions(superAdminSession, systemOrganization)).toEqual(['admin'])
    expect(assignableRoleOptions(adminSession, systemOrganization)).toEqual([])
    expect(canCreateOrganizationUser(ownerSession, systemOrganization)).toBe(true)
    expect(canCreateOrganizationUser(adminSession, systemOrganization)).toBe(false)
    expect(canAssignRole(ownerSession, 'member', systemOrganization)).toBe(false)
    expect(canAssignRole(ownerSession, 'admin', systemOrganization)).toBe(true)
  })

  it('matches role assignment boundaries used by the admin console', () => {
    const organizationAdminSession = sessionFor('user-org-admin', 'tenant-a', ['organization_admin'])
    expect(assignableRoleOptions(ownerSession)).toEqual([
      'member',
      'admin',
      'organization_member',
      'organization_admin',
      'super_admin',
    ])
    expect(assignableRoleOptions(superAdminSession)).toEqual([
      'member',
      'admin',
      'organization_member',
      'organization_admin',
    ])
    expect(assignableRoleOptions(adminSession)).toEqual(['member'])
    expect(assignableRoleOptions(organizationAdminSession)).toEqual(['organization_member'])
    expect(assignableRoleOptions(memberSession)).toEqual([])
    expect(canAssignRole(ownerSession, 'super_admin')).toBe(true)
    expect(canAssignRole(superAdminSession, 'super_admin')).toBe(false)
    expect(canAssignRole(adminSession, 'admin')).toBe(false)
    expect(canAssignRole(adminSession, 'member')).toBe(true)
    expect(canAssignRole(adminSession, 'organization_admin')).toBe(false)
    expect(canAssignRole(organizationAdminSession, 'organization_member')).toBe(true)
    expect(canAssignRole(organizationAdminSession, 'member')).toBe(false)
  })

  it('uses platform and organization role names', () => {
    expect(roleName('owner')).toBe('所有者')
    expect(roleName('super_admin')).toBe('超级管理员')
    expect(roleName('admin')).toBe('管理员')
    expect(roleName('member')).toBe('普通成员')
    expect(roleName('organization_admin')).toBe('组织管理员')
    expect(roleName('organization_member')).toBe('组织成员')
  })

  it('limits membership management by target role and organization scope', () => {
    expect(
      canManageMembership(ownerSession, membershipFor('user-superadmin', 'tenant-b', ['super_admin'])),
    ).toBe(true)
    expect(canManageMembership(superAdminSession, membershipFor('user-owner', 'tenant-a', ['owner']))).toBe(
      false,
    )
    expect(canManageMembership(superAdminSession, membershipFor('user-admin', 'tenant-b', ['admin']))).toBe(
      true,
    )
    expect(canManageMembership(adminSession, membershipFor('user-admin-2', 'tenant-a', ['admin']))).toBe(
      false,
    )
    expect(canManageMembership(adminSession, membershipFor('user-member-2', 'tenant-a', ['member']))).toBe(
      true,
    )
    expect(
      canManageMembership(
        sessionFor('user-org-admin', 'tenant-a', ['organization_admin']),
        membershipFor('user-org-member', 'tenant-a', ['organization_member']),
      ),
    ).toBe(true)
    expect(
      canManageMembership(
        sessionFor('user-org-admin', 'tenant-a', ['organization_admin']),
        membershipFor('user-member-2', 'tenant-a', ['member']),
      ),
    ).toBe(false)
    expect(canManageMembership(adminSession, membershipFor('user-member-3', 'tenant-b', ['member']))).toBe(
      false,
    )
  })

  it('filters nested console rows', () => {
    const rows = [
      { name: 'Owner', tenant: { name: 'Studio Alpha' }, roles: ['owner'] },
      { name: 'Member', tenant: { name: 'Studio Beta' }, roles: ['member'] },
    ]
    expect(filterRows(rows, 'alpha')).toEqual([rows[0]])
    expect(filterRows(rows, 'member')).toEqual([rows[1]])
  })

  it('classifies organization types for the organization list filter', () => {
    expect(classifyOrganization({ id: 'tenant-seqora-demo', name: 'SEQORA Local' })).toMatchObject({
      type: 'system',
      label: '系统组织',
    })
    expect(
      classifyOrganization({
        id: 'tenant-random',
        name: 'tenant-random',
        createdByEmail: 'backend-test@example.com',
      }),
    ).toMatchObject({ type: 'test', label: '测试组织' })
    expect(
      classifyOrganization({
        id: 'tenant-enterprise',
        name: 'Enterprise Customer A',
      }),
    ).toMatchObject({ type: 'enterprise', label: '企业组织' })
    expect(classifyOrganization({ id: 'tenant-normal', name: 'Studio Team' })).toMatchObject({
      type: 'standard',
      label: '普通组织',
    })
  })

  it('summarizes list totals from a console snapshot', () => {
    expect(
      summarizeConsole({
        overview: { users: 1 },
        users: { meta: { total: 4 } },
        organizations: { meta: { total: 2 } },
        memberships: { meta: { total: 5 } },
        sessions: { meta: { total: 6 } },
        billingAccounts: { meta: { total: 3 } },
        billingPaymentReconciliation: { meta: { total: 7 } },
        auditLogs: { meta: { total: 9 } },
      }),
    ).toEqual({
      users: 4,
      organizations: 2,
      tenants: 2,
      memberships: 5,
      sessions: 6,
      billingAccounts: 3,
      paymentReconciliation: 7,
      auditLogs: 9,
    })
  })

  it('formats positive ledger amounts with an explicit sign', () => {
    expect(formatSignedAmount(20)).toBe('+20')
    expect(formatSignedAmount(-3)).toBe('-3')
  })

  it('scores active elevated stale sessions as higher risk', () => {
    const now = new Date('2026-07-31T08:00:00.000Z')
    const rows = buildSessionRiskRows(
      [
        {
          sessionId: 'high',
          userId: 'u1',
          roles: ['owner'],
          status: 'active',
          current: false,
          createdAt: '2026-07-20T08:00:00.000Z',
          lastSeenAt: '2026-07-20T08:00:00.000Z',
          ipAddress: null,
          deviceLabel: null,
          userAgent: null,
        },
        {
          sessionId: 'low',
          userId: 'u2',
          roles: ['member'],
          status: 'active',
          current: false,
          createdAt: '2026-07-31T07:00:00.000Z',
          lastSeenAt: '2026-07-31T07:30:00.000Z',
          ipAddress: '127.0.0.1',
          deviceLabel: 'Chrome on Windows',
          userAgent: 'Chrome',
        },
      ],
      now,
    )

    expect(rows[0].sessionId).toBe('high')
    expect(rows[0].riskLevel).toBe('high')
    expect(rows[1].riskLevel).toBe('low')
    expect(summarizeSessionRisks(rows)).toMatchObject({ high: 1, low: 1, active: 2 })
  })

  it('summarizes audit and billing adjustment activity', () => {
    const auditEntries = [
      { action: 'admin.session.revoked', resourceType: 'session', actorUserId: 'owner' },
      { action: 'admin.account_status.updated', resourceType: 'user', actorUserId: 'owner' },
      { action: 'billing.adjusted', resourceType: 'billing', actorUserId: 'admin' },
    ]
    expect(summarizeAuditLogs(auditEntries)).toEqual({
      total: 3,
      accountEvents: 1,
      sessionEvents: 1,
      billingEvents: 1,
      actors: 2,
    })
    expect(auditLogTone(auditEntries[0])).toBe('high')
    expect(
      summarizeBillingAdjustments([
        { type: 'adjustment', amount: -8 },
        { type: 'grant', amount: 20 },
      ]),
    ).toEqual({ adjustments: 1, grants: 1, positiveCredits: 20, negativeCredits: 8 })
  })
})

function sessionFor(userId, tenantId, roles, permissions = ['admin.dashboard.read', 'user.manage']) {
  return {
    account: { id: userId, tenantId, roles },
    permissions,
  }
}

function membershipFor(userId, tenantId, roles) {
  return { userId, tenantId, roles }
}
