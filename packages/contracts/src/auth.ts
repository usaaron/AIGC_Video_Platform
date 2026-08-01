import { z } from 'zod'
import { ROLES } from './permissions.js'

export const roleSchema = z.enum([
  ROLES.MEMBER,
  ROLES.ADMIN,
  ROLES.ORGANIZATION_ADMIN,
  ROLES.ORGANIZATION_MEMBER,
  ROLES.SUPER_ADMIN,
  ROLES.OWNER,
])

export const principalSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  roles: z.array(roleSchema).min(1),
  passwordResetRequired: z.boolean().optional(),
})

export type Principal = z.infer<typeof principalSchema>
