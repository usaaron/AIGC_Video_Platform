import {
  TextGenerationProviderError,
  type TextGenerationProvider,
  type TextGenerationRequest,
} from './textProvider.js'

export type OpenAIChatTextOptions = {
  baseUrl: string
  apiKey: string
  model: string
  requestTimeoutMs: number
  providerLabel: string
  completionsPath?: string
  maxTokensMode?: 'both' | 'max_tokens' | 'max_completion_tokens'
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
        return await this.generateOnce(request, attempt === 0)
      } catch (error) {
        lastError = error
        if (attempt > 0 || !isRetryable(error)) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    throw publicProviderError(this.options.providerLabel, lastError)
  }

  private async generateOnce(request: TextGenerationRequest, stream: boolean): Promise<string> {
    let response = await this.requestCompletion(request, stream, true)
    if (!response.ok && response.status === 400 && request.responseFormat === 'json') {
      response = await this.requestCompletion(request, stream, false)
    }
    if (!response.ok) throw await textProviderError(this.options.providerLabel, response)

    if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
      return readCompletionStream(response.body, this.options.requestTimeoutMs)
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new InvalidTextResponseError(this.options.providerLabel)
    }
    const result = completionText(payload)
    if (!result) throw new InvalidTextResponseError(this.options.providerLabel)
    return result.trim()
  }

  private requestCompletion(
    request: TextGenerationRequest,
    stream: boolean,
    includeResponseFormat: boolean,
  ): Promise<Response> {
    const maxTokens = maxTokenPayload(request.maxOutputTokens, this.options.maxTokensMode ?? 'both')
    return this.fetcher(`${this.baseUrl}${this.completionsPath}`, {
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
        ...(includeResponseFormat && request.responseFormat === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}),
        stream,
      }),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
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
  let reasoningContent = ''

  const consume = (line: string) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let value: unknown
    try {
      value = JSON.parse(payload)
    } catch {
      return
    }
    const text = completionParts(value)
    content += text.content
    reasoningContent += text.reasoning
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
  const result = (content || reasoningContent).trim()
  if (!result) throw new InvalidTextResponseError('OpenAI-compatible text provider')
  return result
}

function completionText(value: unknown): string {
  const parts = completionParts(value)
  return parts.content || parts.reasoning
}

function completionParts(value: unknown): { content: string; reasoning: string } {
  if (!isRecord(value)) return { content: textFromValue(value), reasoning: '' }

  let content = textFromValue(value.output_text ?? value.text ?? value.content)
  let reasoning = textFromValue(value.reasoning_content ?? value.reasoning)
  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (!isRecord(choice)) continue
      const delta = isRecord(choice.delta) ? choice.delta : undefined
      const message = isRecord(choice.message) ? choice.message : undefined
      content += textFromValue(
        delta?.content ?? delta?.text ?? message?.content ?? message?.text ?? choice.text ?? choice.content,
      )
      reasoning += textFromValue(
        delta?.reasoning_content ??
          delta?.reasoning ??
          message?.reasoning_content ??
          message?.reasoning ??
          choice.reasoning_content,
      )
    }
  }

  if (!content && !reasoning) {
    for (const key of ['data', 'result', 'output', 'response', 'payload']) {
      if (!(key in value)) continue
      const nested = completionParts(value[key])
      content += nested.content
      reasoning += nested.reasoning
      if (content || reasoning) break
    }
  }
  return { content, reasoning }
}

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      return textFromValue(part.text ?? part.content ?? part.value)
    })
    .filter(Boolean)
    .join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function timeoutError(): DOMException {
  return new DOMException('Text stream timed out', 'TimeoutError')
}

function maxTokenPayload(
  maxOutputTokens: number | undefined,
  mode: 'both' | 'max_tokens' | 'max_completion_tokens',
): Record<string, number> {
  if (!maxOutputTokens) return {}
  if (mode === 'max_tokens') return { max_tokens: maxOutputTokens }
  if (mode === 'max_completion_tokens') return { max_completion_tokens: maxOutputTokens }
  return { max_tokens: maxOutputTokens, max_completion_tokens: maxOutputTokens }
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
  if (error instanceof InvalidTextResponseError) return true
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
