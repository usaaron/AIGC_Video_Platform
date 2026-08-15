import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from './imageProvider.js'

const MAX_IMAGE_REQUEST_ATTEMPTS = 3
const IMAGE_MODERATION = 'low'
const IMAGE_PARTIAL_COUNT = 2
const IMAGE_OUTPUT_FORMAT = 'png'

type Fetcher = typeof fetch
type ImageQuality = NonNullable<ImageGenerationRequest['quality']>
type ResolvedProviderImage = Pick<ImageGenerationOutput, 'contentType' | 'content'>

type ProviderImageCandidate = {
  url: string
  base64: string
  contentType: string
  partial: boolean
}

export type TokenAdventImageOptions = {
  baseUrl: string
  apiKey: string
  model: string
  quality: ImageQuality
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
    const references = request.references.slice(0, 5)
    const quality = request.quality ?? this.options.quality
    for (const view of request.outputs) {
      const prompt = promptFor({ ...request, references }, view)
      const idempotencyKey = request.idempotencyKey ? `${request.idempotencyKey}:${view}` : undefined
      const response = references.length
        ? await this.edit(prompt, request.aspectRatio, quality, references, idempotencyKey)
        : await this.create(prompt, request.aspectRatio, quality, idempotencyKey)
      outputs.push({
        view,
        contentType: response.contentType,
        content: response.content,
      })
    }
    return outputs
  }

  private create(
    prompt: string,
    aspectRatio: string,
    quality: ImageQuality,
    idempotencyKey?: string,
  ): Promise<ResolvedProviderImage> {
    const size = sizeFor(aspectRatio)
    return this.requestImage('/v1/images/generations', {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream, application/json',
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        model: this.options.model,
        prompt,
        n: 1,
        ...(size ? { size } : {}),
        quality,
        output_format: IMAGE_OUTPUT_FORMAT,
        moderation: IMAGE_MODERATION,
        stream: true,
        partial_images: IMAGE_PARTIAL_COUNT,
      }),
    })
  }

  private edit(
    prompt: string,
    aspectRatio: string,
    quality: ImageQuality,
    references: ImageGenerationRequest['references'],
    idempotencyKey?: string,
  ): Promise<ResolvedProviderImage> {
    const size = sizeFor(aspectRatio)
    const body = new FormData()
    body.set('model', this.options.model)
    body.set('prompt', prompt)
    if (size) body.set('size', size)
    body.set('quality', quality)
    body.set('output_format', IMAGE_OUTPUT_FORMAT)
    body.set('moderation', IMAGE_MODERATION)
    body.set('stream', 'true')
    body.set('partial_images', String(IMAGE_PARTIAL_COUNT))
    for (const reference of references.slice(0, 5)) {
      body.append(
        'image[]',
        new Blob([Uint8Array.from(reference.content)], { type: reference.contentType }),
        reference.name,
      )
    }
    return this.requestImage('/v1/images/edits', {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream, application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body,
    })
  }

  private async requestImage(path: string, init: RequestInit): Promise<ResolvedProviderImage> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_IMAGE_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        return await fetchImageWithTimeout(
          this.fetcher,
          `${this.baseUrl}${path}`,
          {
            ...init,
            headers: { Authorization: `Bearer ${this.options.apiKey}`, ...init.headers },
          },
          this.options.requestTimeoutMs,
        )
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

class TokenAdventImageResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenAdventImageResponseError'
  }
}

class TokenAdventImageAssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenAdventImageAssetError'
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
  const prompt = request.references.length
    ? `${referencePromptGuide(request.references)}\n\n用户需求：${request.prompt}`
    : request.prompt
  return [prompt, viewPrompt, request.negativePrompt ? `避免出现：${request.negativePrompt}` : '']
    .filter(Boolean)
    .join('\n')
}

