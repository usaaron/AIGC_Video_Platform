import { PERMISSIONS, ROLES, type Principal } from '@seqora/contracts'
import type { AppError } from '../errors.js'
import { describe, expect, it } from 'vitest'
import { permissionsFor, requireAnyPermission, requirePermission } from './authorization.js'

describe('authorization', () => {
  it('merges permissions from every assigned role', () => {
    const principal = account([ROLES.ADMIN, ROLES.ORGANIZATION_MEMBER])

    expect(permissionsFor(principal)).toEqual(
      new Set([...ROLE_ADMIN_EXPECTED_PERMISSIONS, ...ROLE_MEMBER_EXPECTED_PERMISSIONS]),
    )
  })

  it('rejects missing authentication and missing permissions', async () => {
    await expect(
      requirePermission(PERMISSIONS.USER_MANAGE)({ principal: null } as never),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
    } satisfies Partial<AppError>)

    await expect(
      requirePermission(PERMISSIONS.USER_MANAGE)({
        principal: account([ROLES.MEMBER]),
      } as never),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'PERMISSION_DENIED',
    })
  })

  it('allows principals with the required permission to continue', async () => {
    await expect(
      requirePermission(PERMISSIONS.USER_MANAGE)({
        principal: account([ROLES.ADMIN]),
      } as never),
    ).resolves.toBeUndefined()
  })

  it('allows a broader permission to satisfy a scoped read', async () => {
    await expect(
      requireAnyPermission(PERMISSIONS.BILLING_READ_SELF, PERMISSIONS.BILLING_READ_ALL)({
        principal: account([ROLES.ADMIN]),
      } as never),
    ).resolves.toBeUndefined()

    await expect(
      requireAnyPermission(PERMISSIONS.BILLING_READ_SELF, PERMISSIONS.BILLING_READ_ALL)({
        principal: account([ROLES.MEMBER]),
      } as never),
    ).resolves.toBeUndefined()
  })
})

const ROLE_ADMIN_EXPECTED_PERMISSIONS = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.GENERATION_TASK_READ,
  PERMISSIONS.ASSET_READ,
  PERMISSIONS.BILLING_READ_ALL,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.USAGE_READ_SELF,
  PERMISSIONS.USAGE_READ_SCOPED,
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.ADMIN_DASHBOARD_READ,
]

const ROLE_MEMBER_EXPECTED_PERMISSIONS = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_WRITE,
  PERMISSIONS.GENERATION_TASK_CREATE,
  PERMISSIONS.GENERATION_TASK_READ,
  PERMISSIONS.ASSET_READ,
  PERMISSIONS.ASSET_WRITE,
  PERMISSIONS.BILLING_READ_SELF,
  PERMISSIONS.USAGE_READ_SELF,
]

function account(roles: Array<(typeof ROLES)[keyof typeof ROLES]>): Principal {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'organization-1',
    roles,
    passwordResetRequired: false,
    emailVerified: true,
  }
}
