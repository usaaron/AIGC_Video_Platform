import { loginSchema } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config.js'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import { AppError } from '../../core/errors.js'
import type { AuthService } from './service.js'

export async function registerAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
  secureCookies: boolean,
  authMode: AppConfig['AUTH_MODE'],
): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    if (authMode === 'oidc') {
      throw new AppError(
        501,
        'OIDC_LOGIN_DISABLED',
        'OIDC authentication does not use the local password login endpoint',
      )
    }

    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
    const { session, token } = await service.login(parsed.data)
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: 60 * 60 * 24 * 7,
    })
    return session
  })

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.code(204).send()
  })

  app.get('/auth/me', async (request) => {
    if (!request.principal) throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录')
    return service.session(request.principal)
  })
}
