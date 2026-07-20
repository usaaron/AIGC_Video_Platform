import { z } from 'zod'

const booleanEnvSchema = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(defaultValue)
    .transform((value) => value === true || value === 'true')

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    API_PUBLIC_BASE_URL: z.union([z.literal(''), z.string().url()]).default(''),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    AUTH_MODE: z.enum(['local', 'demo', 'oidc']).default('local'),
    AUTH_SECRET: z.string().min(32).default('seqora-development-secret-change-me'),
    DATA_STORE: z.enum(['json', 'postgres']).default('json'),
    DATA_FILE: z.string().default('./data/app.json'),
    DATABASE_URL: z.string().default(''),
    TASK_QUEUE_DRIVER: z.enum(['inline', 'bullmq']).default('inline'),
    REDIS_URL: z.string().default(''),
    TASK_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
    TASK_QUEUE_TICK_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(1_000),
    STORAGE_DRIVER: z.enum(['local', 'gcs', 'oss']).default('local'),
    UPLOAD_DIR: z.string().default('./data/uploads'),
    GCS_BUCKET: z.string().default(''),
    OSS_REGION: z.string().default(''),
    OSS_BUCKET: z.string().default(''),
    OSS_ACCESS_KEY_ID: z.string().default(''),
    OSS_ACCESS_KEY_SECRET: z.string().default(''),
    OSS_ENDPOINT: z.string().default(''),
    OSS_INTERNAL: booleanEnvSchema(false),
    OSS_SECURE: booleanEnvSchema(true),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_048_576).max(52_428_800).default(10_485_760),
    GENERATED_ASSET_MAX_BYTES: z.coerce.number().int().min(1_048_576).max(1_073_741_824).default(104_857_600),
    SEEDANCE_API_BASE_URL: z.string().url().default('https://aideos.openrouter.icu'),
    SEEDANCE_API_KEY: z.string().default(''),
    SEEDANCE_MODEL: z.string().min(1).default('doubao-seedance-2-0-260128'),
    SEEDANCE_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(60_000).default(5_000),
    SEEDANCE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
    IMG2_API_BASE_URL: z.string().url().default('https://aideos.openrouter.icu'),
    IMG2_API_KEY: z.string().default(''),
    IMG2_MODEL: z.string().min(1).default('img2-default'),
    IMG2_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
    AUDIO_API_BASE_URL: z.string().url().default('https://aideos.openrouter.icu'),
    AUDIO_API_KEY: z.string().default(''),
    AUDIO_MODEL: z.string().min(1).default('audio-default'),
    AUDIO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
    FILM_EXPORT_FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
    FILM_EXPORT_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(1_800_000).default(300_000),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'demo') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'Demo authentication is forbidden in production',
      })
    }
    if (config.NODE_ENV === 'production' && isPlaceholderSecret(config.AUTH_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'A unique AUTH_SECRET is required in production',
      })
    }
    if (config.DATA_STORE === 'postgres' && !config.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DATA_STORE=postgres',
      })
    }
    if (config.NODE_ENV === 'production' && config.DATA_STORE === 'json') {
      context.addIssue({
        code: 'custom',
        path: ['DATA_STORE'],
        message: 'JSON data store is forbidden in production',
      })
    }
    if (config.TASK_QUEUE_DRIVER === 'bullmq' && !config.REDIS_URL) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when TASK_QUEUE_DRIVER=bullmq',
      })
    }
    if (config.NODE_ENV === 'production' && config.TASK_QUEUE_DRIVER === 'inline') {
      context.addIssue({
        code: 'custom',
        path: ['TASK_QUEUE_DRIVER'],
        message: 'Inline task execution is forbidden in production',
      })
    }
    if (config.STORAGE_DRIVER === 'gcs' && !config.GCS_BUCKET) {
      context.addIssue({ code: 'custom', path: ['GCS_BUCKET'], message: 'GCS_BUCKET is required' })
    }
    if (config.STORAGE_DRIVER === 'oss') {
      if (!config.OSS_BUCKET) {
        context.addIssue({ code: 'custom', path: ['OSS_BUCKET'], message: 'OSS_BUCKET is required' })
      }
      if (!config.OSS_ACCESS_KEY_ID) {
        context.addIssue({
          code: 'custom',
          path: ['OSS_ACCESS_KEY_ID'],
          message: 'OSS_ACCESS_KEY_ID is required',
        })
      }
      if (!config.OSS_ACCESS_KEY_SECRET) {
        context.addIssue({
          code: 'custom',
          path: ['OSS_ACCESS_KEY_SECRET'],
          message: 'OSS_ACCESS_KEY_SECRET is required',
        })
      }
      if (!config.OSS_REGION && !config.OSS_ENDPOINT) {
        context.addIssue({
          code: 'custom',
          path: ['OSS_REGION'],
          message: 'OSS_REGION or OSS_ENDPOINT is required',
        })
      }
    }
    if (config.NODE_ENV === 'production' && config.STORAGE_DRIVER === 'local') {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'Local upload storage is forbidden in production',
      })
    }
  })

export type AppConfig = z.infer<typeof configSchema>

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment)
}

function isPlaceholderSecret(secret: string): boolean {
  const normalized = secret.toLowerCase()
  return (
    normalized.includes('development') ||
    normalized.includes('replace-with') ||
    normalized.includes('change-me') ||
    normalized.includes('test-secret')
  )
}