function referencePromptGuide(references: ImageGenerationRequest['references']): string {
  const entries = references.map((reference, index) => {
    const number = reference.referenceNumber ?? index + 1
    const visualDescription = reference.visionDescription?.trim()
    const visualSuffix = visualDescription ? ` 视觉描述：${visualDescription}` : ''
    return `图 ${number}（${reference.name}）：${referenceRolePromptLabel(reference.role)}。${visualSuffix}`
  })
  return [
    '引用图片：',
    ...entries,
    '请严格按用户提示中对图号的引用理解每张图的用途，不要把主体图和服装、配饰、风格参考图互换。',
  ].join('\n')
}

function referenceRolePromptLabel(role: ImageGenerationRequest['references'][number]['role']): string {
  return (
    {
      subject: '主体角色，只保留身份、脸部、姿态',
      clothing: '仅参考服装',
      accessory: '仅参考帽子/配饰',
      style: '仅参考风格',
      composition: '仅参考构图',
      color: '仅参考色调和滤镜',
    }[role ?? 'style'] ?? '仅作为参考'
  )
}

function sizeFor(aspectRatio: string): string | undefined {
  if (aspectRatio === 'auto') return undefined
  if (/^\d+x\d+$/.test(aspectRatio)) return aspectRatio
  return (
    {
      '1:1': '1024x1024',
      '9:16': '864x1536',
      '16:9': '1536x864',
      '2:3': '1024x1536',
      '3:2': '1536x1024',
      '3:4': '1024x1365',
      '4:3': '1365x1024',
      '4:5': '1024x1280',
      '5:4': '1280x1024',
    }[aspectRatio] || '1024x1024'
  )
}

async function fetchImageWithTimeout(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<ResolvedProviderImage> {
  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new DOMException('TokenAdvent image request timed out', 'TimeoutError'))
    }, timeoutMs)
  })
  const request = (async () => {
    const response = await fetcher(url, { ...init, signal: controller.signal })
    const responseContentType = normalizeContentType(response.headers.get('content-type'))
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw providerError(response.status, body)
    }
    if (responseContentType.startsWith('image/')) {
      const content = Buffer.from(await response.arrayBuffer())
      return resolvedImage(content, responseContentType)
    }

    const body = await response.text().catch(() => '')
    const candidate = parseProviderImageResponse(body, responseContentType)
    if (!candidate) {
      throw new TokenAdventImageResponseError('TokenAdvent 返回了无法解析的图片响应')
    }
    return resolveProviderImage(fetcher, candidate, controller.signal)
  })()
  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function parseProviderImageResponse(
  text: string,
  responseContentType = '',
): ProviderImageCandidate | null {
  const raw = String(text || '').trim()
  if (!raw) return null

  if (responseContentType.includes('text/event-stream') || looksLikeEventStream(raw)) {
    return parseProviderImageStream(raw)
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return candidateFromString(raw)
  }

  const errorMessage = payloadErrorMessage(payload)
  if (errorMessage) throw new TokenAdventImageResponseError(errorMessage)
  const candidates = providerImageCandidates(payload)
  return candidates.find((candidate) => !candidate.partial) ?? candidates.at(-1) ?? null
}

function parseProviderImageStream(text: string): ProviderImageCandidate | null {
  const finalImages: ProviderImageCandidate[] = []
  const partialImages: ProviderImageCandidate[] = []

  for (const event of parseProviderImageEvents(text)) {
    const eventType = event.type.toLowerCase()
    const errorMessage = payloadErrorMessage(event.payload)
    if (
      errorMessage ||
      eventType.includes('error') ||
      eventType.endsWith('.failed') ||
      eventType.includes('failed')
    ) {
      throw new TokenAdventImageResponseError(
        errorMessage || 'TokenAdvent 图片流返回失败事件',
      )
    }

    for (const candidate of providerImageCandidates(event.payload)) {
      const normalized = {
        ...candidate,
        partial: candidate.partial || eventType.includes('partial'),
      }
      if (normalized.partial) partialImages.push(normalized)
      else finalImages.push(normalized)
    }
  }

  return finalImages.at(-1) ?? partialImages.at(-1) ?? null
}

