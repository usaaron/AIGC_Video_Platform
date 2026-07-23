import { changePasswordSchema, loginSchema } from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import { AppError } from '../../core/errors.js'
import type { AuthService } from './service.js'

export async function registerAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
  secureCookies: boolean,
): Promise<void> {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      const { session, token } = service.login(parsed.data)
      reply.header('Cache-Control', 'no-store')
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: secureCookies,
        maxAge: 60 * 60 * 24 * 7,
      })
      return session
    },
  )

  app.post('/auth/logout', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookies,
    })
    return reply.code(204).send()
  })

  app.get('/auth/me', async (request, reply) => {
    if (!request.principal) throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录')
    reply.header('Cache-Control', 'no-store')
    return service.session(request.principal)
  })

  app.put(
    '/auth/password',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!request.principal) throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录')
      const parsed = changePasswordSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      await service.changePassword(request.principal, parsed.data)
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    },
  )
}
