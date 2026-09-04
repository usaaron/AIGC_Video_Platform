import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { z } from 'zod'
import type {
  VideoContent,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationStatus,
  VideoGenerationSubmission,
} from './videoProvider.js'

const taskResponseSchema = z
  .object({
    id: z.string().min(1).nullish(),
    task_id: z.string().min(1).nullish(),
    status: z.string().min(1).nullish(),
    progress: z.number().min(0).max(100).nullish(),
    metadata: z
      .object({
        url: z.string().url().nullish(),
        video_url: z.string().url().nullish(),
        last_frame_url: z.string().url().nullish(),
        lastFrameUrl: z.string().url().nullish(),
      })
      .passthrough()
      .nullish(),
    content: z
      .object({
        video_url: z.string().url().nullish(),
        last_frame_url: z.string().url().nullish(),
      })
      .passthrough()
      .nullish(),
    code: z.string().nullish(),
    message: z.string().nullish(),
    error: z
      .union([
        z.string(),
        z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough(),
      ])
      .nullish(),
  })
  .passthrough()

type Fetcher = typeof fetch
type DoraTaskResponse = z.infer<typeof taskResponseSchema>
export type DoraRouterLastFrameExtractor = (
  videoUrl: string,
  fetcher: Fetcher,
  timeoutMs: number,
  ffmpegPath: string,
) => Promise<Buffer>

const execFileAsync = promisify(execFile)

export type DoraRouterSeedanceOptions = {
  baseUrl: string
  apiKey: string
  defaultModel: string
  requestTimeoutMs: number
  statusTimeoutMs?: number
  ffmpegPath?: string
  frameExtractionTimeoutMs?: number
  lastFrameExtractor?: DoraRouterLastFrameExtractor
  fetcher?: Fetcher
}

/** DoraRouter's Seedance-compatible API uses the OpenAI-style video task paths. */
export class DoraRouterSeedanceProvider implements VideoGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly contentUrls = new Map<string, string>()
  private readonly lastFrameUrls = new Map<string, string>()
  private readonly directLastFrameChecked = new Set<string>()

  constructor(private readonly options: DoraRouterSeedanceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
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

    const response = await this.requestJson('/v1/video/generations', {
      method: 'POST',
      ...(request.idempotencyKey ? { headers: { 'Idempotency-Key': request.idempotencyKey } } : {}),
      body: JSON.stringify({
        model: this.resolveModel(request.model),
        content: [
          { type: 'text', text: effectivePrompt },
          ...images.slice(0, 9).map((image) => ({
            type: 'image_url',
            image_url: { url: image.url },
            // DoraRouter documents reference_image as the supported image role.
            role: 'reference_image',
          })),
        ],
        resolution: normalizeResolution(request.resolution),
        ratio: request.ratio,
        duration: request.seconds,
        generate_audio: request.generateAudio,
        return_last_frame: request.returnLastFrame !== false,
        watermark: request.watermark ?? false,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      }),
    })
    const parsed = taskResponseSchema.parse(response)
    const providerTaskId = taskIdFrom(parsed)
    return { providerTaskId, status: 'queued', progress: parsed.progress ?? 0 }
  }

  async getStatus(providerTaskId: string): Promise<VideoGenerationStatus> {
    const parsed = await this.readTask(providerTaskId, this.options.statusTimeoutMs)
    const providerStatus = (parsed.status || '').trim().toLowerCase()
    if (providerStatus === 'succeeded' || providerStatus === 'completed' || providerStatus === 'success') {
      const contentUrl = videoUrlFrom(parsed)
      if (!contentUrl) throw new Error('DoraRouter任务已完成，但没有返回视频地址')
      this.contentUrls.set(providerTaskId, secureContentUrl(contentUrl))
      const lastFrameUrl = lastFrameUrlFrom(parsed)
      if (lastFrameUrl) {
        this.lastFrameUrls.set(providerTaskId, secureContentUrl(lastFrameUrl))
      } else {
        this.directLastFrameChecked.add(providerTaskId)
      }
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
        error: errorMessage(parsed) || statusMessage(providerStatus),
      }
    }
    return {
      status: 'running',
      progress: Math.max(5, Math.min(99, parsed.progress ?? (providerStatus === 'queued' ? 5 : 50))),
      error: null,
    }
  }

  async getContent(providerTaskId: string, range?: string): Promise<VideoContent> {
    const contentUrl = await this.contentUrlFor(providerTaskId)
    return this.readMedia(contentUrl, range, '视频')
  }

  async getLastFrameContent(providerTaskId: string): Promise<VideoContent> {
    const cached = this.lastFrameUrls.get(providerTaskId)
    if (cached) return this.readLastFrameMedia(cached)

    const parsed = this.directLastFrameChecked.has(providerTaskId)
      ? null
      : await this.readTask(providerTaskId)
    const returnedLastFrameUrl = parsed ? lastFrameUrlFrom(parsed) : null
    if (returnedLastFrameUrl) {
      const secureUrl = secureContentUrl(returnedLastFrameUrl)
      this.lastFrameUrls.set(providerTaskId, secureUrl)
      return this.readLastFrameMedia(secureUrl)
    }

    // DoraRouter documents the completed MP4 URL but does not promise a last-frame URL.
    // Extracting it locally keeps continuity reliable without inventing an upstream field.
    const videoUrl = (parsed ? videoUrlFrom(parsed) : null) || this.contentUrls.get(providerTaskId)
    if (!videoUrl) throw new Error('DoraRouter视频没有返回可用于提取尾帧的地址')
    const extractor = this.options.lastFrameExtractor ?? extractLastFrameFromVideo
    const buffer = await extractor(
      secureContentUrl(videoUrl),
      this.fetcher,
      this.options.frameExtractionTimeoutMs ?? this.options.requestTimeoutMs,
      this.options.ffmpegPath ?? 'ffmpeg',
    )
    if (!buffer.length) throw new Error('DoraRouter视频未能提取出尾帧')
    return {
      stream: Readable.from(buffer),
      contentType: 'image/jpeg',
      contentLength: String(buffer.length),
      statusCode: 200,
      acceptRanges: null,
      contentRange: null,
    }
  }

  private async contentUrlFor(providerTaskId: string): Promise<string> {
    const cached = this.contentUrls.get(providerTaskId)
    if (cached) return cached
    const parsed = await this.readTask(providerTaskId)
    const contentUrl = videoUrlFrom(parsed)
    if (!contentUrl) throw new Error('DoraRouter视频尚未生成完成或地址已经失效')
    const secureUrl = secureContentUrl(contentUrl)
    this.contentUrls.set(providerTaskId, secureUrl)
    return secureUrl
  }

  private async readLastFrameMedia(url: string): Promise<VideoContent> {
    const content = await this.readMedia(url, undefined, '尾帧')
    if (!content.contentType.startsWith('image/')) throw new Error('DoraRouter尾帧返回了非图片内容')
    return content
  }

  private async readTask(providerTaskId: string, timeoutMs?: number): Promise<DoraTaskResponse> {
    const response = await this.requestJson(
      `/v1/video/generations/${encodeURIComponent(providerTaskId)}`,
      { method: 'GET' },
      timeoutMs,
    )
    return taskResponseSchema.parse(response)
  }

  private async readMedia(url: string, range: string | undefined, label: string): Promise<VideoContent> {
    const response = await this.fetcher(url, {
      method: 'GET',
      ...(range ? { headers: { Range: range } } : {}),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`DoraRouter${label}读取失败 (${response.status})`)
    if (!response.body) throw new Error(`DoraRouter${label}响应不包含文件内容`)
    return {
      stream: Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      contentType: response.headers.get('content-type') || (label === '尾帧' ? 'image/jpeg' : 'video/mp4'),
      contentLength: response.headers.get('content-length'),
      statusCode: response.status,
      acceptRanges: response.headers.get('accept-ranges'),
      contentRange: response.headers.get('content-range'),
    }
  }

  private resolveModel(model: string | null): string {
    return model?.startsWith('TH-') ? model : this.options.defaultModel
  }

  private async requestJson(path: string, init: RequestInit, timeoutMs?: number): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(timeoutMs ?? this.options.requestTimeoutMs),
    })
    if (response.ok) {
      return response.json().catch(() => {
        throw new Error('DoraRouter返回了无法解析的 JSON')
      })
    }

    const body = await response.text().catch(() => '')
    let message = body.slice(0, 500)
    try {
      const parsed = JSON.parse(body) as { code?: string; message?: string; error?: { message?: string } }
      message = parsed.message || parsed.error?.message || parsed.code || message
    } catch {
      // Keep the bounded response text when DoraRouter does not return JSON.
    }
    throw new Error(`DoraRouter请求失败 (${response.status})${message ? `: ${message}` : ''}`)
  }
}

