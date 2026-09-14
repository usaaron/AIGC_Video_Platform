import {
  changePasswordSchema,
  loginSchema,
  phoneLoginSchema,
  requestPhoneLoginCodeSchema,
  requestEmailVerificationSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SESSION_COOKIE } from '../../core/auth/provider.js'
import { sessionMetadataFromRequest } from '../../core/auth/requestMetadata.js'
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
      const { session, token } = await service.login(parsed.data, sessionMetadataFromRequest(request))
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

  app.post(
    '/auth/phone/code',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (request) => {
      const parsed = requestPhoneLoginCodeSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      throw new AppError(503, 'AUTH_PROVIDER_NOT_CONFIGURED', 'Phone verification login is not configured')
    },
  )

  app.post(
    '/auth/phone/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const parsed = phoneLoginSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      throw new AppError(503, 'AUTH_PROVIDER_NOT_CONFIGURED', 'Phone verification login is not configured')
    },
  )

  app.post('/auth/wechat/qr', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async () => {
    throw new AppError(503, 'AUTH_PROVIDER_NOT_CONFIGURED', 'WeChat QR login is not configured')
  })

  app.get('/auth/wechat/qr/:sessionId', async () => {
    throw new AppError(503, 'AUTH_PROVIDER_NOT_CONFIGURED', 'WeChat QR login is not configured')
  })

  app.post('/auth/logout', async (request, reply) => {
    await service.logout(request.cookies[SESSION_COOKIE], sessionMetadataFromRequest(request))
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
    if (!request.principal) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
    reply.header('Cache-Control', 'no-store')
    return await service.session(request.principal)
  })

  app.put(
    '/auth/password',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!request.principal) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
      const parsed = changePasswordSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      await service.changePassword(request.principal, parsed.data, sessionMetadataFromRequest(request))
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    },
  )

  app.post(
    '/auth/email-verification/request',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = requestEmailVerificationSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      reply.header('Cache-Control', 'no-store')
      return reply
        .code(202)
        .send(await service.requestEmailVerification(parsed.data, sessionMetadataFromRequest(request)))
    },
  )

  app.post(
    '/auth/email-verification/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = verifyEmailSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      await service.verifyEmail(parsed.data, sessionMetadataFromRequest(request))
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    },
  )

  app.post(
    '/auth/password/reset-request',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = requestPasswordResetSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      reply.header('Cache-Control', 'no-store')
      return reply
        .code(202)
        .send(await service.requestPasswordReset(parsed.data, sessionMetadataFromRequest(request)))
    },
  )

  app.post(
    '/auth/password/reset',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = resetPasswordSchema.safeParse(request.body)
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(parsed.error))
      await service.resetPassword(parsed.data, sessionMetadataFromRequest(request))
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    },
  )
}
