import { z } from 'zod'

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    AUTH_MODE: z.enum(['local', 'demo', 'oidc']).default('local'),
    AUTH_SECRET: z.string().min(32).default('seqora-development-secret-change-me'),
    DATA_FILE: z.string().default('./data/app.json'),
    STORAGE_DRIVER: z.enum(['local', 'gcs']).default('local'),
    UPLOAD_DIR: z.string().default('./data/uploads'),
    GCS_BUCKET: z.string().default(''),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_048_576).max(52_428_800).default(10_485_760),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'demo') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'Demo authentication is forbidden in production',
      })
    }
    if (config.NODE_ENV === 'production' && config.AUTH_SECRET.includes('development')) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'A unique AUTH_SECRET is required in production',
      })
    }
    if (config.STORAGE_DRIVER === 'gcs' && !config.GCS_BUCKET) {
      context.addIssue({ code: 'custom', path: ['GCS_BUCKET'], message: 'GCS_BUCKET is required' })
    }
  })

export type AppConfig = z.infer<typeof configSchema>

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment)
}
