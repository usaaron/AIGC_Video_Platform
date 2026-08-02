import { afterEach, describe, expect, it, vi } from 'vitest'
import { canEditProjectSettings, canOpenAccountAdmin, getAdminConsoleUrl } from './access'

describe('account access helpers', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('opens the account admin only for elevated sessions with user management permission', () => {
    expect(
      canOpenAccountAdmin({
        account: { roles: ['owner'] },
        permissions: ['user.manage'],
      }),
    ).toBe(true)
    expect(
      canOpenAccountAdmin({
        account: { roles: ['super_admin'] },
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
        account: { roles: ['organization_admin'] },
        permissions: ['user.manage'],
      }),
    ).toBe(true)
    expect(
      canOpenAccountAdmin({
        account: { roles: ['member'] },
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

  it('builds the admin console URL used by the main app link', () => {
    expect(getAdminConsoleUrl()).toBe('http://localhost:5174/')
    expect(getAdminConsoleUrl('sessions')).toBe('http://localhost:5174/sessions')
  })

  it('supports a protected same-origin production admin path', () => {
    vi.stubEnv('VITE_ADMIN_CONSOLE_URL', '/admin/')
    expect(getAdminConsoleUrl()).toBe('/admin/')
    expect(getAdminConsoleUrl('/sessions')).toBe('/admin/sessions')
  })

  it('keeps the creative app admin entry scoped to elevated account managers', () => {
    const elevated = ['owner', 'super_admin', 'admin', 'organization_admin']
    for (const role of elevated) {
      expect(
        canOpenAccountAdmin({
          account: { roles: [role] },
          permissions: ['user.manage'],
        }),
      ).toBe(true)
    }
    expect(
      canOpenAccountAdmin({
        account: { roles: ['member'] },
        permissions: ['project.read', 'project.write'],
      }),
    ).toBe(false)
  })
})