async function extractLastFrameFromVideo(
  videoUrl: string,
  fetcher: Fetcher,
  timeoutMs: number,
  ffmpegPath: string,
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'seqora-dora-tail-'))
  const inputPath = join(directory, 'source.mp4')
  try {
    const response = await fetcher(videoUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`DoraRouter视频下载失败 (${response.status})`)
    if (!response.body) throw new Error('DoraRouter视频响应不包含文件内容')
    await pipeline(
      Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      createWriteStream(inputPath),
    )

    const { stdout } = await execFileAsync(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-sseof',
        '-0.5',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ],
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'buffer',
      },
    )
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

function taskIdFrom(response: DoraTaskResponse): string {
  const taskId = response.id || response.task_id
  if (!taskId) throw new Error('DoraRouter创建任务后没有返回任务 ID')
  return taskId
}

function videoUrlFrom(response: DoraTaskResponse): string | null {
  return response.metadata?.url || response.metadata?.video_url || response.content?.video_url || null
}

function lastFrameUrlFrom(response: DoraTaskResponse): string | null {
  return (
    response.metadata?.last_frame_url ||
    response.metadata?.lastFrameUrl ||
    response.content?.last_frame_url ||
    null
  )
}

function normalizeResolution(value: string): '480p' | '720p' | '1080p' {
  if (value === '480p' || value === '720p' || value === '1080p') return value
  return '1080p'
}

function errorMessage(response: DoraTaskResponse): string {
  if (typeof response.error === 'string') return response.error
  return response.error?.message || response.error?.code || response.message || response.code || ''
}

function statusMessage(status: string): string {
  if (status === 'cancelled' || status === 'canceled') return 'DoraRouter视频任务已取消'
  if (status === 'expired') return 'DoraRouter视频任务已超时'
  return 'DoraRouter视频生成失败'
}

function secureContentUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('DoraRouter返回了不安全的视频地址')
  return url.toString()
}
