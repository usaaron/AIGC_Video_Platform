import { z } from 'zod'
import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from './imageProvider.js'

const imageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
})

type Fetcher = typeof fetch

export type TokenAdventImageOptions = {
  baseUrl: string
  apiKey: string
  alternateBaseUrl?: string
  alternateApiKey?: string
  alternateModels?: readonly string[]
  alternateModel?: string
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
    const model = this.resolveModel(request.model)
    for (const view of request.outputs) {
      const prompt = promptFor(request, view)
      const response = request.references.length
        ? await this.edit(prompt, request.aspectRatio, request.references, model)
        : await this.create(prompt, request.aspectRatio, model)
      const parsed = imageResponseSchema.parse(response)
      outputs.push({
        view,
        contentType: 'image/png',
        content: Buffer.from(parsed.data[0]!.b64_json, 'base64'),
      })
    }
    return outputs
  }

  private create(prompt: string, aspectRatio: string, model: string): Promise<unknown> {
    return this.requestJson(
      '/v1/images/generations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: sizeFor(aspectRatio),
          quality: this.options.quality,
          output_format: 'png',
        }),
      },
      model,
    )
  }

  private edit(
    prompt: string,
    aspectRatio: string,
    references: ImageGenerationRequest['references'],
    model: string,
  ): Promise<unknown> {
    const body = new FormData()
    body.set('model', model)
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
    return this.requestJson('/v1/images/edits', { method: 'POST', body }, model)
  }

  private resolveModel(model: string | null | undefined): string {
    if (model === 'nano-banana') return this.options.alternateModel || 'nano-banana'
    if (!model || model === 'img2-default') return this.options.model
    return model
  }

  private async requestJson(path: string, init: RequestInit, model: string): Promise<unknown> {
    const baseUrl = this.resolveBaseUrl(model)
    const apiKey = this.resolveApiKey(model)
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetcher(`${baseUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        })
        if (!response.ok) throw await providerError(response)
        return response.json().catch(() => {
          throw new Error('TokenAdvent 返回了无法解析的图片响应')
        })
      } catch (error) {
        lastError = error
        if (attempt > 0 || !isRetryable(error)) break
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    throw lastError
  }

  private resolveApiKey(model: string): string {
    if (this.isAlternateModel(model)) {
      if (!this.options.alternateApiKey) {
        throw new Error('Nano Banana 尚未配置真实 API 密钥，当前不能提交生成')
      }
      return this.options.alternateApiKey
    }
    return this.options.apiKey
  }

  private resolveBaseUrl(model: string): string {
    if (this.isAlternateModel(model)) {
      if (!this.options.alternateBaseUrl) {
        throw new Error('Nano Banana 尚未配置真实 API 地址，当前不能提交生成')
      }
      return this.options.alternateBaseUrl.replace(/\/+$/, '')
    }
    return this.baseUrl
  }

  private isAlternateModel(model: string): boolean {
    return (
      model === 'nano-banana' ||
      model === this.options.alternateModel ||
      this.options.alternateModels?.includes(model) === true
    )
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
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message || parsed.message || message
  } catch {
    // Keep the bounded text response when the provider does not return JSON.
  }
  return new TokenAdventImageHttpError(
    response.status,
    `TokenAdvent 图片请求失败 (${response.status})${message ? `: ${message}` : ''}`,
  )
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TokenAdventImageHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
  )
}
