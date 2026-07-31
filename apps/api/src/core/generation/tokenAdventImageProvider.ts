import { z } from 'zod'
import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from './imageProvider.js'

const imageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
})
const MAX_IMAGE_REQUEST_ATTEMPTS = 3

type Fetcher = typeof fetch

export type TokenAdventImageOptions = {
  baseUrl: string
  apiKey: string
  model: string
  quality: 'low' | 'medium' | 'high'
  requestTimeoutMs: number
  fetcher?: Fetcher
}

export class TokenAdventImageProvider implements ImageGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher

  constructor(private readonly options: TokenAdventImageOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationOutput[]> {
    const outputs: ImageGenerationOutput[] = []
    for (const view of request.outputs) {
      const prompt = promptFor(request, view)
      const idempotencyKey = request.idempotencyKey ? `${request.idempotencyKey}:${view}` : undefined
      const response = request.references.length
        ? await this.edit(prompt, request.aspectRatio, request.references, idempotencyKey)
        : await this.create(prompt, request.aspectRatio, idempotencyKey)
      const parsed = imageResponseSchema.parse(response)
      outputs.push({
        view,
        contentType: 'image/png',
        content: Buffer.from(parsed.data[0]!.b64_json, 'base64'),
      })
    }
    return outputs
  }

  private create(prompt: string, aspectRatio: string, idempotencyKey?: string): Promise<unknown> {
    return this.requestJson('/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        model: this.options.model,
        prompt,
        n: 1,
        size: sizeFor(aspectRatio),
        quality: this.options.quality,
        output_format: 'png',
      }),
    })
  }

  private edit(
    prompt: string,
    aspectRatio: string,
    references: ImageGenerationRequest['references'],
    idempotencyKey?: string,
  ): Promise<unknown> {
    const body = new FormData()
    body.set('model', this.options.model)
    body.set('prompt', prompt)
    body.set('size', sizeFor(aspectRatio))
    body.set('quality', this.options.quality)
    body.set('output_format', 'png')
    for (const reference of references.slice(0, 3)) {
      body.append(
        'image[]',
        new Blob([Uint8Array.from(reference.content)], { type: reference.contentType }),
        reference.name,
      )
    }
    return this.requestJson('/v1/images/edits', {
      method: 'POST',
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
      body,
    })
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_IMAGE_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${this.options.apiKey}`, ...init.headers },
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        })
        if (!response.ok) throw await providerError(response)
        return response.json().catch(() => {
          throw new Error('TokenAdvent 返回了无法解析的图片响应')
        })
      } catch (error) {
        lastError = error
        if (attempt >= MAX_IMAGE_REQUEST_ATTEMPTS - 1 || !isRetryable(error)) break
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)))
      }
    }
    throw lastError
  }
}

class TokenAdventImageHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TokenAdventImageHttpError'
  }
}

function promptFor(request: ImageGenerationRequest, view: ImageGenerationRequest['outputs'][number]): string {
  const viewPrompt = {
    single: '',
    front: '仅生成角色正面全身视图，标准站姿，完整入镜。',
    side: '仅生成角色侧面全身视图，标准站姿，完整入镜。',
    back: '仅生成角色背面全身视图，标准站姿，完整入镜。',
    detail: '生成关键细节特写，保持主体设计一致。',
  }[view]
  return [request.prompt, viewPrompt, request.negativePrompt ? `避免出现：${request.negativePrompt}` : '']
    .filter(Boolean)
    .join('\n')
}

function sizeFor(aspectRatio: string): string {
  if (aspectRatio === '9:16') return '1024x1536'
  if (aspectRatio === '16:9') return '1536x1024'
  return '1024x1024'
}

async function providerError(response: Response): Promise<TokenAdventImageHttpError> {
  const body = await response.text().catch(() => '')
  let message = providerErrorMessage(body)
  if (response.status === 524 || /524:\s*A timeout occurred/i.test(body)) {
    message = '上游图片服务超时（524），本次图片没有生成成功；请稍后重试，或降低质量/减少参考图后再试'
  }
  if (response.status === 429) {
    message = '上游图片服务限流（429），请稍后重试'
  }
  return new TokenAdventImageHttpError(
    response.status,
    `TokenAdvent 图片请求失败 (${response.status})${message ? `: ${message}` : ''}`,
  )
}

function providerErrorMessage(body: string): string {
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message || parsed.message || message
  } catch {
    message = htmlTitle(body) || message
  }
  return message
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TokenAdventImageHttpError) {
    if (error.status === 524) return false
    return error.status === 408 || error.status === 429 || error.status >= 500
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
  )
}

function retryDelayMs(attempt: number): number {
  return 750 * 2 ** attempt + Math.floor(Math.random() * 150)
}

function htmlTitle(body: string): string {
  return /<title>(.*?)<\/title>/is.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
}