function parseProviderImageEvents(
  text: string,
): Array<{ type: string; payload: unknown }> {
  const events: Array<{ type: string; payload: unknown }> = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let block: string[] = []

  const flush = () => {
    if (!block.length) return
    const type =
      block
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim() ?? ''
    const data = block
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^\s+/, ''))
      .join('\n')
      .trim()
    block = []
    if (!data || data === '[DONE]') return

    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      payload = data
    }
    const payloadType = isRecord(payload) && typeof payload.type === 'string' ? payload.type : ''
    events.push({ type: payloadType || type, payload })
  }

  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    block.push(line)
  }
  flush()
  return events
}

function providerImageCandidates(value: unknown): ProviderImageCandidate[] {
  if (typeof value === 'string') {
    const candidate = candidateFromString(value)
    return candidate ? [candidate] : []
  }
  if (Array.isArray(value)) return value.flatMap(providerImageCandidates)
  if (!isRecord(value)) return []

  const candidates: ProviderImageCandidate[] = []
  const direct = candidateFromRecord(value)
  if (direct) candidates.push(direct)

  if ('data' in value) candidates.push(...providerImageCandidates(value.data))
  if (!candidates.length) {
    for (const key of ['result', 'output', 'response', 'payload']) {
      if (key in value) candidates.push(...providerImageCandidates(value[key]))
      if (candidates.length) break
    }
  }
  return candidates
}

function candidateFromRecord(value: Record<string, unknown>): ProviderImageCandidate | null {
  const contentType = firstString(value.media_type, value.mime_type, value.mimeType)
  const url = imageUrlFromValue(value.url) || imageUrlFromValue(value.image_url)
  const partialBase64 = firstString(value.partial_image_b64)
  const base64 = firstString(value.b64_json, value.base64, partialBase64)
  if (!url && !base64) return null
  return {
    url,
    base64,
    contentType,
    partial: Boolean(partialBase64) || stringValue(value.type).toLowerCase().includes('partial'),
  }
}

function candidateFromString(value: string): ProviderImageCandidate | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (/^data:image\/[^;,]+;base64,/i.test(normalized)) {
    return { url: normalized, base64: '', contentType: '', partial: false }
  }
  if (/^https?:\/\//i.test(normalized)) {
    return { url: normalized, base64: '', contentType: '', partial: false }
  }
  if (looksLikeBase64(normalized)) {
    return { url: '', base64: normalized, contentType: '', partial: false }
  }
  return null
}

function imageUrlFromValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!isRecord(value)) return ''
  return stringValue(value.url)
}

async function resolveProviderImage(
  fetcher: Fetcher,
  candidate: ProviderImageCandidate,
  signal: AbortSignal,
): Promise<ResolvedProviderImage> {
  if (candidate.url) {
    if (candidate.url.startsWith('data:')) {
      return decodeBase64Image(candidate.url, candidate.contentType)
    }
    return downloadProviderImage(fetcher, candidate.url, candidate.contentType, signal)
  }
  if (candidate.base64) return decodeBase64Image(candidate.base64, candidate.contentType)
  throw new TokenAdventImageResponseError('TokenAdvent 图片响应不包含可用内容')
}

async function downloadProviderImage(
  fetcher: Fetcher,
  url: string,
  declaredContentType: string,
  signal: AbortSignal,
): Promise<ResolvedProviderImage> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new TokenAdventImageAssetError('TokenAdvent 返回了无效的图片 URL')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new TokenAdventImageAssetError('TokenAdvent 返回了不支持的图片 URL')
  }

  let response: Response
  try {
    response = await fetcher(parsedUrl, {
      method: 'GET',
      headers: { Accept: 'image/*' },
      signal,
    })
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw error
    throw new TokenAdventImageAssetError('TokenAdvent 图片 URL 下载失败')
  }
  if (!response.ok) {
    throw new TokenAdventImageAssetError(`TokenAdvent 图片 URL 下载失败 (${response.status})`)
  }
  const content = Buffer.from(await response.arrayBuffer())
  const responseContentType = normalizeContentType(response.headers.get('content-type'))
  return resolvedImage(
    content,
    responseContentType.startsWith('image/') ? responseContentType : declaredContentType,
  )
}

