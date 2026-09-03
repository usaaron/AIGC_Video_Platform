import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('production configuration', () => {
  it('parses proxy and secure bootstrap settings', () => {
    const config = loadConfig({
      ...productionConfig(),
      TRUST_PROXY: 'true',
      BOOTSTRAP_MEMBER_EMAIL: 'member@example.com',
    })

    expect(config.TRUST_PROXY).toBe(true)
    expect(config.WEB_ORIGIN).toBe('https://studio.example.com')
    expect(config.BOOTSTRAP_MEMBER_NAME).toBe('默认 C 端用户')
    expect(config.BOOTSTRAP_OWNER_NAME).toBe('平台所有者')
    expect(config.BOOTSTRAP_DEMO_WORKSPACE).toBe(false)
    expect(config.BOOTSTRAP_ACCOUNTS_ON_START).toBe(false)
    expect(config.EMAIL_PROVIDER).toBe('resend')
    expect(config.TEXT_MODEL).toBe('deepseek-v4-flash')
    expect(config.DASHSCOPE_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(config.DASHSCOPE_MODEL).toBe('deepseek-v4-flash-0731')
    expect(config.TASK_QUEUE_DRIVER).toBe('bullmq')
    expect(config.REDIS_URL).toBe('redis://redis:6379')
  })

  it('rejects development credentials in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('A unique AUTH_SECRET is required')
  })

  it('requires the selected video provider key in production', () => {
    const production = {
      ...productionConfig(),
      STRINGX_API_KEY: '',
      TOKENADVENT_API_KEY: 'production-text-image-token',
      REHDASU_API_KEY: 'production-text-token',
    }
    expect(() => loadConfig(production)).toThrow('STRINGX_API_KEY is required')
    expect(() => loadConfig({ ...production, VIDEO_PROVIDER: 'volc-ark' })).toThrow('ARK_API_KEY is required')
  })

  it('requires the asset library AK and SK as a pair', () => {
    expect(() => loadConfig({ VOLC_ACCESS_KEY: 'ak-only' })).toThrow(
      'VOLC_ACCESS_KEY and VOLC_SECRET_KEY must be configured together',
    )
    expect(loadConfig({ VOLC_ACCESS_KEY: 'ak', VOLC_SECRET_KEY: 'sk' })).toMatchObject({
      VOLC_ARK_PROJECT_NAME: 'default',
      VOLC_ASSET_BASE_URL: 'https://maas-ark.stringx.top',
    })
  })

  it('keeps tests on inline queue by default and validates bullmq Redis config', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).TASK_QUEUE_DRIVER).toBe('inline')
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        TASK_QUEUE_DRIVER: 'bullmq',
        REDIS_URL: '',
      }),
    ).toThrow('REDIS_URL is required when TASK_QUEUE_DRIVER=bullmq')
  })

  it('applies bounded database pool defaults and rejects an invalid minimum', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toMatchObject({
      DATABASE_POOL_MAX: 20,
      DATABASE_POOL_MIN: 0,
      DATABASE_POOL_IDLE_TIMEOUT_MS: 10_000,
      DATABASE_POOL_CONNECTION_TIMEOUT_MS: 5_000,
    })
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_POOL_MAX: '4',
        DATABASE_POOL_MIN: '5',
      }),
    ).toThrow('DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX')
  })

  it('normalizes explicitly disabled local service URLs', () => {
    expect(
      loadConfig({
        DATABASE_URL: ' ',
        REDIS_URL: ' ',
        TASK_QUEUE_DRIVER: 'inline',
      }),
    ).toMatchObject({ DATABASE_URL: '', REDIS_URL: '', TASK_QUEUE_DRIVER: 'inline' })
  })

  it('uses the explicit JSON store when Windows drops an empty database URL', () => {
    expect(
      loadConfig({
        DATA_FILE: 'C:/seqora/data/app.json',
        TASK_QUEUE_DRIVER: 'inline',
      }).DATABASE_URL,
    ).toBe('')
  })

  it('requires an explicit Redis URL for the production BullMQ queue', () => {
    expect(() =>
      loadConfig({
        ...productionConfig(),
        REDIS_URL: '',
      }),
    ).toThrow('REDIS_URL is required when TASK_QUEUE_DRIVER=bullmq')
  })

  it('requires Postgres for production identity, billing, admin and observability data', () => {
    expect(() =>
      loadConfig({
        ...productionConfig(),
        DATABASE_URL: '',
      }),
    ).toThrow('DATABASE_URL is required in production')
  })

  it('forbids startup account bootstrap in production', () => {
    expect(() =>
      loadConfig({
        ...productionConfig(),
        BOOTSTRAP_ACCOUNTS_ON_START: 'true',
      }),
    ).toThrow('BOOTSTRAP_ACCOUNTS_ON_START is forbidden in production')
  })

  it('requires real email delivery in production', () => {
    expect(() => loadConfig({ ...productionConfig(), EMAIL_PROVIDER: 'console' })).toThrow(
      'EMAIL_PROVIDER=resend is required in production',
    )
    expect(() => loadConfig({ ...productionConfig(), RESEND_API_KEY: '' })).toThrow(
      'RESEND_API_KEY is required',
    )
  })

  it('defaults to StringX and ignores removed legacy Seedance aliases', () => {
    expect(
      loadConfig({
        SEEDANCE_API_BASE_URL: 'https://legacy-seedance.example',
        SEEDANCE_API_KEY: 'legacy-token',
        SEEDANCE_MODEL: 'doubao-seedance-2-0-260128',
      }),
    ).toMatchObject({
      VIDEO_PROVIDER: 'stringx',
      STRINGX_BASE_URL: 'https://maas.stringx.top/api/v3',
      VIDEO_POLL_INTERVAL_MS: 5_000,
    })
  })

  it('forbids demo workspace bootstrap in production', () => {
    expect(() =>
      loadConfig({
        ...productionConfig(),
        BOOTSTRAP_DEMO_WORKSPACE: 'true',
      }),
    ).toThrow('BOOTSTRAP_DEMO_WORKSPACE is forbidden in production')
  })

  it('rejects missing production text and image credentials', () => {
    expect(() =>
      loadConfig({
        ...productionConfig(),
        TOKENADVENT_API_KEY: '',
      }),
    ).toThrow('SEQORA_IMAGE2_API_KEY or legacy TOKENADVENT_API_KEY is required')
  })

  it('supports Seqora image2 aliases while keeping legacy image variables as a fallback', () => {
    expect(
      loadConfig({
        NODE_ENV: 'test',
        SEQORA_IMAGE2_BASE_URL: 'https://image2.example.com',
        SEQORA_IMAGE2_API_KEY: 'seqora-image2-token',
        SEQORA_IMAGE2_MODEL: 'seqora-image2-live',
        TOKENADVENT_API_KEY: 'text-tokenadvent-token',
        IMG2_MODEL: 'legacy-img2-model',
      }),
    ).toMatchObject({
      SEQORA_IMAGE2_BASE_URL: 'https://image2.example.com',
      SEQORA_IMAGE2_API_KEY: 'seqora-image2-token',
      SEQORA_IMAGE2_MODEL: 'seqora-image2-live',
      SEQORA_IMAGE2_ASSIST_MODEL: 'gpt-5.4',
      TOKENADVENT_API_KEY: 'text-tokenadvent-token',
      IMG2_MODEL: 'legacy-img2-model',
    })

    expect(
      loadConfig({
        NODE_ENV: 'test',
        TOKENADVENT_BASE_URL: 'https://legacy-image2.example.com',
        TOKENADVENT_API_KEY: 'legacy-image2-token',
        IMG2_MODEL: 'legacy-img2-model',
      }),
    ).toMatchObject({
      SEQORA_IMAGE2_BASE_URL: 'https://legacy-image2.example.com',
      SEQORA_IMAGE2_API_KEY: 'legacy-image2-token',
      SEQORA_IMAGE2_MODEL: 'legacy-img2-model',
    })
  })

  it('requires the selected Rehdasu text provider key in production', () => {
    expect(() =>
      loadConfig({
        ...productionConfig(),
        REHDASU_API_KEY: '',
        TEXT_MODEL: 'glm-5.2',
      }),
    ).toThrow('REHDASU_API_KEY is required')
  })

  it('requires the independent DeepSeek V4 key only when that model is selected', () => {
    expect(() =>
      loadConfig({
        ...productionConfig(),
        TEXT_MODEL: 'deepseek-v4-flash',
        DEEPSEEK_V4_API_KEY: '',
      }),
    ).toThrow('DASHSCOPE_API_KEY or DEEPSEEK_V4_API_KEY is required')

    expect(
      loadConfig({
        ...productionConfig(),
        TEXT_MODEL: 'deepseek-v4-pro',
        DEEPSEEK_V4_API_KEY: 'production-deepseek-v4-token',
      }),
    ).toMatchObject({
      DEEPSEEK_V4_BASE_URL: 'https://hk.shanyoucloud.com',
      DEEPSEEK_V4_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_V4_CHAT_COMPLETIONS_PATH: '/v1/chat/completions',
    })
  })

  it('accepts the legacy text key as a Rehdasu migration fallback', () => {
    const config = loadConfig({
      ...productionConfig(),
      REHDASU_API_KEY: '',
      TEXT_API_KEY: 'legacy-rehdasu-token',
      TEXT_MODEL: 'glm-5.2',
    })

    expect(config.REHDASU_API_KEY).toBe('legacy-rehdasu-token')
  })

  it('accepts Bailian as the preferred DeepSeek V4 route', () => {
    const config = loadConfig({
      ...productionConfig(),
      DEEPSEEK_V4_API_KEY: '',
      DASHSCOPE_API_KEY: 'production-dashscope-token',
      TEXT_MODEL: 'deepseek-v4-flash',
    })

    expect(config.DASHSCOPE_API_KEY).toBe('production-dashscope-token')
    expect(config.DASHSCOPE_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(config.DASHSCOPE_MODEL).toBe('deepseek-v4-flash-0731')
  })
})

function productionConfig(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    WEB_ORIGIN: 'https://studio.example.com',
    AUTH_SECRET: 'a-unique-production-secret-with-32-characters',
    BILLING_WEBHOOK_SECRET: 'a-unique-billing-webhook-secret-32-chars',
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'Seqora <no-reply@example.com>',
    RESEND_API_KEY: 'resend-production-token',
    STRINGX_API_KEY: 'production-video-token',
    DEEPSEEK_V4_API_KEY: 'production-deepseek-v4-token',
    TOKENADVENT_API_KEY: 'production-image-token',
    REHDASU_API_KEY: 'production-text-token',
    REDIS_URL: 'redis://redis:6379',
    DATABASE_URL: 'postgres://seqora:production-password@postgres:5432/seqora',
    ...overrides,
  }
}
