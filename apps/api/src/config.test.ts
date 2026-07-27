import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('production configuration', () => {
  it('parses proxy and secure bootstrap settings', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://studio.example.com',
      TRUST_PROXY: 'true',
      AUTH_SECRET: 'a-unique-production-secret-with-32-characters',
      BOOTSTRAP_CREATOR_EMAIL: 'creator@example.com',
      BOOTSTRAP_CREATOR_PASSWORD: 'UniqueCreatorPassword123!',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'UniqueAdminPassword123!',
      STRINGX_API_KEY: 'production-video-token',
      TOKENADVENT_API_KEY: 'production-image-token',
    })

    expect(config.TRUST_PROXY).toBe(true)
    expect(config.WEB_ORIGIN).toBe('https://studio.example.com')
    expect(config.BOOTSTRAP_CREATOR_NAME).toBe('创作者')
    expect(config.BOOTSTRAP_DEMO_WORKSPACE).toBe(false)
    expect(config.DEMO_UNLIMITED_GENERATION_CONCURRENCY).toBe(false)
    expect(config.TASK_WORKER_MODE).toBe('in-process')
    expect(config.TEXT_MODEL).toBe('gpt-5.6')
  })

  it('enables practical unlimited concurrency only when explicitly configured', () => {
    expect(loadConfig({ DEMO_UNLIMITED_GENERATION_CONCURRENCY: 'true' })).toMatchObject({
      DEMO_UNLIMITED_GENERATION_CONCURRENCY: true,
    })
  })

  it('rejects development credentials in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('A unique AUTH_SECRET is required')
  })

  it('requires the selected video provider key in production', () => {
    const production = {
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://studio.example.com',
      AUTH_SECRET: 'a-unique-production-secret-with-32-characters',
      BOOTSTRAP_CREATOR_PASSWORD: 'UniqueCreatorPassword123!',
      BOOTSTRAP_ADMIN_PASSWORD: 'UniqueAdminPassword123!',
      TOKENADVENT_API_KEY: 'production-text-image-token',
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

  it('keeps the sample workspace opt-in for production', () => {
    const production = {
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://studio.example.com',
      AUTH_SECRET: 'a-unique-production-secret-with-32-characters',
      BOOTSTRAP_CREATOR_PASSWORD: 'UniqueCreatorPassword123!',
      BOOTSTRAP_ADMIN_PASSWORD: 'UniqueAdminPassword123!',
      STRINGX_API_KEY: 'production-video-token',
      TOKENADVENT_API_KEY: 'production-text-image-token',
      BOOTSTRAP_DEMO_WORKSPACE: 'true',
    }
    expect(loadConfig(production).BOOTSTRAP_DEMO_WORKSPACE).toBe(true)
  })

  it('rejects missing production text and image credentials', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://studio.example.com',
        AUTH_SECRET: 'a-unique-production-secret-with-32-characters',
        BOOTSTRAP_CREATOR_PASSWORD: 'UniqueCreatorPassword123!',
        BOOTSTRAP_ADMIN_PASSWORD: 'UniqueAdminPassword123!',
        STRINGX_API_KEY: 'production-video-token',
      }),
    ).toThrow('TOKENADVENT_API_KEY is required')
  })
})
