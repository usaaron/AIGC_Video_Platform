import type { Plan, Role } from '@seqora/contracts'
import type { AppConfig } from '../config.js'

export const systemTenantId = 'tenant-seqora-demo'

export type BootstrapAccount = {
  id: string
  name: string
  email: string
  password: string
  roles: Role[]
  plan: Plan
  credits: number
}

export function createBootstrapAccounts(config: AppConfig): BootstrapAccount[] {
  return [
    {
      id: 'user-member',
      name: config.BOOTSTRAP_MEMBER_NAME,
      email: config.BOOTSTRAP_MEMBER_EMAIL,
      password: config.BOOTSTRAP_MEMBER_PASSWORD,
      roles: ['member'],
      plan: 'free',
      credits: 286,
    },
    {
      id: 'user-owner',
      name: config.BOOTSTRAP_OWNER_NAME,
      email: config.BOOTSTRAP_OWNER_EMAIL,
      password: config.BOOTSTRAP_OWNER_PASSWORD,
      roles: ['owner'],
      plan: 'member',
      credits: 1_000,
    },
    {
      id: 'user-super-admin',
      name: config.BOOTSTRAP_SUPER_ADMIN_NAME,
      email: config.BOOTSTRAP_SUPER_ADMIN_EMAIL,
      password: config.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
      roles: ['super_admin'],
      plan: 'member',
      credits: 1_000,
    },
    {
      id: 'user-admin',
      name: config.BOOTSTRAP_ADMIN_NAME,
      email: config.BOOTSTRAP_ADMIN_EMAIL,
      password: config.BOOTSTRAP_ADMIN_PASSWORD,
      roles: ['admin'],
      plan: 'member',
      credits: 1_000,
    },
  ]
}

export function bootstrapMembershipId(userId: string, tenantId = systemTenantId): string {
  return `membership-${tenantId}-${userId}`
}

export function bootstrapIdentityId(userId: string): string {
  return `identity-${userId}`
}
