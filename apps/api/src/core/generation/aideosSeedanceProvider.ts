import { Readable } from 'node:stream'
import { z } from 'zod'
import type {
  VideoContent,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationStatus,
  VideoGenerationSubmission,
} from './videoProvider.js'

const taskResponseSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1).optional(),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'unknown']),
  progress: z.number().int().min(0).max(100).optional().default(0),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough().optional(),
})

type Fetcher = typeof fetch

export type AideosSeedanceOptions = {
  baseUrl: string
  apiKey: string
  defaultModel: string
  requestTimeoutMs: number
  fetcher?: Fetcher
}

export class AideosSeedanceProvider implements VideoGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher

  constructor(private readonly options: AideosSeedanceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
  }

  async submit(request: VideoGenerationRequest): Promise<VideoGenerationSubmission> {
    const payload = {
      model: this.resolveModel(request.model),
      prompt: request.prompt.trim(),
      ...(request.images.length > 0 ? { images: request.images } : {}),
      seconds: String(request.seconds),
      metadata: {
        resolution: request.resolution,
        ratio: request.ratio,
        generate_audio: request.generateAudio,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        ...(request.watermark === undefined ? {} : { watermark: request.watermark }),
        ...(request.cameraFixed === undefined ? {} : { camera_fixed: request.cameraFixed }),
      },
    }
    if (!payload.prompt) throw new Error('Seedance 视频提示词不能为空')

    const response = await this.requestJson('/v1/video/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const parsed = taskResponseSchema.parse(response)
    return {
      providerTaskId: parsed.task_id ?? parsed.id,
      status: parsed.status === 'queued' ? 'queued' : 'running',
      progress: parsed.progress,
    }
  }

  async getStatus(providerTaskId: string): Promise<VideoGenerationStatus> {
    const response = await this.requestJson(`/v1/videos/${encodeURIComponent(providerTaskId)}`, {
      method: 'GET',
    })
    const parsed = taskResponseSchema.parse(response)
    if (parsed.status === 'completed') return { status: 'completed', progress: 100, error: null }
    if (parsed.status === 'failed') {
      return {
        status: 'failed',
        progress: 100,
        error: parsed.error?.message || parsed.error?.code || 'Seedance 视频生成失败',
      }
    }
    return { status: 'running', progress: Math.max(1, parsed.progress), error: null }
  }

  async getContent(providerTaskId: string): Promise<VideoContent> {
    const response = await this.request(`/v1/videos/${encodeURIComponent(providerTaskId)}/content`, {
      method: 'GET',
    })
    if (!response.body) throw new Error('Seedance 视频响应不包含文件内容')
    return {
      stream: Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      contentType: response.headers.get('content-type') || 'video/mp4',
      contentLength: response.headers.get('content-length'),
    }
  }

  private resolveModel(model: string | null): string {
    return model?.startsWith('doubao-seedance-') ? model : this.options.defaultModel
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.request(path, init)
    return response.json().catch(() => {
      throw new Error('Aideos 返回了无法解析的 JSON')
    })
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (response.ok) return response

    const body = await response.text().catch(() => '')
    let message = body.slice(0, 500)
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
      message = parsed.error?.message || parsed.message || message
    } catch {
      // Keep the bounded text response when the provider does not return JSON.
    }
    throw new Error(`Aideos 请求失败 (${response.status})${message ? `: ${message}` : ''}`)
  }
}
