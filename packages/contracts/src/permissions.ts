export const PERMISSIONS = {
  PROJECT_READ: 'project.read',
  PROJECT_WRITE: 'project.write',
  GENERATION_TASK_CREATE: 'generation.task.create',
  GENERATION_TASK_READ: 'generation.task.read',
  ASSET_READ: 'asset.read',
  ASSET_WRITE: 'asset.write',
  BILLING_READ_SELF: 'billing.read.self',
  BILLING_READ_ALL: 'billing.read.all',
  BILLING_MANAGE: 'billing.manage',
  USER_READ: 'user.read',
  USER_MANAGE: 'user.manage',
  ADMIN_DASHBOARD_READ: 'admin.dashboard.read',
  SYSTEM_CONFIG_MANAGE: 'system.config.manage',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ROLES = {
  MEMBER: 'member',
  ADMIN: 'admin',
  ORGANIZATION_ADMIN: 'organization_admin',
  ORGANIZATION_MEMBER: 'organization_member',
  SUPER_ADMIN: 'super_admin',
  OWNER: 'owner',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

const memberPermissions = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_WRITE,
  PERMISSIONS.GENERATION_TASK_CREATE,
  PERMISSIONS.GENERATION_TASK_READ,
  PERMISSIONS.ASSET_READ,
  PERMISSIONS.ASSET_WRITE,
  PERMISSIONS.BILLING_READ_SELF,
] as const

const adminPermissions = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.GENERATION_TASK_READ,
  PERMISSIONS.ASSET_READ,
  PERMISSIONS.BILLING_READ_ALL,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.ADMIN_DASHBOARD_READ,
] as const

const organizationAdminPermissions = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_WRITE,
  PERMISSIONS.GENERATION_TASK_CREATE,
  PERMISSIONS.GENERATION_TASK_READ,
  PERMISSIONS.ASSET_READ,
  PERMISSIONS.ASSET_WRITE,
  PERMISSIONS.BILLING_READ_ALL,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.ADMIN_DASHBOARD_READ,
] as const

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  member: memberPermissions,
  admin: adminPermissions,
  organization_admin: organizationAdminPermissions,
  organization_member: memberPermissions,
  super_admin: Object.values(PERMISSIONS).filter(
    (permission) => permission !== PERMISSIONS.SYSTEM_CONFIG_MANAGE,
  ),
  owner: Object.values(PERMISSIONS),
}
