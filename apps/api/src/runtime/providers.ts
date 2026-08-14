import type { AppConfig } from '../config.js'
import { observeProviderCall } from '../core/observability/metrics.js'
import type { AssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import { VolcArkAssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import { DeepSeekTextProvider } from '../core/generation/deepSeekTextProvider.js'
import type { ImageGenerationProvider } from '../core/generation/imageProvider.js'
import { TokenAdventImageProvider } from '../core/generation/tokenAdventImageProvider.js'
import type { TextGenerationProvider } from '../core/generation/textProvider.js'
import { TextGenerationProviderError, type TextGenerationRequest } from '../core/generation/textProvider.js'
import { RehdasuTextProvider } from '../core/generation/rehdasuTextProvider.js'
import { TokenAdventTextProvider } from '../core/generation/tokenAdventTextProvider.js'
import type { VideoGenerationProvider, VideoProviderName } from '../core/generation/videoProvider.js'
import { StringXSeedanceProvider } from '../core/generation/stringXSeedanceProvider.js'
import { VolcArkSeedanceProvider } from '../core/generation/volcArkSeedanceProvider.js'

export type RuntimeProviderOverrides = {
  videoProvider?: VideoGenerationProvider | null
  imageProvider?: ImageGenerationProvider | null
  textProvider?: TextGenerationProvider | null
  assetLibraryProvider?: AssetLibraryProvider | null
}

export type RuntimeProviders = {
  videoProvider: VideoGenerationProvider | null
  imageProvider: ImageGenerationProvider | null
  textProvider: TextGenerationProvider | null
  assetLibraryProvider: AssetLibraryProvider | null
}

export function createRuntimeProviders(
  config: AppConfig,
  overrides: RuntimeProviderOverrides = {},
): RuntimeProviders {
  return {
    videoProvider:
      overrides.videoProvider === undefined ? createVideoProvider(config) : overrides.videoProvider,
    imageProvider:
      overrides.imageProvider === undefined ? createImageProvider(config) : overrides.imageProvider,
    textProvider: overrides.textProvider === undefined ? createTextProvider(config) : overrides.textProvider,
    assetLibraryProvider:
      overrides.assetLibraryProvider === undefined
        ? createAssetLibraryProvider(config)
        : overrides.assetLibraryProvider,
  }
}

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
  return 'volc-ark-seedance'
}

export function createImageProvider(config: AppConfig): ImageGenerationProvider | null {
  if (!config.SEQORA_IMAGE2_API_KEY) return null
  return new TokenAdventImageProvider({
    baseUrl: config.SEQORA_IMAGE2_BASE_URL,
    apiKey: config.SEQORA_IMAGE2_API_KEY,
    model: config.SEQORA_IMAGE2_MODEL,
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
  const rehdasuProvider = config.REHDASU_API_KEY
    ? new RehdasuTextProvider({
        baseUrl: config.REHDASU_BASE_URL,
        apiKey: config.REHDASU_API_KEY,
        model: config.REHDASU_MODEL,
        completionsPath: config.REHDASU_CHAT_COMPLETIONS_PATH,
        requestTimeoutMs: config.REHDASU_REQUEST_TIMEOUT_MS,
      })
    : null
  if (!deepSeekProvider && !gptProvider && !rehdasuProvider) return null
  return new RoutedTextProvider(
    config.TEXT_MODEL,
    config.DEEPSEEK_MODEL,
    config.REHDASU_MODEL,
    deepSeekProvider,
    gptProvider,
    rehdasuProvider,
  )
}

export function textProviderName(config: AppConfig): string {
  if (isRehdasuModel(config.TEXT_MODEL)) return 'rehdasu'
  return isGptModel(config.TEXT_MODEL) ? 'tokenadvent-gpt' : 'deepseek-v3'
}

class RoutedTextProvider implements TextGenerationProvider {
  constructor(
    private readonly defaultModel: string,
    private readonly deepSeekModel: string,
    private readonly rehdasuModel: string,
    private readonly deepSeekProvider: TextGenerationProvider | null,
    private readonly gptProvider: TextGenerationProvider | null,
    private readonly rehdasuProvider: TextGenerationProvider | null,
  ) {}

  generate(request: TextGenerationRequest): Promise<string> {
    const requestedModel = (request.model || this.defaultModel).trim()
    if (isGptModel(requestedModel)) {
      if (!this.gptProvider) throw modelNotConfigured(requestedModel)
      return observeProviderCall(
        { provider: 'tokenadvent-gpt', operation: 'text.generate', ...request.usageContext },
        () => this.gptProvider!.generate({ ...request, model: requestedModel }),
      )
    }
    if (isDeepSeekModel(requestedModel)) {
      if (!this.deepSeekProvider) throw modelNotConfigured(requestedModel)
      return observeProviderCall(
        { provider: 'deepseek-v3', operation: 'text.generate', ...request.usageContext },
        () =>
          this.deepSeekProvider!.generate({
            ...request,
            model: isDeepSeekPublicAlias(requestedModel) ? this.deepSeekModel : requestedModel,
          }),
      )
    }
    if (isRehdasuModel(requestedModel)) {
      if (!this.rehdasuProvider) throw modelNotConfigured(requestedModel)
      return observeProviderCall(
        { provider: 'rehdasu', operation: 'text.generate', ...request.usageContext },
        () =>
          this.rehdasuProvider!.generate({
            ...request,
            model: isRehdasuPublicAlias(requestedModel) ? this.rehdasuModel : requestedModel,
          }),
      )
    }
    throw new TextGenerationProviderError(`文本模型 ${requestedModel} 尚未接入`)
  }
}

function isGptModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'seqora-5.6' || normalized.startsWith('gpt-')
}

function isDeepSeekModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('deepseek')
}

function isRehdasuModel(model: string): boolean {
  return /^(glm-5\.2|glm-5\.2-fast|kimi-k3|kimi-k3-thinking)$/i.test(model.trim())
}

function isDeepSeekPublicAlias(model: string): boolean {
  return ['deepseekv3', 'deepseek-v3'].includes(model.trim().toLowerCase())
}

function isRehdasuPublicAlias(model: string): boolean {
  return ['rehdasu', 'rehdasu-default'].includes(model.trim().toLowerCase())
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
