import { ROLES, type Principal } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import {
  canReadAllTenantContent,
  hasAdminRole,
  hasElevatedRole,
  hasOrganizationAdminRole,
  hasOwnerRole,
  hasSuperAdminRole,
  isOwner,
  isPlatformAdmin,
  isSuperAdmin,
  isTenantAdmin,
  isTenantManager,
} from './roles.js'

describe('roles', () => {
  it('identifies each platform and organization role boundary', () => {
    const owner = principal(ROLES.OWNER)
    const superAdmin = principal(ROLES.SUPER_ADMIN)
    const admin = principal(ROLES.ADMIN)
    const organizationAdmin = principal(ROLES.ORGANIZATION_ADMIN)
    const member = principal(ROLES.MEMBER)

    expect(isOwner(owner)).toBe(true)
    expect(isOwner(member)).toBe(false)

    expect(isSuperAdmin(superAdmin)).toBe(true)
    expect(isSuperAdmin(owner)).toBe(false)

    expect(isPlatformAdmin(owner)).toBe(true)
    expect(isPlatformAdmin(superAdmin)).toBe(true)
    expect(isPlatformAdmin(admin)).toBe(false)

    expect(isTenantAdmin(admin)).toBe(true)
    expect(isTenantAdmin(organizationAdmin)).toBe(true)
    expect(isTenantAdmin(member)).toBe(false)

    expect(isTenantManager(owner)).toBe(true)
    expect(isTenantManager(admin)).toBe(true)
    expect(isTenantManager(member)).toBe(false)

    expect(canReadAllTenantContent(owner)).toBe(true)
    expect(canReadAllTenantContent(member)).toBe(false)
  })

  it('flags elevated role arrays consistently', () => {
    expect(hasElevatedRole([ROLES.OWNER])).toBe(true)
    expect(hasElevatedRole([ROLES.MEMBER])).toBe(false)

    expect(hasOwnerRole([ROLES.OWNER])).toBe(true)
    expect(hasOwnerRole([ROLES.MEMBER])).toBe(false)

    expect(hasSuperAdminRole([ROLES.SUPER_ADMIN])).toBe(true)
    expect(hasSuperAdminRole([ROLES.ADMIN])).toBe(false)

    expect(hasAdminRole([ROLES.ADMIN])).toBe(true)
    expect(hasAdminRole([ROLES.ORGANIZATION_ADMIN])).toBe(false)

    expect(hasOrganizationAdminRole([ROLES.ORGANIZATION_ADMIN])).toBe(true)
    expect(hasOrganizationAdminRole([ROLES.ADMIN])).toBe(false)
  })
})

function principal(role: (typeof ROLES)[keyof typeof ROLES]): Principal {
  return {
    userId: `${role}-user`,
    tenantId: `${role}-tenant`,
    organizationId: `${role}-organization`,
    roles: [role],
    passwordResetRequired: false,
    emailVerified: true,
  }
}
