import type { Image2Assist, Image2Quality, Image2ReferenceRole } from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'

type Fetcher = typeof fetch

export type Image2AssistReference = {
  id: string
  name: string
  role: Image2ReferenceRole
  referenceNumber: number
  source: {
    storageKey: string
    contentType: string
  }
  visionDescription?: string
  visionModel?: string
}

export type Image2PromptOptimizationResult = {
  requested: boolean
  status: 'disabled' | 'optimized' | 'unchanged' | 'skipped'
  prompt: string
  reason: string
  elapsedMs: number
  model?: string
}

export type Image2ReferenceVisionResult = {
  requested: boolean
  status: 'disabled' | 'analyzed' | 'skipped'
  reason: string
  elapsedMs: number
  analyzedCount: number
  model?: string
}

export type Image2AssistResult = {
  prompt: string
  references: Image2AssistReference[]
  promptOptimization: Image2PromptOptimizationResult
  referenceVision: Image2ReferenceVisionResult
}

export type Image2AssistOptions = {
  baseUrl: string
  apiKey: string
  model: string
  requestTimeoutMs: number
  objectStorage: ObjectStorage | null
  fetcher?: Fetcher
}

const REFERENCE_VISION_ROLES = new Set<Image2ReferenceRole>([
  'clothing',
  'accessory',
  'style',
  'composition',
  'color',
])

export class Image2AssistService {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher

  constructor(private readonly options: Image2AssistOptions) {
    this.baseUrl = options.baseUrl?.trim().replace(/\/+$/, '') ?? ''
    this.fetcher = options.fetcher ?? fetch
  }

  async prepare(input: {
    assist: Image2Assist
    prompt: string
    aspectRatio: string
    quality: Image2Quality
    imageModel: string
    references: Image2AssistReference[]
  }): Promise<Image2AssistResult> {
    const vision = input.assist.referenceVision
      ? await this.analyzeReferences(input.references)
      : { descriptions: new Map<string, string>(), summary: disabledReferenceVision() }
    const references = referencesWithVisionDescriptions(
      input.references,
      vision.descriptions,
      this.options.model,
    )
    const optimization = input.assist.promptOptimization
      ? await this.optimizePrompt({
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          quality: input.quality,
          imageModel: input.imageModel,
          references,
        })
      : disabledPromptOptimization(input.prompt)

    return {
      prompt: optimization.prompt,
      references,
      promptOptimization: optimization,
      referenceVision: vision.summary,
    }
  }

  private async optimizePrompt(input: {
    prompt: string
    aspectRatio: string
    quality: Image2Quality
    imageModel: string
    references: Image2AssistReference[]
  }): Promise<Image2PromptOptimizationResult> {
    const startedAt = Date.now()
    if (!this.options.apiKey) {
      return skippedPromptOptimization(input.prompt, '序幕 image2 chat 服务尚未配置', 0, this.options.model)
    }

    try {
      const text = await this.requestCompletion({
        messages: promptOptimizationMessages(input),
        maxOutputTokens: 800,
        responseFormat: 'json',
      })
      const optimizedPrompt = parseOptimizedPrompt(text)
      const elapsedMs = Date.now() - startedAt
      if (!isUsableOptimizedPrompt(optimizedPrompt)) {
        return skippedPromptOptimization(
          input.prompt,
          '优化模型未返回可用提示词',
          elapsedMs,
          this.options.model,
        )
      }
      return {
        requested: true,
        status: optimizedPrompt === input.prompt ? 'unchanged' : 'optimized',
        prompt: optimizedPrompt,
        reason: '',
        elapsedMs,
        model: this.options.model,
      }
    } catch (error) {
      return skippedPromptOptimization(
        input.prompt,
        readableError(error),
        Date.now() - startedAt,
        this.options.model,
      )
    }
  }

