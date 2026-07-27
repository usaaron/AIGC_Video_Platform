import { z } from 'zod'
import {
  TextGenerationProviderError,
  type TextGenerationProvider,
  type TextGenerationRequest,
} from './textProvider.js'

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z
            .union([z.string(), z.array(z.unknown())])
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
})

const streamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({ content: z.string().optional() }).passthrough(),
    }),
  ),
})

export type OpenAIChatTextOptions = {
  baseUrl: string
  apiKey: string
  model: string
  requestTimeoutMs: number
  providerLabel: string
  completionsPath?: string
  fetcher?: typeof fetch
}

export class OpenAIChatTextProvider implements TextGenerationProvider {
  private readonly baseUrl: string
  private readonly completionsPath: string
  private readonly fetcher: typeof fetch

  constructor(private readonly options: OpenAIChatTextOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.completionsPath = options.completionsPath ?? '/v1/chat/completions'
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
    throw publicProviderError(this.options.providerLabel, lastError)
  }

  private async generateOnce(request: TextGenerationRequest): Promise<string> {
    const maxTokens = request.maxOutputTokens
      ? { max_tokens: request.maxOutputTokens, max_completion_tokens: request.maxOutputTokens }
      : {}
    const response = await this.fetcher(`${this.baseUrl}${this.completionsPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: request.model ?? this.options.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        ...maxTokens,
        stream: true,
      }),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw await textProviderError(this.options.providerLabel, response)

    if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
      return readCompletionStream(response.body, this.options.requestTimeoutMs)
    }
    const parsed = completionSchema.safeParse(await response.json())
    if (!parsed.success) throw new InvalidTextResponseError(this.options.providerLabel)
    const content = parsed.data.choices[0]!.message.content
    const result = typeof content === 'string' ? content.trim() : ''
    if (!result) throw new InvalidTextResponseError(this.options.providerLabel)
    return result
  }
}

class OpenAIChatHttpError extends Error {
  constructor(
    readonly status: number,
    providerLabel: string,
    message: string,
  ) {
    super(`${providerLabel} text request failed (${status})${message ? `: ${message}` : ''}`)
    this.name = 'OpenAIChatHttpError'
  }
}

class InvalidTextResponseError extends Error {
  constructor(providerLabel: string) {
    super(`${providerLabel} returned an invalid text response`)
    this.name = 'InvalidTextResponseError'
  }
}

async function readCompletionStream(body: ReadableStream<Uint8Array>, timeoutMs: number): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const startedAt = Date.now()
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
      throw new InvalidTextResponseError('OpenAI-compatible text provider')
    }
    const parsed = streamChunkSchema.safeParse(value)
    if (!parsed.success) return
    for (const choice of parsed.data.choices) content += choice.delta.content ?? ''
  }

  const readWithTimeout = async () => {
    const remainingMs = timeoutMs - (Date.now() - startedAt)
    if (remainingMs <= 0) throw timeoutError()
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(timeoutError()), remainingMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  try {
    while (true) {
      const { done, value } = await readWithTimeout()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ''
      for (const line of lines) consume(line)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  buffered += decoder.decode()
  if (buffered) consume(buffered)
  const result = content.trim()
  if (!result) throw new InvalidTextResponseError('OpenAI-compatible text provider')
  return result
}

function timeoutError(): DOMException {
  return new DOMException('Text stream timed out', 'TimeoutError')
}

async function textProviderError(providerLabel: string, response: Response): Promise<OpenAIChatHttpError> {
  const body = await response.text().catch(() => '')
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message || parsed.message || message
  } catch {
    // Keep the bounded text response when the provider does not return JSON.
  }
  return new OpenAIChatHttpError(response.status, providerLabel, message)
}

function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAIChatHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
  )
}

function publicProviderError(providerLabel: string, error: unknown): TextGenerationProviderError {
  if (error instanceof OpenAIChatHttpError) {
    return new TextGenerationProviderError(error.message, { cause: error })
  }
  if (error instanceof InvalidTextResponseError) {
    return new TextGenerationProviderError(`${providerLabel} 文本服务返回格式异常，请稍后重试`, {
      cause: error,
    })
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
    return new TextGenerationProviderError(`${providerLabel} 文本生成等待超时，请稍后重试；原内容未被修改`, {
      cause: error,
    })
  }
  return new TextGenerationProviderError(`${providerLabel} 文本服务连接中断，请稍后重试；原内容未被修改`, {
    cause: error,
  })
}
