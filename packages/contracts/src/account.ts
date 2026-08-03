import { z } from 'zod'
import { roleSchema } from './auth.js'

export const planSchema = z.enum(['free', 'member'])
export const emailVerificationStatusSchema = z.enum(['unverified', 'verified'])
export const passwordSchema = z.string().min(8).max(128)

export const accountSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(80),
  tenantId: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  roles: z.array(roleSchema).min(1),
  plan: planSchema,
  credits: z.number().int().nonnegative(),
  passwordResetRequired: z.boolean().default(false),
  emailVerified: z.boolean().default(false),
})

export const sessionSchema = z.object({
  account: accountSchema,
  permissions: z.array(z.string()),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
})

export const changePasswordSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current password',
  })

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
})

export const requestPasswordResetResultSchema = z.object({
  ok: z.literal(true),
  resetToken: z.string().min(32).optional(),
  expiresAt: z.string().datetime().optional(),
})

export const requestEmailVerificationSchema = z.object({
  email: z.string().email(),
})

export const requestEmailVerificationResultSchema = z.object({
  ok: z.literal(true),
  verificationToken: z.string().min(32).optional(),
  expiresAt: z.string().datetime().optional(),
})

export const verifyEmailSchema = z.object({
  token: z.string().min(32).max(256),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: passwordSchema,
})

export type Account = z.infer<typeof accountSchema>
export type Plan = z.infer<typeof planSchema>
export type EmailVerificationStatus = z.infer<typeof emailVerificationStatusSchema>
export type Session = z.infer<typeof sessionSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type RequestPasswordResetResult = z.infer<typeof requestPasswordResetResultSchema>
export type RequestEmailVerificationInput = z.infer<typeof requestEmailVerificationSchema>
export type RequestEmailVerificationResult = z.infer<typeof requestEmailVerificationResultSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
