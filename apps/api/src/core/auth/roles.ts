import { ROLES, type Principal, type Role } from '@seqora/contracts'

export function isOwner(principal: Principal): boolean {
  return principal.roles.includes(ROLES.OWNER)
}

export function isSuperAdmin(principal: Principal): boolean {
  return principal.roles.includes(ROLES.SUPER_ADMIN)
}

export function isPlatformAdmin(principal: Principal): boolean {
  return isOwner(principal) || isSuperAdmin(principal)
}

export function isTenantAdmin(principal: Principal): boolean {
  return principal.roles.includes(ROLES.ADMIN) || principal.roles.includes(ROLES.ORGANIZATION_ADMIN)
}

export function isTenantManager(principal: Principal): boolean {
  return isPlatformAdmin(principal) || isTenantAdmin(principal)
}

export function canReadAllTenantContent(principal: Principal): boolean {
  return isTenantManager(principal)
}

export function hasElevatedRole(roles: readonly Role[]): boolean {
  return (
    roles.includes(ROLES.OWNER) ||
    roles.includes(ROLES.SUPER_ADMIN) ||
    roles.includes(ROLES.ADMIN) ||
    roles.includes(ROLES.ORGANIZATION_ADMIN)
  )
}

export function hasOwnerRole(roles: readonly Role[]): boolean {
  return roles.includes(ROLES.OWNER)
}

export function hasSuperAdminRole(roles: readonly Role[]): boolean {
  return roles.includes(ROLES.SUPER_ADMIN)
}

export function hasAdminRole(roles: readonly Role[]): boolean {
  return roles.includes(ROLES.ADMIN)
}

export function hasOrganizationAdminRole(roles: readonly Role[]): boolean {
  return roles.includes(ROLES.ORGANIZATION_ADMIN)
}
