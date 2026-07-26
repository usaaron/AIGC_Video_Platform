import { Readable } from 'node:stream'
import { z } from 'zod'
import type {
  VideoContent,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationTier,
  VideoGenerationStatus,
  VideoGenerationSubmission,
} from './videoProvider.js'

const createTaskResponseSchema = z.object({ id: z.string().min(1) })
const taskResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  content: z
    .object({
      video_url: z.string().url().nullish(),
      last_frame_url: z.string().url().nullish(),
    })
    .passthrough()
    .nullish(),
  error: z
    .union([
      z.string(),
      z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough(),
    ])
    .nullish(),
})
const resolutionSchema = z.enum(['480p', '720p', '1080p', '4k'])

type Fetcher = typeof fetch

export type VolcArkSeedanceOptions = {
  baseUrl: string
  apiKey: string
  defaultModel: string
  defaultTier?: VideoGenerationTier
  tierModels?: Partial<Record<VideoGenerationTier, string>>
  requestTimeoutMs: number
  providerLabel?: string
  fetcher?: Fetcher
}

export class VolcArkSeedanceProvider implements VideoGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly contentUrls = new Map<string, string>()
  private readonly lastFrameUrls = new Map<string, string>()
  private readonly providerLabel: string

  constructor(private readonly options: VolcArkSeedanceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
    this.providerLabel = options.providerLabel ?? '火山方舟'
  }

  async submit(request: VideoGenerationRequest): Promise<VideoGenerationSubmission> {
    const prompt = request.prompt.trim()
    if (!prompt) throw new Error('Seedance 视频提示词不能为空')
    const effectivePrompt = [
      prompt,
      request.negativePrompt?.trim() ? `【质量约束】${request.negativePrompt.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const images = request.images.map((image) =>
      typeof image === 'string' ? { url: image, role: 'reference_image' as const } : image,
    )

    const response = await this.requestJson('/contents/generations/tasks', {
      method: 'POST',
      body: JSON.stringify({
        model: this.resolveModel(request.model, request.tier),
        content: [
          { type: 'text', text: effectivePrompt },
          ...images.slice(0, 9).map((image) => ({
            type: 'image_url',
            image_url: { url: image.url },
            role: image.role,
          })),
        ],
        generate_audio: request.generateAudio,
        clientRequestId: request.taskId,
        resolution: resolutionSchema.parse(request.resolution),
        ratio: request.ratio,
        duration: request.seconds,
        watermark: request.watermark ?? false,
        return_last_frame: request.returnLastFrame !== false,
        camera_fixed: request.cameraFixed ?? false,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      }),
    })
    const parsed = createTaskResponseSchema.parse(response)
    return { providerTaskId: parsed.id, status: 'queued', progress: 0 }
  }

  async getStatus(providerTaskId: string): Promise<VideoGenerationStatus> {
    const parsed = await this.readTask(providerTaskId)
    const providerStatus = parsed.status.trim().toLowerCase()
    if (providerStatus === 'succeeded' || providerStatus === 'completed') {
      const contentUrl = parsed.content?.video_url
      if (!contentUrl) throw new Error(`${this.providerLabel}任务已完成，但没有返回视频地址`)
      this.contentUrls.set(providerTaskId, secureContentUrl(contentUrl))
      const lastFrameUrl = parsed.content?.last_frame_url
      if (lastFrameUrl) this.lastFrameUrls.set(providerTaskId, secureContentUrl(lastFrameUrl))
      return {
        status: 'completed',
        progress: 100,
        error: null,
        ...(lastFrameUrl ? { lastFrameUrl: secureContentUrl(lastFrameUrl) } : {}),
      }
    }
    if (
      providerStatus === 'failed' ||
      providerStatus === 'cancelled' ||
      providerStatus === 'canceled' ||
      providerStatus === 'expired' ||
      providerStatus === 'error'
    ) {
      return {
        status: 'failed',
        progress: 100,
        error: errorMessage(parsed.error) || statusMessage(providerStatus),
      }
    }
    return {
      status: 'running',
      progress: ['queued', 'pending', 'submitted', 'created'].includes(providerStatus) ? 5 : 50,
      error: null,
    }
  }

  async getContent(providerTaskId: string, range?: string): Promise<VideoContent> {
    const contentUrl = await this.contentUrlFor(providerTaskId)
    const response = await this.fetcher(contentUrl, {
      method: 'GET',
      ...(range ? { headers: { Range: range } } : {}),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`${this.providerLabel}视频读取失败 (${response.status})`)
    if (!response.body) throw new Error(`${this.providerLabel}视频响应不包含文件内容`)
    return {
      stream: Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      contentType: response.headers.get('content-type') || 'video/mp4',
      contentLength: response.headers.get('content-length'),
      statusCode: response.status,
      acceptRanges: response.headers.get('accept-ranges'),
      contentRange: response.headers.get('content-range'),
    }
  }

  async getLastFrameContent(providerTaskId: string): Promise<VideoContent> {
    const contentUrl = await this.lastFrameContentUrlFor(providerTaskId)
    const response = await this.fetcher(contentUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`${this.providerLabel}尾帧读取失败 (${response.status})`)
    if (!response.body) throw new Error(`${this.providerLabel}尾帧响应不包含文件内容`)
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) throw new Error(`${this.providerLabel}尾帧返回了非图片内容`)
    return {
      stream: Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      contentType,
      contentLength: response.headers.get('content-length'),
      statusCode: response.status,
      acceptRanges: response.headers.get('accept-ranges'),
      contentRange: response.headers.get('content-range'),
    }
  }

  async cancel(providerTaskId: string): Promise<void> {
    await this.requestJson(`/contents/generations/tasks/${encodeURIComponent(providerTaskId)}/cancel`, {
      method: 'POST',
    })
    this.contentUrls.delete(providerTaskId)
    this.lastFrameUrls.delete(providerTaskId)
  }

  private async contentUrlFor(providerTaskId: string): Promise<string> {
    const cached = this.contentUrls.get(providerTaskId)
    if (cached) return cached
    const parsed = await this.readTask(providerTaskId)
    const contentUrl = ['succeeded', 'completed'].includes(parsed.status.trim().toLowerCase())
      ? parsed.content?.video_url
      : null
    if (!contentUrl) throw new Error(`${this.providerLabel}视频尚未生成完成或地址已经失效`)
    const secureUrl = secureContentUrl(contentUrl)
    this.contentUrls.set(providerTaskId, secureUrl)
    return secureUrl
  }

  private async lastFrameContentUrlFor(providerTaskId: string): Promise<string> {
    const cached = this.lastFrameUrls.get(providerTaskId)
    if (cached) return cached
    const parsed = await this.readTask(providerTaskId)
    const contentUrl = ['succeeded', 'completed'].includes(parsed.status.trim().toLowerCase())
      ? parsed.content?.last_frame_url
      : null
    if (!contentUrl) throw new Error(`${this.providerLabel}视频没有返回可用尾帧`)
    const secureUrl = secureContentUrl(contentUrl)
    this.lastFrameUrls.set(providerTaskId, secureUrl)
    return secureUrl
  }

  private async readTask(providerTaskId: string) {
    const response = await this.requestJson(
      `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
      { method: 'GET' },
    )
    return taskResponseSchema.parse(response)
  }

  private resolveModel(model: string | null, tier?: VideoGenerationTier | null): string {
    const normalizedTier = normalizeTier(tier)
    if (normalizedTier) return this.options.tierModels?.[normalizedTier] ?? this.options.defaultModel
    const normalizedModel = model?.trim()
    if (!normalizedModel) {
      const fallbackTier = this.options.defaultTier ?? 'fast'
      return this.options.tierModels?.[fallbackTier] ?? this.options.defaultModel
    }
    const parsedTier = normalizeTier(normalizedModel)
    if (parsedTier) return this.options.tierModels?.[parsedTier] ?? this.options.defaultModel
    return normalizedModel.startsWith('doubao-seedance-') || normalizedModel.startsWith('seedance-')
      ? normalizedModel
      : this.options.defaultModel
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (response.ok) {
      return response.json().catch(() => {
        throw new Error(`${this.providerLabel}返回了无法解析的 JSON`)
      })
    }

    const body = await response.text().catch(() => '')
    let message = body.slice(0, 500)
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
      message = parsed.error?.message || parsed.message || message
    } catch {
      // Keep the bounded response text when Ark does not return JSON.
    }
    throw new Error(`${this.providerLabel}请求失败 (${response.status})${message ? `: ${message}` : ''}`)
  }
}

function errorMessage(error: z.infer<typeof taskResponseSchema>['error']): string {
  if (typeof error === 'string') return error
  return error?.message || error?.code || ''
}

function statusMessage(status: string): string {
  if (status === 'cancelled' || status === 'canceled') return '方舟视频任务已取消'
  if (status === 'expired') return '方舟视频任务已超时'
  return '方舟视频生成失败'
}

function normalizeTier(value: string | null | undefined): VideoGenerationTier | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'mini' || normalized.endsWith('-mini')) return 'mini'
  if (normalized === 'fast' || normalized.endsWith('-fast')) return 'fast'
  if (normalized === 'pro' || normalized.endsWith('-pro')) return 'pro'
  return null
}

function secureContentUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('方舟返回了不安全的视频地址')
  return url.toString()
}
