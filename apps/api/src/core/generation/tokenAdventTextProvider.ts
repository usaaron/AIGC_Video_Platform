import { z } from 'zod'
import {
  TextGenerationProviderError,
  type TextGenerationProvider,
  type TextGenerationRequest,
} from './textProvider.js'

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
})
const streamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({ content: z.string().optional() }).passthrough(),
    }),
  ),
})

export type TokenAdventTextOptions = {
  baseUrl: string
  apiKey: string
  model: string
  requestTimeoutMs: number
  fetcher?: typeof fetch
}

export class TokenAdventTextProvider implements TextGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch

  constructor(private readonly options: TokenAdventTextOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
  }

  async generate(request: TextGenerationRequest): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.generateOnce(request)
      } catch (error) {
        lastError = error
        if (attempt > 0 || !isRetryable(error)) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    throw publicProviderError(lastError)
  }

  private async generateOnce(request: TextGenerationRequest): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
        stream: true,
      }),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw await textProviderError(response)

    if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
      return readCompletionStream(response.body)
    }
    const parsed = completionSchema.safeParse(await response.json())
    if (!parsed.success) throw new InvalidTextResponseError()
    return parsed.data.choices[0]!.message.content.trim()
  }
}

class TokenAdventHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TokenAdventHttpError'
  }
}

class InvalidTextResponseError extends Error {
  constructor() {
    super('TokenAdvent 返回了无法解析的文本响应')
    this.name = 'InvalidTextResponseError'
  }
}

async function readCompletionStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let content = ''

  const consume = (line: string) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let value: unknown
    try {
      value = JSON.parse(payload)
    } catch {
      throw new InvalidTextResponseError()
    }
    const parsed = streamChunkSchema.safeParse(value)
    if (!parsed.success) return
    for (const choice of parsed.data.choices) content += choice.delta.content ?? ''
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) consume(line)
  }
  buffered += decoder.decode()
  if (buffered) consume(buffered)
  const result = content.trim()
  if (!result) throw new InvalidTextResponseError()
  return result
}

async function textProviderError(response: Response): Promise<TokenAdventHttpError> {
  const body = await response.text().catch(() => '')
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message || parsed.message || message
  } catch {
    // Keep the bounded text response when the provider does not return JSON.
  }
  return new TokenAdventHttpError(
    response.status,
    `TokenAdvent 文本请求失败 (${response.status})${message ? `: ${message}` : ''}`,
  )
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TokenAdventHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
  )
}

function publicProviderError(error: unknown): TextGenerationProviderError {
  if (error instanceof TokenAdventHttpError) {
    return new TextGenerationProviderError(error.message, { cause: error })
  }
  if (error instanceof InvalidTextResponseError) {
    return new TextGenerationProviderError('AI 文本服务返回格式异常，请稍后重试', { cause: error })
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
    return new TextGenerationProviderError('AI 文本生成等待超时，请稍后重试；原剧本未被修改', {
      cause: error,
    })
  }
  return new TextGenerationProviderError('AI 文本服务连接中断，请稍后重试；原剧本未被修改', {
    cause: error,
  })
}
