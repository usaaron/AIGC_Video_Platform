import { z } from 'zod'

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    AUTH_MODE: z.enum(['demo', 'oidc']).default('demo'),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'demo') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'Demo authentication is forbidden in production',
      })
    }
  })

export type AppConfig = z.infer<typeof configSchema>

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment)
}
