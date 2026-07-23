import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import type {
  VideoContent,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationStatus,
  VideoGenerationSubmission,
} from './videoProvider.js'

const taskResponseSchema = z.object({
  id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'unknown']),
  progress: z.coerce.number().int().min(0).max(100).optional().default(0),
  error: z
    .union([
      z.string(),
      z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough(),
    ])
    .optional(),
})

type Fetcher = typeof fetch
type LastFrameExtractor = (inputPath: string, outputPath: string) => Promise<void>

export type AideosSeedanceOptions = {
  baseUrl: string
  apiKey: string
  defaultModel: string
  requestTimeoutMs: number
  ffmpegPath: string
  lastFrameTimeoutMs: number
  fetcher?: Fetcher
  lastFrameExtractor?: LastFrameExtractor
}

export class AideosSeedanceProvider implements VideoGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly lastFrameExtractor: LastFrameExtractor

  constructor(private readonly options: AideosSeedanceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
    this.lastFrameExtractor =
      options.lastFrameExtractor ??
      ((inputPath, outputPath) =>
        extractLastFrame(options.ffmpegPath, inputPath, outputPath, options.lastFrameTimeoutMs))
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
    const images = request.images
      .map((image) => (typeof image === 'string' ? image : image.url))
      .filter(Boolean)
      .slice(0, 9)

    const response = await this.requestJson('/v1/video/generations', {
      method: 'POST',
      body: JSON.stringify({
        model: this.resolveModel(request.model),
        prompt: effectivePrompt,
        ...(images.length ? { images } : {}),
        seconds: String(request.seconds),
        metadata: {
          resolution: request.resolution,
          ratio: request.ratio,
          generate_audio: request.generateAudio,
          return_last_frame: request.returnLastFrame !== false,
          watermark: request.watermark ?? false,
          camera_fixed: request.cameraFixed ?? false,
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
      }),
    })
    const parsed = taskResponseSchema.parse(response)
    const providerTaskId = parsed.task_id ?? parsed.id
    if (!providerTaskId) throw new Error('Aideos 创建任务成功，但没有返回任务 ID')
    if (parsed.status === 'failed') throw new Error(errorMessage(parsed.error))
    return {
      providerTaskId,
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
      return { status: 'failed', progress: 100, error: errorMessage(parsed.error) }
    }
    return { status: 'running', progress: Math.max(1, parsed.progress), error: null }
  }

  async getContent(providerTaskId: string, range?: string): Promise<VideoContent> {
    const response = await this.request(`/v1/videos/${encodeURIComponent(providerTaskId)}/content`, {
      method: 'GET',
      ...(range ? { headers: { Range: range } } : {}),
    })
    if (!response.body) throw new Error('Aideos 视频响应不包含文件内容')
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
    const directory = await mkdtemp(join(tmpdir(), 'seqora-aideos-'))
    const inputPath = join(directory, 'video.mp4')
    const outputPath = join(directory, 'last-frame.jpg')
    try {
      const content = await this.getContent(providerTaskId)
      await pipeline(content.stream, createWriteStream(inputPath))
      await this.lastFrameExtractor(inputPath, outputPath)
      const frame = await readFile(outputPath)
      if (!frame.length) throw new Error('FFmpeg 没有生成可用尾帧')
      return {
        stream: Readable.from([frame]),
        contentType: 'image/jpeg',
        contentLength: String(frame.length),
        statusCode: 200,
        acceptRanges: null,
        contentRange: null,
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
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
      const parsed = JSON.parse(body) as { error?: string | { message?: string }; message?: string }
      message =
        (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) || parsed.message || message
    } catch {
      // Keep the bounded text response when the provider does not return JSON.
    }
    throw new Error(`Aideos 请求失败 (${response.status})${message ? `: ${message}` : ''}`)
  }
}

function errorMessage(error: z.infer<typeof taskResponseSchema>['error']): string {
  if (typeof error === 'string') return error || 'Seedance 视频生成失败'
  return error?.message || error?.code || 'Seedance 视频生成失败'
}

async function extractLastFrame(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-sseof',
        '-0.1',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        outputPath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    )
    let settled = false
    let stderr = ''
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`FFmpeg 尾帧提取超时（${timeoutMs}ms）`))
    }, timeoutMs)
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < 4_000) stderr += String(chunk).slice(0, 4_000 - stderr.length)
    })
    child.once('error', (error) => finish(new Error(`FFmpeg 启动失败：${error.message}`)))
    child.once('close', (code) => {
      finish(code === 0 ? undefined : new Error(`FFmpeg 尾帧提取失败${stderr ? `：${stderr.trim()}` : ''}`))
    })
  })
}
