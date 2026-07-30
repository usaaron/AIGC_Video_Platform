import { describe, expect, it } from 'vitest'
import { canEditProjectSettings, canOpenAccountAdmin } from './access'

describe('account access helpers', () => {
  it('opens the account admin only for owner or admin sessions with user management permission', () => {
    expect(
      canOpenAccountAdmin({
        account: { roles: ['owner'] },
        permissions: ['user.manage'],
      }),
    ).toBe(true)
    expect(
      canOpenAccountAdmin({
        account: { roles: ['admin'] },
        permissions: ['user.manage'],
      }),
    ).toBe(true)
    expect(
      canOpenAccountAdmin({
        account: { roles: ['creator'] },
        permissions: ['user.manage'],
      }),
    ).toBe(false)
    expect(
      canOpenAccountAdmin({
        account: { roles: ['admin'] },
        permissions: ['user.read'],
      }),
    ).toBe(false)
  })

  it('detects project settings write access from permissions', () => {
    expect(canEditProjectSettings({ permissions: ['project.write'] })).toBe(true)
    expect(canEditProjectSettings({ permissions: ['project.read'] })).toBe(false)
    expect(canEditProjectSettings(null)).toBe(false)
  })
})
