import { resolve } from 'node:path'
import type { AppConfig } from './config.js'
import { AideosAudioProvider } from './core/generation/aideosAudioProvider.js'
import { AideosImageProvider } from './core/generation/aideosImageProvider.js'
import { AideosSeedanceProvider } from './core/generation/aideosSeedanceProvider.js'
import type { AudioGenerationProvider } from './core/generation/audioProvider.js'
import { FfmpegFilmExporter } from './core/generation/filmExporter.js'
import type { ImageGenerationProvider } from './core/generation/imageProvider.js'
import type { VideoGenerationProvider } from './core/generation/videoProvider.js'
import { GeneratedAssetWriter } from './core/jobs/generatedAssetWriter.js'
import { MediaReferenceResolver } from './core/jobs/mediaReferenceResolver.js'
import { GenerationTaskRunner } from './core/jobs/taskDispatcher.js'
import { PostgresTaskRuntimeStore, StoreTaskRuntimeStore } from './core/jobs/taskRuntimeStore.js'
import type { ObjectStorage } from './infra/objectStorage.js'
import { createObjectStorage } from './infra/objectStorage.js'
import { PostgresStateStore } from './infra/postgresStore.js'
import { AppStore, type StateStore } from './infra/store.js'

export function createStateStore(config: AppConfig): StateStore {
  if (config.DATA_STORE === 'postgres') return new PostgresStateStore(config.DATABASE_URL)
  return new AppStore(config.DATA_FILE === ':memory:' ? null : resolve(config.DATA_FILE))
}

export function createVideoProvider(config: AppConfig): VideoGenerationProvider | null {
  if (!config.SEEDANCE_API_KEY) return null
  return new AideosSeedanceProvider({
    baseUrl: config.SEEDANCE_API_BASE_URL,
    apiKey: config.SEEDANCE_API_KEY,
    defaultModel: config.SEEDANCE_MODEL,
    requestTimeoutMs: config.SEEDANCE_REQUEST_TIMEOUT_MS,
  })
}

export function createImageProvider(config: AppConfig): ImageGenerationProvider | null {
  const apiKey = config.IMG2_API_KEY || config.SEEDANCE_API_KEY
  if (!apiKey) return null
  return new AideosImageProvider({
    baseUrl: config.IMG2_API_BASE_URL || config.SEEDANCE_API_BASE_URL,
    apiKey,
    defaultModel: config.IMG2_MODEL,
    requestTimeoutMs: config.IMG2_REQUEST_TIMEOUT_MS,
  })
}

export function createAudioProvider(config: AppConfig): AudioGenerationProvider | null {
  const apiKey = config.AUDIO_API_KEY || config.SEEDANCE_API_KEY
  if (!apiKey) return null
  return new AideosAudioProvider({
    baseUrl: config.AUDIO_API_BASE_URL || config.SEEDANCE_API_BASE_URL,
    apiKey,
    defaultModel: config.AUDIO_MODEL,
    requestTimeoutMs: config.AUDIO_REQUEST_TIMEOUT_MS,
  })
}

export function createRuntimeObjectStorage(config: AppConfig): ObjectStorage {
  return createObjectStorage(config)
}

export function createTaskRunner(
  config: AppConfig,
  store: StateStore,
  objectStorage: ObjectStorage,
  videoProvider: VideoGenerationProvider | null,
  imageProvider: ImageGenerationProvider | null,
  audioProvider: AudioGenerationProvider | null,
): GenerationTaskRunner {
  return new GenerationTaskRunner(
    store,
    videoProvider,
    imageProvider,
    config.SEEDANCE_POLL_INTERVAL_MS,
    new GeneratedAssetWriter(objectStorage, fetch, config.GENERATED_ASSET_MAX_BYTES),
    new MediaReferenceResolver(store, config.API_PUBLIC_BASE_URL, config.AUTH_SECRET),
    audioProvider,
    new FfmpegFilmExporter(
      store,
      objectStorage,
      config.FILM_EXPORT_FFMPEG_PATH,
      config.FILM_EXPORT_TIMEOUT_MS,
    ),
    store instanceof PostgresStateStore
      ? new PostgresTaskRuntimeStore(store)
      : new StoreTaskRuntimeStore(store),
  )
}
