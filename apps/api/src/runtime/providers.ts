import {
  isDeepSeekPublicAlias,
  isRehdasuPublicAlias,
  resolveDeepSeekV4TextModel,
  resolveGptTextModel,
  textModelFamily,
} from '@seqora/contracts'
import type { AppConfig } from '../config.js'
import { observeProviderCall } from '../core/observability/metrics.js'
import type { AssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import { VolcArkAssetLibraryProvider } from '../core/generation/volcArkAssetLibraryProvider.js'
import { DeepSeekTextProvider } from '../core/generation/deepSeekTextProvider.js'
import { OpenAIChatTextProvider } from '../core/generation/openAIChatTextProvider.js'
import type { ImageGenerationProvider } from '../core/generation/imageProvider.js'
import { TokenAdventImageProvider } from '../core/generation/tokenAdventImageProvider.js'
import type { TextGenerationProvider } from '../core/generation/textProvider.js'
import { TextGenerationProviderError, type TextGenerationRequest } from '../core/generation/textProvider.js'
import { RehdasuTextProvider } from '../core/generation/rehdasuTextProvider.js'
import { TokenAdventTextProvider } from '../core/generation/tokenAdventTextProvider.js'
import type { VideoGenerationProvider, VideoProviderName } from '../core/generation/videoProvider.js'
import { StringXSeedanceProvider } from '../core/generation/stringXSeedanceProvider.js'
import { VolcArkSeedanceProvider } from '../core/generation/volcArkSeedanceProvider.js'
import { DoraRouterSeedanceProvider } from '../core/generation/doraRouterSeedanceProvider.js'
import { DoraRouterAssetLibraryProvider } from '../core/generation/doraRouterAssetLibraryProvider.js'

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
  if (config.VIDEO_PROVIDER === 'dora-router') {
    if (!config.DORA_ROUTER_API_KEY) return null
    return new DoraRouterSeedanceProvider({
      baseUrl: config.DORA_ROUTER_BASE_URL,
      apiKey: config.DORA_ROUTER_API_KEY,
      defaultModel: config.DORA_ROUTER_VIDEO_MODEL,
      requestTimeoutMs: config.DORA_ROUTER_REQUEST_TIMEOUT_MS,
      statusTimeoutMs: config.VIDEO_STATUS_TIMEOUT_MS,
      ffmpegPath: config.FFMPEG_PATH,
      frameExtractionTimeoutMs: config.FILM_PREVIEW_TIMEOUT_MS,
    })
  }
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
      statusTimeoutMs: config.VIDEO_STATUS_TIMEOUT_MS,
    })
  }
  if (!config.ARK_API_KEY) return null
  return new VolcArkSeedanceProvider({
    baseUrl: config.ARK_API_BASE_URL,
    apiKey: config.ARK_API_KEY,
    defaultModel: config.ARK_VIDEO_MODEL,
    requestTimeoutMs: config.ARK_REQUEST_TIMEOUT_MS,
    statusTimeoutMs: config.VIDEO_STATUS_TIMEOUT_MS,
  })
}

