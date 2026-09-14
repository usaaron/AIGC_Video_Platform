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

export const phoneNumberSchema = z.string().regex(/^1[3-9]\d{9}$/, '请输入有效的中国大陆手机号')
export const phoneVerificationCodeSchema = z.string().regex(/^\d{6}$/, '验证码必须为 6 位数字')
export const requestPhoneLoginCodeSchema = z.object({ phone: phoneNumberSchema })
export const phoneLoginSchema = z.object({
  phone: phoneNumberSchema,
  verificationCode: phoneVerificationCodeSchema,
})
export const phoneLoginCodeResultSchema = z.object({
  ok: z.literal(true),
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().nonnegative(),
})
export const wechatQrLoginStartResultSchema = z.object({
  sessionId: z.string().min(16).max(256),
  qrCodeUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  pollAfterMs: z.number().int().min(500).max(30_000),
  status: z.literal('waiting'),
})
export const wechatQrLoginPollStatusSchema = z.enum(['waiting', 'scanned', 'expired', 'completed'])
export const wechatQrLoginPollResultSchema = z.object({
  sessionId: z.string().min(16).max(256),
  status: wechatQrLoginPollStatusSchema,
  message: z.string().max(200).optional(),
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
export type RequestPhoneLoginCodeInput = z.infer<typeof requestPhoneLoginCodeSchema>
export type PhoneLoginInput = z.infer<typeof phoneLoginSchema>
export type PhoneLoginCodeResult = z.infer<typeof phoneLoginCodeResultSchema>
export type WechatQrLoginStartResult = z.infer<typeof wechatQrLoginStartResultSchema>
export type WechatQrLoginPollResult = z.infer<typeof wechatQrLoginPollResultSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type RequestPasswordResetResult = z.infer<typeof requestPasswordResetResultSchema>
export type RequestEmailVerificationInput = z.infer<typeof requestEmailVerificationSchema>
export type RequestEmailVerificationResult = z.infer<typeof requestEmailVerificationResultSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
