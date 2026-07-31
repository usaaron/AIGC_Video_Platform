import { describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from './permissions.js'

describe('role permissions', () => {
  it('grants owners every declared permission', () => {
    expect(new Set(ROLE_PERMISSIONS.owner)).toEqual(new Set(Object.values(PERMISSIONS)))
  })

  it('gives super admins the operational permissions without system config access', () => {
    expect(ROLE_PERMISSIONS.super_admin).toContain(PERMISSIONS.ADMIN_DASHBOARD_READ)
    expect(ROLE_PERMISSIONS.super_admin).toContain(PERMISSIONS.USER_MANAGE)
    expect(ROLE_PERMISSIONS.super_admin).toContain(PERMISSIONS.BILLING_MANAGE)
    expect(ROLE_PERMISSIONS.super_admin).not.toContain(PERMISSIONS.SYSTEM_CONFIG_MANAGE)
  })

  it('keeps creator out of the formal account role contract', () => {
    expect(Object.values(ROLES)).not.toContain('creator')
  })

  it('does not expose admin capabilities to members', () => {
    expect(ROLE_PERMISSIONS.member).not.toContain(PERMISSIONS.ADMIN_DASHBOARD_READ)
    expect(ROLE_PERMISSIONS.member).not.toContain(PERMISSIONS.BILLING_MANAGE)
    expect(ROLE_PERMISSIONS.member).not.toContain(PERMISSIONS.USER_MANAGE)
  })

  it('allows admins to inspect operations without changing system configuration', () => {
    expect(ROLE_PERMISSIONS.admin).toContain(PERMISSIONS.ADMIN_DASHBOARD_READ)
    expect(ROLE_PERMISSIONS.admin).toContain(PERMISSIONS.BILLING_MANAGE)
    expect(ROLE_PERMISSIONS.admin).not.toContain(PERMISSIONS.SYSTEM_CONFIG_MANAGE)
  })
})
