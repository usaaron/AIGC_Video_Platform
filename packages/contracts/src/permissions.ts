export const PERMISSIONS = {
  PROJECT_READ: 'project.read',
  PROJECT_WRITE: 'project.write',
  GENERATION_TASK_CREATE: 'generation.task.create',
  GENERATION_TASK_READ: 'generation.task.read',
  ASSET_READ: 'asset.read',
  ASSET_WRITE: 'asset.write',
  BILLING_READ_SELF: 'billing.read.self',
  BILLING_READ_ALL: 'billing.read.all',
  USER_READ: 'user.read',
  USER_MANAGE: 'user.manage',
  ADMIN_DASHBOARD_READ: 'admin.dashboard.read',
  SYSTEM_CONFIG_MANAGE: 'system.config.manage',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ROLES = {
  CREATOR: 'creator',
  MEMBER: 'member',
  ADMIN: 'admin',
  OWNER: 'owner',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  creator: [
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.PROJECT_WRITE,
    PERMISSIONS.GENERATION_TASK_CREATE,
    PERMISSIONS.GENERATION_TASK_READ,
    PERMISSIONS.ASSET_READ,
    PERMISSIONS.ASSET_WRITE,
    PERMISSIONS.BILLING_READ_SELF,
  ],
  member: [
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.PROJECT_WRITE,
    PERMISSIONS.GENERATION_TASK_CREATE,
    PERMISSIONS.GENERATION_TASK_READ,
    PERMISSIONS.ASSET_READ,
    PERMISSIONS.ASSET_WRITE,
    PERMISSIONS.BILLING_READ_SELF,
  ],
  admin: [
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.GENERATION_TASK_READ,
    PERMISSIONS.ASSET_READ,
    PERMISSIONS.BILLING_READ_ALL,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.ADMIN_DASHBOARD_READ,
  ],
  owner: Object.values(PERMISSIONS),
}