function decodeBase64Image(value: string, declaredContentType: string): ResolvedProviderImage {
  let base64 = value.trim()
  let dataUrlContentType = ''
  const dataUrl = /^data:([^;,]+)?;base64,(.*)$/is.exec(base64)
  if (dataUrl) {
    dataUrlContentType = dataUrl[1] || ''
    base64 = dataUrl[2] || ''
  }
  base64 = base64.replace(/\s+/g, '')
  if (!looksLikeBase64(base64)) {
    throw new TokenAdventImageResponseError('TokenAdvent 返回了无效的 Base64 图片')
  }
  return resolvedImage(
    Buffer.from(base64, 'base64'),
    dataUrlContentType || declaredContentType,
  )
}

function resolvedImage(content: Buffer, contentType: string): ResolvedProviderImage {
  if (!content.length) {
    throw new TokenAdventImageResponseError('TokenAdvent 返回了空图片')
  }
  return {
    content,
    contentType: imageContentType(content, contentType),
  }
}

function imageContentType(content: Buffer, declaredContentType: string): string {
  const normalized = normalizeImageContentType(declaredContentType)
  if (normalized) return normalized
  if (
    content.length >= 8 &&
    content[0] === 0x89 &&
    content.subarray(1, 4).toString('ascii') === 'PNG'
  ) {
    return 'image/png'
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (content.length >= 6 && /^GIF8[79]a$/.test(content.subarray(0, 6).toString('ascii'))) {
    return 'image/gif'
  }
  return 'image/png'
}

function normalizeImageContentType(value: string): string {
  const normalized = normalizeContentType(value)
  if (normalized.startsWith('image/')) return normalized
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
    }[normalized] ?? ''
  )
}

function normalizeContentType(value: string | null): string {
  return String(value || '')
    .split(';')[0]!
    .trim()
    .toLowerCase()
}

function looksLikeEventStream(value: string): boolean {
  return (
    value.startsWith('data:') ||
    value.startsWith('event:') ||
    value.includes('\n\ndata:') ||
    value.includes('\n\nevent:')
  )
}

function looksLikeBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, '')
  return (
    normalized.length >= 4 &&
    normalized.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  )
}

function payloadErrorMessage(value: unknown): string {
  if (!isRecord(value)) return ''
  if (value.error) return stringifyMessage(value.error)
  return typeof value.message === 'string' && !providerImageCandidates(value).length
    ? value.message
    : ''
}

function stringifyMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.message === 'string') return value.message
  try {
    return JSON.stringify(value).slice(0, 500)
  } catch {
    return String(value).slice(0, 500)
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = stringValue(value)
    if (normalized) return normalized
  }
  return ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function providerError(status: number, body: string): TokenAdventImageHttpError {
  let message = providerErrorMessage(body)
  if (status === 524 || /524:\s*A timeout occurred/i.test(body)) {
    message = '上游图片服务超时（524），本次图片没有生成成功；请稍后重试，或降低质量/减少参考图后再试'
  }
  if (status === 429) {
    message = '上游图片服务限流（429），请稍后重试'
  }
  return new TokenAdventImageHttpError(
    status,
    `TokenAdvent 图片请求失败 (${status})${message ? `: ${message}` : ''}`,
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
  return error instanceof TypeError
}

function retryDelayMs(attempt: number): number {
  return 750 * 2 ** attempt + Math.floor(Math.random() * 150)
}

function htmlTitle(body: string): string {
  return /<title>(.*?)<\/title>/is.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
}