export function videoProviderName(config: AppConfig): VideoProviderName {
  if (config.VIDEO_PROVIDER === 'dora-router') return 'dora-router-seedance'
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
  const bailianDeepSeekV4Provider = config.DASHSCOPE_API_KEY
    ? new OpenAIChatTextProvider({
        baseUrl: config.DASHSCOPE_BASE_URL,
        apiKey: config.DASHSCOPE_API_KEY,
        model: config.DASHSCOPE_MODEL,
        completionsPath: config.DASHSCOPE_CHAT_COMPLETIONS_PATH,
        requestTimeoutMs: config.DASHSCOPE_REQUEST_TIMEOUT_MS,
        extraBody: { enable_thinking: false },
        maxTokensMode: 'max_tokens',
        maxAttempts: 1,
        providerLabel: 'Bailian DeepSeek V4',
        providerName: 'bailian-deepseek-v4',
      })
    : null
  const relayDeepSeekV4Provider = config.DEEPSEEK_V4_API_KEY
    ? new OpenAIChatTextProvider({
        baseUrl: config.DEEPSEEK_V4_BASE_URL,
        apiKey: config.DEEPSEEK_V4_API_KEY,
        model: config.DEEPSEEK_V4_MODEL,
        completionsPath: config.DEEPSEEK_V4_CHAT_COMPLETIONS_PATH,
        requestTimeoutMs: config.DEEPSEEK_V4_REQUEST_TIMEOUT_MS,
        extraBody: { enable_thinking: false },
        maxTokensMode: 'both',
        maxAttempts: 1,
        providerLabel: 'DeepSeek V4',
        providerName: 'deepseek-v4',
      })
    : null
  const deepSeekV4Provider = bailianDeepSeekV4Provider ?? relayDeepSeekV4Provider
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
  if (!deepSeekProvider && !deepSeekV4Provider && !gptProvider && !rehdasuProvider) return null
  return new RoutedTextProvider(
    config.TEXT_MODEL,
    config.DEEPSEEK_MODEL,
    config.DASHSCOPE_API_KEY ? config.DASHSCOPE_MODEL : config.DEEPSEEK_V4_MODEL,
    config.REHDASU_MODEL,
    deepSeekProvider,
    deepSeekV4Provider,
    bailianDeepSeekV4Provider,
    gptProvider,
    rehdasuProvider,
  )
}

export function textProviderName(config: AppConfig): string {
  const family = textModelFamily(config.TEXT_MODEL)
  if (family === 'deepseek-v4') return config.TEXT_MODEL.trim().toLowerCase()
  if (family === 'rehdasu') return 'rehdasu'
  return family === 'gpt' ? 'tokenadvent-gpt' : 'deepseek-v3'
}

class RoutedTextProvider implements TextGenerationProvider {
  constructor(
    private readonly defaultModel: string,
    private readonly deepSeekModel: string,
    private readonly deepSeekV4Model: string,
    private readonly rehdasuModel: string,
    private readonly deepSeekProvider: TextGenerationProvider | null,
    private readonly deepSeekV4Provider: TextGenerationProvider | null,
    private readonly bailianDeepSeekV4Provider: TextGenerationProvider | null,
    private readonly gptProvider: TextGenerationProvider | null,
    private readonly rehdasuProvider: TextGenerationProvider | null,
  ) {}

  async generate(request: TextGenerationRequest): Promise<string> {
    const requestedModel = (request.model || this.defaultModel).trim()
    const deadlineAt = request.timeoutMs ? Date.now() + request.timeoutMs : null
    const routedRequest = requestWithRemainingTimeout(request, deadlineAt)
    if (request.providerRoute === 'bailian') {
      if (textModelFamily(requestedModel) !== 'deepseek-v4') {
        throw new TextGenerationProviderError(`文本模型 ${requestedModel} 不支持百炼专用路由`)
      }
      if (!this.bailianDeepSeekV4Provider) {
        throw new TextGenerationProviderError('阿里云百炼 DeepSeek V4 Provider 尚未配置')
      }
      return observeProviderCall(
        { provider: 'bailian-deepseek-v4', operation: 'text.generate', ...request.usageContext },
        () =>
          this.bailianDeepSeekV4Provider!.generate({
            ...routedRequest,
            model: resolveDeepSeekV4TextModel(requestedModel, this.deepSeekV4Model),
          }),
      )
    }
    if (textModelFamily(requestedModel) === 'deepseek-v4') {
      if (!this.deepSeekV4Provider) {
        return this.generateWithDeepSeekV4Fallback(routedRequest, requestedModel)
      }
      try {
        return await observeProviderCall(
          { provider: 'deepseek-v4', operation: 'text.generate', ...request.usageContext },
          () =>
            this.deepSeekV4Provider!.generate({
              ...routedRequest,
              model: resolveDeepSeekV4TextModel(requestedModel, this.deepSeekV4Model),
            }),
        )
      } catch (error) {
        if (!isProviderAvailabilityError(error)) throw error
        return this.generateWithDeepSeekV4Fallback(
          requestWithRemainingTimeout(request, deadlineAt),
          requestedModel,
          error,
        )
      }
    }
    if (textModelFamily(requestedModel) === 'gpt') {
      if (!this.gptProvider) throw modelNotConfigured(requestedModel)
      return observeProviderCall(
        { provider: 'tokenadvent-gpt', operation: 'text.generate', ...request.usageContext },
        () => this.gptProvider!.generate({ ...routedRequest, model: resolveGptTextModel(requestedModel) }),
      )
    }
    if (textModelFamily(requestedModel) === 'deepseek-v3') {
      if (!this.deepSeekProvider) throw modelNotConfigured(requestedModel)
      return observeProviderCall(
        { provider: 'deepseek-v3', operation: 'text.generate', ...request.usageContext },
        () =>
          this.deepSeekProvider!.generate({
            ...routedRequest,
            model: isDeepSeekPublicAlias(requestedModel) ? this.deepSeekModel : requestedModel,
          }),
      )
    }
    if (textModelFamily(requestedModel) === 'rehdasu') {
      if (!this.rehdasuProvider) throw modelNotConfigured(requestedModel)
      return observeProviderCall(
        { provider: 'rehdasu', operation: 'text.generate', ...request.usageContext },
        () =>
          this.rehdasuProvider!.generate({
            ...routedRequest,
            model: isRehdasuPublicAlias(requestedModel) ? this.rehdasuModel : requestedModel,
          }),
      )
    }
    throw new TextGenerationProviderError(`文本模型 ${requestedModel} 尚未接入`)
  }