  private async analyzeReferences(references: Image2AssistReference[]): Promise<{
    descriptions: Map<string, string>
    summary: Image2ReferenceVisionResult
  }> {
    const eligible = references.filter((reference) => REFERENCE_VISION_ROLES.has(reference.role))
    if (!eligible.length) return { descriptions: new Map(), summary: disabledReferenceVision() }
    if (!this.options.apiKey || !this.options.objectStorage) {
      return {
        descriptions: new Map(),
        summary: {
          requested: true,
          status: 'skipped',
          reason: '序幕 image2 chat 服务尚未配置',
          elapsedMs: 0,
          analyzedCount: 0,
          model: this.options.model,
        },
      }
    }

    const startedAt = Date.now()
    const descriptions = new Map<string, string>()
    await Promise.all(
      eligible.map(async (reference) => {
        const description = await this.analyzeReference(reference).catch(() => '')
        if (description) descriptions.set(reference.id, description)
      }),
    )
    const analyzedCount = descriptions.size
    return {
      descriptions,
      summary: {
        requested: true,
        status: analyzedCount > 0 ? 'analyzed' : 'skipped',
        reason: analyzedCount > 0 ? '' : '视觉解析未返回可用描述',
        elapsedMs: Date.now() - startedAt,
        analyzedCount,
        model: this.options.model,
      },
    }
  }

  private async analyzeReference(reference: Image2AssistReference): Promise<string> {
    const content = await this.options.objectStorage!.get(reference.source.storageKey)
    const text = await this.requestCompletion({
      messages: referenceVisionMessages(reference, content),
      maxOutputTokens: 180,
      responseFormat: 'json',
    })
    return parseReferenceVisionDescription(text)
  }

  private async requestCompletion(input: {
    messages: ChatMessage[]
    maxOutputTokens: number
    responseFormat: 'json' | 'text'
  }): Promise<string> {
    let response = await this.fetchCompletion(input, true)
    if (!response.ok && response.status === 400 && input.responseFormat === 'json') {
      response = await this.fetchCompletion(input, false)
    }
    if (!response.ok) throw await chatError(response)
    const payload = await response.json()
    const text = completionText(payload)
    if (!text) throw new Error('image2 chat 返回了无法解析的文本响应')
    return text.trim()
  }

  private fetchCompletion(
    input: { messages: ChatMessage[]; maxOutputTokens: number; responseFormat: 'json' | 'text' },
    includeResponseFormat: boolean,
  ): Promise<Response> {
    return this.fetcher(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: input.messages,
        max_completion_tokens: input.maxOutputTokens,
        ...(includeResponseFormat && input.responseFormat === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}),
        stream: false,
      }),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
  }
}

type ChatMessage = {
  role: 'system' | 'user'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

function promptOptimizationMessages(input: {
  prompt: string
  aspectRatio: string
  quality: Image2Quality
  imageModel: string
  references: Image2AssistReference[]
}): ChatMessage[] {
  const referenceLines = input.references
    .filter((reference) => reference.visionDescription)
    .map(
      (reference) =>
        `图 ${reference.referenceNumber}（${referenceRoleLabel(reference.role)}）：${reference.visionDescription}`,
    )
  return [
    {
      role: 'system',
      content: [
        'You are an image-prompt editor, not a safety reviewer.',
        "Improve the user's prompt for clear, high-quality image generation while preserving the original subject, action, count, identity, mood, style, text requirements, and constraints.",
        "Add useful visual, lighting, composition, material, and camera details only when they support the user's intent.",
        "Do not make a policy decision, do not block the request, and do not replace the user's intent with a different concept.",
        'If the prompt is already detailed, return it unchanged.',
        'Return only valid JSON with one key: optimized_prompt.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Target image model: ${input.imageModel}`,
        `Size: ${input.aspectRatio || 'auto'}`,
        `Quality: ${input.quality}`,
        `Reference images: ${input.references.length}`,
        referenceLines.length ? `Reference descriptions:\n${referenceLines.join('\n')}` : '',
        `Prompt: ${input.prompt}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}

function referenceVisionMessages(reference: Image2AssistReference, content: Buffer): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You describe visual references for image generation.',
        'Focus only on the visible image and the assigned role.',
        'For clothing, hat/accessory, style, composition, and color references, describe the specific visual traits that help the image model follow the user intent.',
        'Do not identify people, do not mention policy or safety, and do not invent details that are not visible.',
        'Return only valid JSON with one key: visual_description.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            `Image label: 图 ${reference.referenceNumber}`,
            `Assigned role: ${referenceRoleLabel(reference.role)}`,
            'Write a concise description that helps preserve this role in the final image.',
          ].join('\n'),
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${reference.source.contentType};base64,${content.toString('base64')}`,
          },
        },
      ],
    },
  ]
}

