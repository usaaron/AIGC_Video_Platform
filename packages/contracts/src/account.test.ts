import { describe, expect, it } from 'vitest'
import { changePasswordSchema, passwordSchema, resetPasswordSchema } from './account.js'
import { registerAccountSchema } from './accountManagement.js'

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
})
