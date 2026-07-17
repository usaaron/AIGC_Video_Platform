import { ROLE_PERMISSIONS, type Permission, type Principal } from '@seqora/contracts'
import type { preHandlerHookHandler } from 'fastify'
import { AppError } from '../errors.js'

export function permissionsFor(principal: Principal): Set<Permission> {
  return new Set(principal.roles.flatMap((role) => ROLE_PERMISSIONS[role]))
}

export function requirePermission(permission: Permission): preHandlerHookHandler {
  return async (request) => {
    if (!request.principal) {
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
    }
    if (!permissionsFor(request.principal).has(permission)) {
      throw new AppError(403, 'PERMISSION_DENIED', `Missing permission: ${permission}`)
    }
  }
}