function referencesWithVisionDescriptions(
  references: Image2AssistReference[],
  descriptions: Map<string, string>,
  model: string,
): Image2AssistReference[] {
  return references.map((reference) => {
    const visionDescription = descriptions.get(reference.id)
    return visionDescription ? { ...reference, visionDescription, visionModel: model } : reference
  })
}

function disabledPromptOptimization(prompt: string): Image2PromptOptimizationResult {
  return { requested: false, status: 'disabled', prompt, reason: '', elapsedMs: 0 }
}

function skippedPromptOptimization(
  prompt: string,
  reason: string,
  elapsedMs: number,
  model: string,
): Image2PromptOptimizationResult {
  return { requested: true, status: 'skipped', prompt, reason, elapsedMs, model }
}

function disabledReferenceVision(): Image2ReferenceVisionResult {
  return {
    requested: false,
    status: 'disabled',
    reason: '',
    elapsedMs: 0,
    analyzedCount: 0,
  }
}

function parseOptimizedPrompt(text: string): string {
  return parseJsonStringField(text, ['optimized_prompt', 'optimizedPrompt', 'prompt'])
}

function parseReferenceVisionDescription(text: string): string {
  return normalizeDescription(
    parseJsonStringField(text, ['visual_description', 'visualDescription', 'description']),
  )
}

function parseJsonStringField(text: string, keys: string[]): string {
  const stripped = stripJsonFence(text)
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  for (const candidate of [stripped, jsonMatch?.[0]].filter(Boolean) as string[]) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      for (const key of keys) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
    } catch {
      // The provider may return plain text despite the requested JSON shape.
    }
  }
  return stripped.startsWith('{') ? '' : stripped
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
}

function normalizeDescription(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}

function isUsableOptimizedPrompt(prompt: string): boolean {
  const value = prompt.trim()
  if (value.length < 3 || value.length > 4_000) return false
  return !/(?:i\s+(?:cannot|can't|won't)\s+(?:assist|help|comply)|无法(?:帮助|协助|优化|处理)|不能(?:帮助|协助|优化|处理)|content\s+policy|违反.{0,8}(?:政策|规定))/i.test(
    value,
  )
}

function completionText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return ''
  const direct = textFromValue(value.output_text ?? value.text ?? value.content)
  if (direct) return direct
  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (!isRecord(choice)) continue
      const delta = isRecord(choice.delta) ? choice.delta : undefined
      const message = isRecord(choice.message) ? choice.message : undefined
      const content = textFromValue(
        delta?.content ??
          delta?.text ??
          message?.content ??
          message?.text ??
          message?.reasoning_content ??
          choice.text ??
          choice.content,
      )
      if (content) return content
    }
  }
  return ''
}

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => (isRecord(part) ? textFromValue(part.text ?? part.content ?? part.value) : ''))
      .filter(Boolean)
      .join('')
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function chatError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '')
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message || parsed.message || message
  } catch {
    // Keep bounded raw text when the provider does not return JSON.
  }
  return new Error(`序幕 image2 chat 请求失败 (${response.status})${message ? `: ${message}` : ''}`)
}

function readableError(error: unknown): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return '序幕 image2 chat 等待超时'
  }
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
}

function referenceRoleLabel(role: Image2ReferenceRole): string {
  return (
    {
      subject: '主体',
      clothing: '服装',
      accessory: '帽子/配饰',
      style: '风格',
      composition: '构图',
      color: '色调',
    } satisfies Record<Image2ReferenceRole, string>
  )[role]
}
