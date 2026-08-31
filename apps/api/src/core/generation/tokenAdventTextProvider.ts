import {
  TextGenerationProviderError,
  type TextGenerationProvider,
  type TextGenerationRequest,
  type TextGenerationTiming,
} from './textProvider.js'
import {
  providerTokenUsageFromPayload,
  recordTextProviderUsage,
  type ProviderTokenUsage,
} from '../observability/usage.js'

export type TokenAdventTextOptions = {
  baseUrl: string
  apiKey: string
  alternateApiKey?: string
  alternateModels?: readonly string[]
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
    const maxAttempts = request.maxAttempts ?? 2
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.generateOnce(request, attempt + 1)
      } catch (error) {
        lastError = error
        if (attempt >= maxAttempts - 1 || !isRetryable(error)) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    throw publicProviderError(lastError, this.resolveModel(request.model))
  }

  private async generateOnce(request: TextGenerationRequest, attempt: number): Promise<string> {
    const startedAt = Date.now()
    const model = this.resolveModel(request.model)
    let response = await this.requestCompletion(request, model, true)
    if (!response.ok && response.status === 400 && request.responseFormat === 'json') {
      response = await this.requestCompletion(request, model, false)
    }
    if (!response.ok) throw await textProviderError(response)
    const responseHeadersMs = Date.now() - startedAt

    if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
      const completion = await readCompletionStream(
        response.body,
        request.timeoutMs ?? this.options.requestTimeoutMs,
        request.onTextProgress,
      )
      notifyTextTiming(request.onTextTiming, {
        ...(request.timingLabel ? { label: request.timingLabel } : {}),
        responseHeadersMs,
        firstTokenMs:
          completion.firstTokenAfterHeadersMs === null
            ? null
            : responseHeadersMs + completion.firstTokenAfterHeadersMs,
        generationMs: completion.generationMs,
        totalMs: Date.now() - startedAt,
        attempt,
      })
      this.recordTokenUsage(request, model, completion.usage)
      return completion.text
    }
    const payload = await response.json()
    const content = completionText(payload)
    if (!content) throw new InvalidTextResponseError()
    notifyTextProgress(request.onTextProgress, content.trim())
    notifyTextTiming(request.onTextTiming, {
      ...(request.timingLabel ? { label: request.timingLabel } : {}),
      responseHeadersMs,
      firstTokenMs: responseHeadersMs,
      generationMs: Math.max(0, Date.now() - startedAt - responseHeadersMs),
      totalMs: Date.now() - startedAt,
      attempt,
    })
    this.recordTokenUsage(request, model, providerTokenUsageFromPayload(payload))
    return content.trim()
  }

  private requestCompletion(
    request: TextGenerationRequest,
    model: string,
    includeResponseFormat: boolean,
  ): Promise<Response> {
    const timeoutMs = request.timeoutMs ?? this.options.requestTimeoutMs
    return this.fetcher(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resolveApiKey(model)}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
        ...(includeResponseFormat && request.responseFormat === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}),
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  private resolveModel(model: string | null | undefined): string {
    const selected = model?.trim()
    // The default logical model follows TEXT_MODEL so existing deployments keep
    // their configured GPT model without requiring a migration.
    return !selected || selected === 'seqora-5.6' ? this.options.model : selected
  }

  private resolveApiKey(model: string): string {
    return this.options.alternateApiKey && this.options.alternateModels?.includes(model)
      ? this.options.alternateApiKey
      : this.options.apiKey
  }

  private recordTokenUsage(
    request: TextGenerationRequest,
    model: string,
    usage: ProviderTokenUsage | null,
  ): void {
    recordTextProviderUsage({
      provider: 'tokenadvent-gpt',
      model,
      usageContext: request.usageContext ?? null,
      usage,
    })
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

async function readCompletionStream(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number,
  onTextProgress?: (text: string) => void,
): Promise<{
  text: string
  usage: ProviderTokenUsage | null
  firstTokenAfterHeadersMs: number | null
  generationMs: number | null
}> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const startedAt = Date.now()
  let buffered = ''
  let content = ''
  let usage: ProviderTokenUsage | null = null
  let firstTokenAt: number | null = null
  let streamFinished = false

  const consume = (line: string): void => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload) return
    if (payload === '[DONE]') {
      streamFinished = true
      return
    }
    let value: unknown
    try {
      value = JSON.parse(payload)
    } catch {
      return
    }
    if (!isRecord(value)) return
    usage = providerTokenUsageFromPayload(value) ?? usage
    const next = completionText(value)
    content += next
    if (next) {
      firstTokenAt ??= Date.now()
      notifyTextProgress(onTextProgress, content)
    }
    if (streamChunkFinished(value)) streamFinished = true
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
      for (const line of lines) {
        consume(line)
        if (streamFinished) break
      }
      if (streamFinished) {
        await reader.cancel().catch(() => {})
        break
      }
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
  if (!result) throw new InvalidTextResponseError()
  return {
    text: result,
    usage,
    firstTokenAfterHeadersMs: firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAt),
    generationMs: firstTokenAt === null ? null : Math.max(0, Date.now() - firstTokenAt),
  }
}

function streamChunkFinished(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.done === true || value.finished === true || value.status === 'completed') return true
  if (!Array.isArray(value.choices)) return false
  return value.choices.some(
    (choice) =>
      isRecord(choice) && typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0,
  )
}

function notifyTextProgress(onTextProgress: ((text: string) => void) | undefined, text: string): void {
  if (!onTextProgress || !text) return
  try {
    onTextProgress(text)
  } catch {
    // A preview must never interrupt the provider completion.
  }
}

function notifyTextTiming(
  onTextTiming: ((timing: TextGenerationTiming) => void) | undefined,
  timing: TextGenerationTiming,
): void {
  if (!onTextTiming) return
  try {
    onTextTiming(timing)
  } catch {
    // Timing is diagnostic data and must never interrupt generation.
  }
}

function timeoutError(): DOMException {
  return new DOMException('TokenAdvent text stream timed out', 'TimeoutError')
}

function completionText(value: unknown): string {
  if (!isRecord(value)) return textFromValue(value)
  const direct = textFromValue(value.output_text ?? value.text ?? value.content)
  if (direct) return direct
  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (!isRecord(choice)) continue
      const delta = isRecord(choice.delta) ? choice.delta : undefined
      const message = isRecord(choice.message) ? choice.message : undefined
      const content = textFromValue(
        delta?.content ?? delta?.text ?? message?.content ?? message?.text ?? choice.text ?? choice.content,
      )
      if (content) return content
    }
  }
  for (const key of ['data', 'result', 'output', 'response', 'payload']) {
    if (key in value) {
      const nested = completionText(value[key])
      if (nested) return nested
    }
  }
  return ''
}

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part
        if (!isRecord(part)) return ''
        return textFromValue(part.text ?? part.content ?? part.value)
      })
      .filter(Boolean)
      .join('')
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function publicProviderError(error: unknown, model: string): TextGenerationProviderError {
  if (error instanceof TokenAdventHttpError) {
    if (error.status === 404) {
      return new TextGenerationProviderError(`模型 ${model} 当前未在中转账号中开通，请切换模型后重试`, {
        cause: error,
      })
    }
    if (error.status === 503) {
      return new TextGenerationProviderError(`模型 ${model} 上游暂时不可用，请切换模型或稍后重试`, {
        cause: error,
      })
    }
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
