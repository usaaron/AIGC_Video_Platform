const accountAdminRoles = new Set(['owner', 'super_admin', 'admin', 'organization_admin'])
const defaultAdminConsoleUrl = 'http://localhost:5174/'

export function canOpenAccountAdmin(session) {
  const roles = session?.account?.roles ?? []
  const permissions = session?.permissions ?? []
  return roles.some((role) => accountAdminRoles.has(role)) && permissions.includes('user.manage')
}

export function getAdminConsoleUrl(path = '') {
  const base = import.meta.env?.VITE_ADMIN_CONSOLE_URL || defaultAdminConsoleUrl
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return new URL(path, normalizedBase).toString()
}

export function canEditProjectSettings(session) {
  return session?.permissions?.includes('project.write') ?? false
}
