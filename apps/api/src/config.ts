import { z } from 'zod'

const developmentAuthSecret = 'seqora-development-secret-change-me'
const developmentMemberPassword = 'MemberPassword123!'
const developmentOwnerPassword = 'OwnerPassword123!'
const developmentSuperAdminPassword = 'SuperAdmin123!'
const developmentAdminPassword = 'Admin123!'
const developmentDatabaseUrl = 'postgres://seqora:seqora_dev_password@127.0.0.1:5432/seqora_dev'
const developmentBillingWebhookSecret = 'seqora-development-billing-webhook-secret'
const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}, z.boolean())

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    PUBLIC_API_BASE_URL: z.union([z.literal(''), z.string().url()]).default(''),
    TRUST_PROXY: booleanFromEnvironment.default(false),
    RATE_LIMIT_MAX: z.coerce.number().int().min(30).max(10_000).default(300),
    TASK_QUEUE_DRIVER: z.enum(['inline', 'bullmq', 'none']).default('bullmq'),
    TASK_QUEUE_NAME: z.string().min(1).max(128).default('seqora-generation'),
    TASK_QUEUE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    TASK_QUEUE_POLL_INTERVAL_MS: z.coerce.number().int().min(900).max(60_000).default(5_000),
    REDIS_URL: z.union([z.literal(''), z.string().min(1)]).default('redis://127.0.0.1:6379'),
    AUTH_MODE: z.enum(['local', 'demo', 'oidc']).default('local'),
    AUTH_SECRET: z.string().min(32).default(developmentAuthSecret),
    BILLING_WEBHOOK_SECRET: z.string().min(32).default(developmentBillingWebhookSecret),
    EMAIL_PROVIDER: z.enum(['none', 'console', 'resend']).default('console'),
    EMAIL_FROM: z.string().min(1).max(256).default('序幕TV <no-reply@seqora.local>'),
    EMAIL_REPLY_TO: z.union([z.literal(''), z.string().email()]).default(''),
    RESEND_API_KEY: z.string().default(''),
    EMAIL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    EMAIL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    EMAIL_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(50).max(10_000).default(250),
    BILLING_ALERT_EMAILS: z.string().default(''),
    AUTH_PASSWORD_RESET_URL: z.union([z.literal(''), z.string().url()]).default(''),
    AUTH_EMAIL_VERIFICATION_URL: z.union([z.literal(''), z.string().url()]).default(''),
    AUTH_INVITATION_URL: z.union([z.literal(''), z.string().url()]).default(''),
    PAYMENT_PROVIDER: z.enum(['none', 'stripe']).default('none'),
    BILLING_SUCCESS_URL: z.union([z.literal(''), z.string().url()]).default(''),
    BILLING_CANCEL_URL: z.union([z.literal(''), z.string().url()]).default(''),
    STRIPE_SECRET_KEY: z.string().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().default(''),
    STRIPE_MEMBER_PRICE_ID: z.string().default(''),
    STRIPE_CREDIT_PRICE_ID: z.string().default(''),
    STRIPE_CREDIT_PACK_CREDITS: z.coerce.number().int().positive().max(1_000_000).default(100),
    DATABASE_URL: z.union([z.literal(''), z.string().min(1)]).default(''),
    BOOTSTRAP_MEMBER_NAME: z.string().min(1).max(80).default('默认 C 端用户'),
    BOOTSTRAP_MEMBER_EMAIL: z.string().email().default('member@seqora.local'),
    BOOTSTRAP_MEMBER_PASSWORD: z.string().min(12).max(128).default(developmentMemberPassword),
    BOOTSTRAP_OWNER_NAME: z.string().min(1).max(80).default('平台所有者'),
    BOOTSTRAP_OWNER_EMAIL: z.string().email().default('owner@seqora.local'),
    BOOTSTRAP_OWNER_PASSWORD: z.string().min(12).max(128).default(developmentOwnerPassword),
    BOOTSTRAP_SUPER_ADMIN_NAME: z.string().min(1).max(80).default('超级管理员'),
    BOOTSTRAP_SUPER_ADMIN_EMAIL: z.string().email().default('superadmin@seqora.local'),
    BOOTSTRAP_SUPER_ADMIN_PASSWORD: z.string().min(12).max(128).default(developmentSuperAdminPassword),
    BOOTSTRAP_ADMIN_NAME: z.string().min(1).max(80).default('平台管理员'),
    BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('admin@seqora.local'),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128).default(developmentAdminPassword),
    BOOTSTRAP_ACCOUNTS_ON_START: booleanFromEnvironment.default(true),
    BOOTSTRAP_DEMO_WORKSPACE: booleanFromEnvironment.default(true),
    DATA_FILE: z.string().default('./data/app.json'),
    STORAGE_DRIVER: z.enum(['local', 'gcs']).default('local'),
    UPLOAD_DIR: z.string().default('./data/uploads'),
    GCS_BUCKET: z.string().default(''),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_048_576).max(52_428_800).default(10_485_760),
    VIDEO_PROVIDER: z.enum(['stringx', 'volc-ark']).default('stringx'),
    STRINGX_BASE_URL: z.string().url().default('https://maas.stringx.top/api/v3'),
    STRINGX_API_KEY: z.string().default(''),
    STRINGX_VIDEO_MODEL: z.string().min(1).default('doubao-seedance-2-0-260128'),
    STRINGX_SEEDANCE_DEFAULT_TIER: z.enum(['mini', 'fast', 'pro']).default('fast'),
    STRINGX_SEEDANCE_MINI_MODEL: z.string().min(1).default('doubao-seedance-2-0-260128'),
    STRINGX_SEEDANCE_FAST_MODEL: z.string().min(1).default('doubao-seedance-2-0-260128'),
    STRINGX_SEEDANCE_PRO_MODEL: z.string().min(1).default('doubao-seedance-2-0-260128'),
    STRINGX_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(120_000),
    VIDEO_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(60_000).default(5_000),
    VIDEO_PROCESSING_STALL_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(1_800_000).default(360_000),
    ARK_API_BASE_URL: z.string().url().default('https://ark.cn-beijing.volces.com/api/v3'),
    ARK_API_KEY: z.string().default(''),
    ARK_VIDEO_MODEL: z.string().min(1).default('doubao-seedance-2-0-260128'),
    ARK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(120_000),
    VOLC_ASSET_BASE_URL: z.string().url().default('https://maas-ark.stringx.top'),
    VOLC_ACCESS_KEY: z.string().default(''),
    VOLC_SECRET_KEY: z.string().default(''),
    VOLC_ARK_PROJECT_NAME: z.string().min(1).max(128).default('default'),
    ASSET_LIBRARY_CONSOLE_URL: z.union([z.literal(''), z.string().url()]).default(''),
    VOLC_ASSET_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
    FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
    FILM_PREVIEW_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(1_800_000).default(600_000),
    DEEPSEEK_BASE_URL: z.string().url().default('https://maas.stringx.top'),
    DEEPSEEK_API_KEY: z.string().default(''),
    DEEPSEEK_MODEL: z.string().min(1).default('deepseekV3'),
    DEEPSEEK_CHAT_COMPLETIONS_PATH: z.string().min(1).default('/api/v1/chat/completions'),
    DEEPSEEK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(180_000),
    REHDASU_BASE_URL: z.string().url().default('https://tokenadvent.com'),
    REHDASU_API_KEY: z.string().default(''),
    REHDASU_MODEL: z.string().min(1).default('glm-5.2'),
    REHDASU_CHAT_COMPLETIONS_PATH: z.string().min(1).default('/v1/chat/completions'),
    REHDASU_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(180_000),
    TOKENADVENT_BASE_URL: z.string().url().default('https://tokenadvent.com'),
    TOKENADVENT_API_KEY: z.string().default(''),
    IMG2_MODEL: z.string().min(1).default('gpt-image-2'),
    IMG2_QUALITY: z.enum(['low', 'medium', 'high']).default('low'),
    TEXT_MODEL: z.string().min(1).default('glm-5.2'),
    TOKENADVENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(180_000),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'demo') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'Demo authentication is forbidden in production',
      })
    }
    if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message:
          'DATABASE_URL is required in production; identity, billing, admin and observability data must use Postgres',
      })
    }
    if (config.NODE_ENV === 'production' && config.AUTH_SECRET === developmentAuthSecret) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'A unique AUTH_SECRET is required in production',
      })
    }
    if (
      config.NODE_ENV === 'production' &&
      config.BILLING_WEBHOOK_SECRET === developmentBillingWebhookSecret
    ) {
      context.addIssue({
        code: 'custom',
        path: ['BILLING_WEBHOOK_SECRET'],
        message: 'A unique BILLING_WEBHOOK_SECRET is required in production',
      })
    }
    if (config.NODE_ENV === 'production' && !config.WEB_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'HTTPS WEB_ORIGIN is required in production',
      })
    }
    if (config.NODE_ENV === 'production' && config.EMAIL_PROVIDER !== 'resend') {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'EMAIL_PROVIDER=resend is required in production',
      })
    }
    if (config.EMAIL_PROVIDER === 'resend' && !config.RESEND_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
      })
    }
    if (config.NODE_ENV === 'production' && /@(?:seqora\.local|localhost)(?:>|$)/i.test(config.EMAIL_FROM)) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'A verified production sender domain is required in EMAIL_FROM',
      })
    }
    if (config.NODE_ENV === 'production') {
      for (const key of ['AUTH_PASSWORD_RESET_URL', 'AUTH_EMAIL_VERIFICATION_URL'] as const) {
        if (config[key].startsWith('https://')) continue
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must use HTTPS in production`,
        })
      }
    }
    if (config.TASK_QUEUE_DRIVER === 'bullmq' && !config.REDIS_URL) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when TASK_QUEUE_DRIVER=bullmq',
      })
    }
    if (config.PAYMENT_PROVIDER === 'stripe' && !config.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when PAYMENT_PROVIDER=stripe',
      })
    }
    if (config.PAYMENT_PROVIDER === 'stripe') {
      for (const key of [
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_MEMBER_PRICE_ID',
        'STRIPE_CREDIT_PRICE_ID',
      ] as const) {
        if (config[key]) continue
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when PAYMENT_PROVIDER=stripe`,
        })
      }
    }
    if (config.NODE_ENV === 'production') {
      if (config.BOOTSTRAP_ACCOUNTS_ON_START) {
        context.addIssue({
          code: 'custom',
          path: ['BOOTSTRAP_ACCOUNTS_ON_START'],
          message:
            'BOOTSTRAP_ACCOUNTS_ON_START is forbidden in production; run `pnpm --filter @seqora/api accounts:init` explicitly after db:migrate',
        })
      }
      if (config.BOOTSTRAP_DEMO_WORKSPACE) {
        context.addIssue({
          code: 'custom',
          path: ['BOOTSTRAP_DEMO_WORKSPACE'],
          message: 'BOOTSTRAP_DEMO_WORKSPACE is forbidden in production; demo seed data is development-only',
        })
      }
    }
    if (config.BOOTSTRAP_MEMBER_EMAIL === config.BOOTSTRAP_ADMIN_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_ADMIN_EMAIL'],
        message: 'Bootstrap accounts must use different email addresses',
      })
    }
    if (config.BOOTSTRAP_MEMBER_EMAIL === config.BOOTSTRAP_OWNER_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_OWNER_EMAIL'],
        message: 'Bootstrap accounts must use different email addresses',
      })
    }
    if (config.BOOTSTRAP_MEMBER_EMAIL === config.BOOTSTRAP_SUPER_ADMIN_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_SUPER_ADMIN_EMAIL'],
        message: 'Bootstrap accounts must use different email addresses',
      })
    }
    if (config.BOOTSTRAP_OWNER_EMAIL === config.BOOTSTRAP_SUPER_ADMIN_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_SUPER_ADMIN_EMAIL'],
        message: 'Bootstrap accounts must use different email addresses',
      })
    }
    if (config.BOOTSTRAP_SUPER_ADMIN_EMAIL === config.BOOTSTRAP_ADMIN_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_ADMIN_EMAIL'],
        message: 'Bootstrap accounts must use different email addresses',
      })
    }
    if (config.BOOTSTRAP_OWNER_EMAIL === config.BOOTSTRAP_ADMIN_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_ADMIN_EMAIL'],
        message: 'Bootstrap accounts must use different email addresses',
      })
    }
    if (config.STORAGE_DRIVER === 'gcs' && !config.GCS_BUCKET) {
      context.addIssue({ code: 'custom', path: ['GCS_BUCKET'], message: 'GCS_BUCKET is required' })
    }
    if (config.NODE_ENV === 'production' && config.VIDEO_PROVIDER === 'stringx' && !config.STRINGX_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['STRINGX_API_KEY'],
        message: 'STRINGX_API_KEY is required for the selected production video provider',
      })
    }
    if (config.NODE_ENV === 'production' && config.VIDEO_PROVIDER === 'volc-ark' && !config.ARK_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['ARK_API_KEY'],
        message: 'ARK_API_KEY is required for the selected production video provider',
      })
    }
    if (
      config.NODE_ENV === 'production' &&
      config.TEXT_MODEL.toLowerCase().startsWith('deepseek') &&
      !config.DEEPSEEK_API_KEY
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DEEPSEEK_API_KEY'],
        message: 'DEEPSEEK_API_KEY or STRINGX_API_KEY is required for production text generation',
      })
    }
    if (
      config.NODE_ENV === 'production' &&
      isRehdasuTextModel(config.TEXT_MODEL) &&
      !config.REHDASU_API_KEY
    ) {
      context.addIssue({
        code: 'custom',
        path: ['REHDASU_API_KEY'],
        message: 'REHDASU_API_KEY is required for the selected production text model',
      })
    }
    if (config.NODE_ENV === 'production' && !config.TOKENADVENT_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['TOKENADVENT_API_KEY'],
        message: 'TOKENADVENT_API_KEY is required for production GPT Image 2 generation',
      })
    }
    if (Boolean(config.VOLC_ACCESS_KEY) !== Boolean(config.VOLC_SECRET_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['VOLC_SECRET_KEY'],
        message: 'VOLC_ACCESS_KEY and VOLC_SECRET_KEY must be configured together',
      })
    }
  })

