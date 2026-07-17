import { z } from 'zod'
import { roleSchema } from './auth.js'

export const planSchema = z.enum(['free', 'member'])

export const accountSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(80),
  tenantId: z.string().min(1),
  roles: z.array(roleSchema).min(1),
  plan: planSchema,
  credits: z.number().int().nonnegative(),
})

export const sessionSchema = z.object({
  account: accountSchema,
  permissions: z.array(z.string()),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
})

export type Account = z.infer<typeof accountSchema>
export type Plan = z.infer<typeof planSchema>
export type Session = z.infer<typeof sessionSchema>
export type LoginInput = z.infer<typeof loginSchema>
