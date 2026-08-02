import { describe, expect, it } from 'vitest'
import { changePasswordSchema, passwordSchema, resetPasswordSchema } from './account.js'
import {
  createTenantInvitationSchema,
  registerAccountSchema,
  tenantInvitationSchema,
} from './accountManagement.js'

describe('account password contracts', () => {
  it('accepts eight-character passwords across registration and password updates', () => {
    expect(passwordSchema.safeParse('12345678').success).toBe(true)
    expect(
      registerAccountSchema.safeParse({
        token: 'invitation-token'.padEnd(32, '1'),
        name: '同名用户',
        email: 'member@example.com',
        password: '12345678',
        verificationCode: '123456',
      }).success,
    ).toBe(true)
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'old-pass',
        newPassword: 'new-pass',
      }).success,
    ).toBe(true)
    expect(
      resetPasswordSchema.safeParse({
        token: 'reset-token'.padEnd(32, '1'),
        newPassword: '12345678',
      }).success,
    ).toBe(true)
  })

  it('rejects passwords shorter than eight characters', () => {
    expect(passwordSchema.safeParse('1234567').success).toBe(false)
  })

  it('allows one-time registration invitations without a pre-bound email', () => {
    expect(
      createTenantInvitationSchema.safeParse({
        roles: ['member'],
      }).success,
    ).toBe(true)
    expect(
      tenantInvitationSchema.safeParse({
        id: 'invitation-open',
        tenantId: 'tenant-a',
        tenantName: 'Organization A',
        organizationId: 'tenant-a',
        organizationName: 'Organization A',
        email: null,
        roles: ['member'],
        status: 'pending',
        invitedByUserId: 'user-admin',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        acceptedAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })

  it('accepts new eight-digit invitation codes and legacy long codes', () => {
    const registration = {
      name: 'Member',
      email: 'member@example.com',
      password: '12345678',
      verificationCode: '123456',
    }
    expect(registerAccountSchema.safeParse({ ...registration, token: '01234567' }).success).toBe(true)
    expect(
      registerAccountSchema.safeParse({ ...registration, token: 'legacy-token'.padEnd(32, '1') }).success,
    ).toBe(true)
    expect(registerAccountSchema.safeParse({ ...registration, token: '1234567' }).success).toBe(false)
    expect(registerAccountSchema.safeParse({ ...registration, token: '123456789' }).success).toBe(false)
  })
})