  private generateWithDeepSeekV4Fallback(
    request: TextGenerationRequest,
    requestedModel: string,
    originalError?: unknown,
  ): Promise<string> {
    if (!this.rehdasuProvider) {
      if (originalError) throw originalError
      throw modelNotConfigured(requestedModel)
    }
    return observeProviderCall(
      { provider: 'rehdasu', operation: 'text.generate.fallback', ...request.usageContext },
      () => this.rehdasuProvider!.generate({ ...request, model: this.rehdasuModel }),
    )
  }
}

function requestWithRemainingTimeout(
  request: TextGenerationRequest,
  deadlineAt: number | null,
): TextGenerationRequest {
  if (deadlineAt === null) return request
  return { ...request, timeoutMs: Math.max(1, deadlineAt - Date.now()) }
}

function modelNotConfigured(model: string): TextGenerationProviderError {
  return new TextGenerationProviderError(`文本模型 ${model} 的 Provider 尚未配置`)
}

function isProviderAvailabilityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    messages.push(`${current.name} ${current.message}`)
    current = current.cause
  }
  return /\((?:408|425|429|5\d\d)\)|bad gateway|timeout|timed out|fetch failed|network|连接中断|等待超时|格式异常/i.test(
    messages.join(' '),
  )
}

export function createAssetLibraryProvider(config: AppConfig): AssetLibraryProvider | null {
  if (config.ASSET_LIBRARY_PROVIDER === 'dora-router') {
    if (!config.DORA_ROUTER_API_KEY) return null
    return new DoraRouterAssetLibraryProvider({
      baseUrl: config.DORA_ROUTER_BASE_URL,
      apiKey: config.DORA_ROUTER_API_KEY,
      projectName: config.VOLC_ARK_PROJECT_NAME,
      requestTimeoutMs: config.DORA_ROUTER_ASSET_REQUEST_TIMEOUT_MS,
    })
  }
  if (!config.VOLC_ACCESS_KEY || !config.VOLC_SECRET_KEY) return null
  return new VolcArkAssetLibraryProvider({
    baseUrl: config.VOLC_ASSET_BASE_URL,
    accessKey: config.VOLC_ACCESS_KEY,
    secretKey: config.VOLC_SECRET_KEY,
    projectName: config.VOLC_ARK_PROJECT_NAME,
    requestTimeoutMs: config.VOLC_ASSET_REQUEST_TIMEOUT_MS,
  })
}

export function assetLibraryProviderName(config: AppConfig): string {
  return config.ASSET_LIBRARY_PROVIDER === 'dora-router' ? 'dora-router-material' : 'volc-ark-material'
}
