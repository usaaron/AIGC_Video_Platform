import { z } from 'zod'
import { ROLES } from './permissions.js'

export const roleSchema = z.enum([ROLES.CREATOR, ROLES.MEMBER, ROLES.ADMIN, ROLES.OWNER])

export const principalSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  roles: z.array(roleSchema).min(1),
})

export type Principal = z.infer<typeof principalSchema>
