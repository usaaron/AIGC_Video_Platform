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
    expect(config.TEXT_MODEL).toBe('glm-5.2')
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
    ).toThrow('TOKENADVENT_API_KEY is required')
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
    TOKENADVENT_API_KEY: 'production-image-token',
    REHDASU_API_KEY: 'production-text-token',
    REDIS_URL: 'redis://redis:6379',
    DATABASE_URL: 'postgres://seqora:production-password@postgres:5432/seqora',
    ...overrides,
  }
}
