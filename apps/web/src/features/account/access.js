const accountAdminRoles = new Set(['owner', 'admin'])

export function canOpenAccountAdmin(session) {
  const roles = session?.account?.roles ?? []
  const permissions = session?.permissions ?? []
  return roles.some((role) => accountAdminRoles.has(role)) && permissions.includes('user.manage')
}

export function canEditProjectSettings(session) {
  return session?.permissions?.includes('project.write') ?? false
}
