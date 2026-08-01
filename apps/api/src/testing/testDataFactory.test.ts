import { describe, expect, it } from 'vitest'
import { createTestDataFactory } from './testDataFactory.js'

describe('test data factory', () => {
  it('generates unique names, emails and references within the same scope', () => {
    const factory = createTestDataFactory('security')

    const firstEmail = factory.email('member')
    const secondEmail = factory.email('member')
    expect(firstEmail).toMatch(/member-security-\d+@example\.test/)
    expect(secondEmail).toMatch(/member-security-\d+@example\.test/)
    expect(secondEmail).not.toBe(firstEmail)

    const firstTenant = factory.tenantName('Workspace')
    const secondTenant = factory.tenantName('Workspace')
    expect(firstTenant).toContain('Security')
    expect(secondTenant).toContain('Security')
    expect(secondTenant).not.toBe(firstTenant)

    expect(factory.referenceId('billing')).not.toBe(factory.referenceId('billing'))
    expect(factory.sessionLabel('browser')).toContain('Browser')
  })
})
