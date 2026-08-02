import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('password', () => {
  it('hashes and verifies passwords while rejecting malformed input', () => {
    const password = 'correct horse battery staple'
    const hash = hashPassword(password)

    expect(hash.split(':')).toHaveLength(2)
    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword('wrong horse battery staple', hash)).toBe(false)
    expect(verifyPassword(password, 'missing-separator')).toBe(false)
  })
})
