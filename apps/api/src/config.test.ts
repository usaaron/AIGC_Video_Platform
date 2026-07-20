import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const productionSecret = 'production-secret-with-at-least-32-characters'

describe('loadConfig object storage settings', () => {
  it('rejects JSON data store in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_SECRET: productionSecret,
        DATA_STORE: 'json',
        STORAGE_DRIVER: 'gcs',
        GCS_BUCKET: 'seqora-media',
      }),
    ).toThrow(/JSON data store/)
  })

  it('rejects inline task execution in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_SECRET: productionSecret,
        DATA_STORE: 'postgres',
        DATABASE_URL: 'postgres://seqora:seqora@127.0.0.1:5432/seqora',
        TASK_QUEUE_DRIVER: 'inline',
        STORAGE_DRIVER: 'gcs',
        GCS_BUCKET: 'seqora-media',
      }),
    ).toThrow(/Inline task execution/)
  })

  it('requires REDIS_URL when BullMQ is selected', () => {
    expect(() =>
      loadConfig({
        TASK_QUEUE_DRIVER: 'bullmq',
      }),
    ).toThrow(/REDIS_URL/)
  })

  it('requires DATABASE_URL for PostgreSQL data store', () => {
    expect(() =>
      loadConfig({
        DATA_STORE: 'postgres',
      }),
    ).toThrow(/DATABASE_URL/)
  })

  it('parses PostgreSQL data store settings', () => {
    const config = loadConfig({
      DATA_STORE: 'postgres',
      DATABASE_URL: 'postgres://seqora:seqora@127.0.0.1:5432/seqora',
    })

    expect(config.DATA_STORE).toBe('postgres')
    expect(config.DATABASE_URL).toBe('postgres://seqora:seqora@127.0.0.1:5432/seqora')
  })

  it('keeps audio and film export settings optional for local development', () => {
    const config = loadConfig({})

    expect(config.AUDIO_API_KEY).toBe('')
    expect(config.AUDIO_MODEL).toBe('audio-default')
    expect(config.FILM_EXPORT_FFMPEG_PATH).toBe('ffmpeg')
    expect(config.FILM_EXPORT_TIMEOUT_MS).toBe(300_000)
    expect(config.GENERATED_ASSET_MAX_BYTES).toBe(104_857_600)
  })

  it('rejects local upload storage in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_SECRET: productionSecret,
        DATA_STORE: 'postgres',
        DATABASE_URL: 'postgres://seqora:seqora@127.0.0.1:5432/seqora',
        TASK_QUEUE_DRIVER: 'bullmq',
        REDIS_URL: 'redis://127.0.0.1:6379',
        STORAGE_DRIVER: 'local',
      }),
    ).toThrow(/Local upload storage is forbidden/)
  })

  it('rejects placeholder auth secrets in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_SECRET: 'replace-with-at-least-32-random-characters',
        DATA_STORE: 'postgres',
        DATABASE_URL: 'postgres://seqora:seqora@127.0.0.1:5432/seqora',
        TASK_QUEUE_DRIVER: 'bullmq',
        REDIS_URL: 'redis://127.0.0.1:6379',
        STORAGE_DRIVER: 'gcs',
        GCS_BUCKET: 'seqora-media',
      }),
    ).toThrow(/unique AUTH_SECRET/)
  })

  it('requires OSS credentials when OSS storage is selected', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_SECRET: productionSecret,
        DATA_STORE: 'postgres',
        DATABASE_URL: 'postgres://seqora:seqora@127.0.0.1:5432/seqora',
        TASK_QUEUE_DRIVER: 'bullmq',
        REDIS_URL: 'redis://127.0.0.1:6379',
        STORAGE_DRIVER: 'oss',
      }),
    ).toThrow(/OSS_BUCKET/)
  })

  it('parses OSS settings for object storage deployments', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      AUTH_SECRET: productionSecret,
      DATA_STORE: 'postgres',
      DATABASE_URL: 'postgres://seqora:seqora@127.0.0.1:5432/seqora',
      TASK_QUEUE_DRIVER: 'bullmq',
      REDIS_URL: 'redis://127.0.0.1:6379',
      STORAGE_DRIVER: 'oss',
      OSS_REGION: 'oss-cn-hangzhou',
      OSS_BUCKET: 'seqora-media',
      OSS_ACCESS_KEY_ID: 'access-key-id',
      OSS_ACCESS_KEY_SECRET: 'access-key-secret',
      OSS_INTERNAL: 'true',
      OSS_SECURE: 'false',
    })

    expect(config.STORAGE_DRIVER).toBe('oss')
    expect(config.OSS_INTERNAL).toBe(true)
    expect(config.OSS_SECURE).toBe(false)
  })
})
