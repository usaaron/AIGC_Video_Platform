import type { AppConfig } from '../config.js'
import { AideosSeedanceProvider } from '../core/generation/aideosSeedanceProvider.js'
import type { AssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import { VolcArkAssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import { DeepSeekTextProvider } from '../core/generation/deepSeekTextProvider.js'
import type { ImageGenerationProvider } from '../core/generation/imageProvider.js'
import { TokenAdventImageProvider } from '../core/generation/tokenAdventImageProvider.js'
import type { TextGenerationProvider } from '../core/generation/textProvider.js'
import { TextGenerationProviderError, type TextGenerationRequest } from '../core/generation/textProvider.js'
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
      defaultTier: config.STRINGX_SEEDANCE_DEFAULT_TIER,
      tierModels: {
        mini: config.STRINGX_SEEDANCE_MINI_MODEL,
        fast: config.STRINGX_SEEDANCE_FAST_MODEL,
        pro: config.STRINGX_SEEDANCE_PRO_MODEL,
      },
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
  if (!config.TOKENADVENT_API_KEY) return null
  return new TokenAdventImageProvider({
    baseUrl: config.TOKENADVENT_BASE_URL,
    apiKey: config.TOKENADVENT_API_KEY,
    model: config.IMG2_MODEL,
    quality: config.IMG2_QUALITY,
    requestTimeoutMs: config.TOKENADVENT_REQUEST_TIMEOUT_MS,
  })
}

export function createTextProvider(config: AppConfig): TextGenerationProvider | null {
  const deepSeekProvider = config.DEEPSEEK_API_KEY
    ? new DeepSeekTextProvider({
        baseUrl: config.DEEPSEEK_BASE_URL,
        apiKey: config.DEEPSEEK_API_KEY,
        model: config.DEEPSEEK_MODEL,
        completionsPath: config.DEEPSEEK_CHAT_COMPLETIONS_PATH,
        requestTimeoutMs: config.DEEPSEEK_REQUEST_TIMEOUT_MS,
      })
    : null
  const gptProvider = config.TOKENADVENT_API_KEY
    ? new TokenAdventTextProvider({
        baseUrl: config.TOKENADVENT_BASE_URL,
        apiKey: config.TOKENADVENT_API_KEY,
        model: config.TEXT_MODEL,
        requestTimeoutMs: config.TOKENADVENT_REQUEST_TIMEOUT_MS,
      })
    : null
  if (!deepSeekProvider && !gptProvider) return null
  return new RoutedTextProvider(config.TEXT_MODEL, config.DEEPSEEK_MODEL, deepSeekProvider, gptProvider)
}

export function textProviderName(config: AppConfig): string {
  return isGptModel(config.TEXT_MODEL) ? 'tokenadvent-gpt' : 'deepseek-v3'
}

class RoutedTextProvider implements TextGenerationProvider {
  constructor(
    private readonly defaultModel: string,
    private readonly deepSeekModel: string,
    private readonly deepSeekProvider: TextGenerationProvider | null,
    private readonly gptProvider: TextGenerationProvider | null,
  ) {}

  generate(request: TextGenerationRequest): Promise<string> {
    const requestedModel = (request.model || this.defaultModel).trim()
    if (isGptModel(requestedModel)) {
      if (!this.gptProvider) throw modelNotConfigured(requestedModel)
      return this.gptProvider.generate({ ...request, model: requestedModel })
    }
    if (isDeepSeekModel(requestedModel)) {
      if (!this.deepSeekProvider) throw modelNotConfigured(requestedModel)
      return this.deepSeekProvider.generate({
        ...request,
        model: isDeepSeekPublicAlias(requestedModel) ? this.deepSeekModel : requestedModel,
      })
    }
    throw new TextGenerationProviderError(`文本模型 ${requestedModel} 尚未接入`)
  }
}

function isGptModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gpt-')
}

function isDeepSeekModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('deepseek')
}

function isDeepSeekPublicAlias(model: string): boolean {
  return ['deepseekv3', 'deepseek-v3'].includes(model.trim().toLowerCase())
}

function modelNotConfigured(model: string): TextGenerationProviderError {
  return new TextGenerationProviderError(`文本模型 ${model} 的 Provider 尚未配置`)
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