export type AppConfig = z.infer<typeof configSchema>

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const useExplicitJsonStore =
    environment.NODE_ENV !== 'production' &&
    Boolean(environment.DATA_FILE?.trim()) &&
    environment.TASK_QUEUE_DRIVER === 'inline' &&
    environment.DATABASE_URL === undefined

  return configSchema.parse({
    ...environment,
    TASK_QUEUE_DRIVER:
      environment.TASK_QUEUE_DRIVER ?? (environment.NODE_ENV === 'test' ? 'inline' : 'bullmq'),
    REDIS_URL:
      environment.REDIS_URL !== undefined
        ? environment.REDIS_URL.trim()
        : environment.NODE_ENV === 'production'
          ? ''
          : undefined,
    DATABASE_URL:
      environment.DATABASE_URL !== undefined
        ? environment.DATABASE_URL.trim()
        : useExplicitJsonStore
          ? ''
          : environment.NODE_ENV === 'production'
            ? ''
            : developmentDatabaseUrl,
    BOOTSTRAP_MEMBER_NAME:
      environment.BOOTSTRAP_MEMBER_NAME ??
      (environment.NODE_ENV === 'production' ? '默认 C 端用户' : '默认成员'),
    BOOTSTRAP_SUPER_ADMIN_NAME:
      environment.BOOTSTRAP_SUPER_ADMIN_NAME ??
      (environment.NODE_ENV === 'production' ? '超级管理员' : '超级管理员'),
    BOOTSTRAP_DEMO_WORKSPACE:
      environment.BOOTSTRAP_DEMO_WORKSPACE ?? (environment.NODE_ENV === 'production' ? 'false' : 'true'),
    BOOTSTRAP_ACCOUNTS_ON_START:
      environment.BOOTSTRAP_ACCOUNTS_ON_START ?? (environment.NODE_ENV === 'production' ? 'false' : 'true'),
    AUTH_PASSWORD_RESET_URL:
      environment.AUTH_PASSWORD_RESET_URL ??
      `${(environment.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '')}/reset-password`,
    AUTH_EMAIL_VERIFICATION_URL:
      environment.AUTH_EMAIL_VERIFICATION_URL ??
      `${(environment.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '')}/verify-email`,
    BILLING_ALERT_EMAILS: normalizeCsv(environment.BILLING_ALERT_EMAILS),
    AUTH_INVITATION_URL:
      environment.AUTH_INVITATION_URL ??
      `${(environment.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '')}/register`,
    VIDEO_POLL_INTERVAL_MS: environment.VIDEO_POLL_INTERVAL_MS || environment.ARK_POLL_INTERVAL_MS,
    DEEPSEEK_API_KEY: environment.DEEPSEEK_API_KEY || environment.STRINGX_API_KEY,
    STRINGX_SEEDANCE_MINI_MODEL: environment.STRINGX_SEEDANCE_MINI_MODEL || environment.STRINGX_VIDEO_MODEL,
    STRINGX_SEEDANCE_FAST_MODEL: environment.STRINGX_SEEDANCE_FAST_MODEL || environment.STRINGX_VIDEO_MODEL,
    STRINGX_SEEDANCE_PRO_MODEL: environment.STRINGX_SEEDANCE_PRO_MODEL || environment.STRINGX_VIDEO_MODEL,
  })
}

function isRehdasuTextModel(model: string): boolean {
  return /^(glm-5\.2|glm-5\.2-fast|kimi-k3|kimi-k3-thinking)$/i.test(model.trim())
}

function normalizeCsv(value: string | undefined): string {
  return value?.trim() ?? ''
}
