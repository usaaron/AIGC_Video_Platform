import type { AppConfig } from '../config.js'
import { AideosSeedanceProvider } from '../core/generation/aideosSeedanceProvider.js'
import type { AssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import { VolcArkAssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import type { ImageGenerationProvider } from '../core/generation/imageProvider.js'
import { TokenAdventImageProvider } from '../core/generation/tokenAdventImageProvider.js'
import type { TextGenerationProvider } from '../core/generation/textProvider.js'
import { TokenAdventTextProvider } from '../core/generation/tokenAdventTextProvider.js'
import type { VideoGenerationProvider, VideoProviderName } from '../core/generation/videoProvider.js'
import { StringXSeedanceProvider } from '../core/generation/stringXSeedanceProvider.js'
import { VolcArkSeedanceProvider } from '../core/generation/volcArkSeedanceProvider.js'

export function createVideoProvider(config: AppConfig): VideoGenerationProvider | null {
  if (config.VIDEO_PROVIDER === 'stringx') {
    if (!config.STRINGX_API_KEY) return null
    return new StringXSeedanceProvider({
      baseUrl: config.STRINGX_BASE_URL,
      apiKey: config.STRINGX_API_KEY,
      defaultModel: config.STRINGX_VIDEO_MODEL,
      requestTimeoutMs: config.STRINGX_REQUEST_TIMEOUT_MS,
    })
  }
  if (config.VIDEO_PROVIDER === 'aideos') {
    if (!config.AIDEOS_API_KEY) return null
    return new AideosSeedanceProvider({
      baseUrl: config.AIDEOS_BASE_URL,
      apiKey: config.AIDEOS_API_KEY,
      defaultModel: config.AIDEOS_VIDEO_MODEL,
      requestTimeoutMs: config.AIDEOS_REQUEST_TIMEOUT_MS,
      ffmpegPath: config.FFMPEG_PATH,
      lastFrameTimeoutMs: config.FILM_PREVIEW_TIMEOUT_MS,
    })
  }
  if (!config.ARK_API_KEY) return null
  return new VolcArkSeedanceProvider({
    baseUrl: config.ARK_API_BASE_URL,
    apiKey: config.ARK_API_KEY,
    defaultModel: config.ARK_VIDEO_MODEL,
    requestTimeoutMs: config.ARK_REQUEST_TIMEOUT_MS,
  })
}

export function videoProviderName(config: AppConfig): VideoProviderName {
  if (config.VIDEO_PROVIDER === 'stringx') return 'stringx-seedance'
  return config.VIDEO_PROVIDER === 'aideos' ? 'aideos-seedance' : 'volc-ark-seedance'
}

export function createImageProvider(config: AppConfig): ImageGenerationProvider | null {
  if (!config.TOKENADVENT_API_KEY && !(config.NANOBANANA_BASE_URL && config.NANOBANANA_API_KEY)) return null
  return new TokenAdventImageProvider({
    baseUrl: config.TOKENADVENT_BASE_URL,
    apiKey: config.TOKENADVENT_API_KEY,
    alternateApiKey: config.NANOBANANA_API_KEY,
    ...(config.NANOBANANA_BASE_URL ? { alternateBaseUrl: config.NANOBANANA_BASE_URL } : {}),
    alternateModels: ['nano-banana'],
    alternateModel: config.NANOBANANA_MODEL,
    model: config.IMG2_MODEL,
    quality: config.IMG2_QUALITY,
    requestTimeoutMs: config.TOKENADVENT_REQUEST_TIMEOUT_MS,
  })
}

export function createTextProvider(config: AppConfig): TextGenerationProvider | null {
  if (!config.TOKENADVENT_API_KEY && !config.TEXT_API_KEY) return null
  return new TokenAdventTextProvider({
    baseUrl: config.TOKENADVENT_BASE_URL,
    apiKey: config.TOKENADVENT_API_KEY || config.TEXT_API_KEY,
    alternateApiKey: config.TEXT_API_KEY,
    alternateModels: ['kimi-k3', 'glm-5.2', 'glm-5.2-fast'],
    model: config.TEXT_MODEL,
    requestTimeoutMs: config.TOKENADVENT_REQUEST_TIMEOUT_MS,
  })
}

export function createAssetLibraryProvider(config: AppConfig): AssetLibraryProvider | null {
  if (!config.VOLC_ACCESS_KEY || !config.VOLC_SECRET_KEY) return null
  return new VolcArkAssetLibraryProvider({
    baseUrl: config.VOLC_ASSET_BASE_URL,
    accessKey: config.VOLC_ACCESS_KEY,
    secretKey: config.VOLC_SECRET_KEY,
    projectName: config.VOLC_ARK_PROJECT_NAME,
    requestTimeoutMs: config.VOLC_ASSET_REQUEST_TIMEOUT_MS,
  })
}
