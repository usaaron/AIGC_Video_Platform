import { z } from 'zod'
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationSubmission,
} from './imageProvider.js'
import type { GenerationTask } from '@seqora/contracts'

const providerOutputSchema = z
  .object({
    id: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    image_url: z.string().min(1).optional(),
    output_url: z.string().min(1).optional(),
    view: z.enum(['single', 'front', 'side', 'back', 'detail']).optional(),
  })
  .passthrough()

const imageTaskResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    task_id: z.string().min(1).optional(),
    status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'unknown']).optional(),
    progress: z.number().int().min(0).max(100).optional().default(0),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough().optional(),
    data: z.array(providerOutputSchema).optional(),
    images: z.array(providerOutputSchema).optional(),
    outputs: z.array(providerOutputSchema).optional(),
  })
  .passthrough()

type Fetcher = typeof fetch

export type AideosImageProviderOptions = {
  baseUrl: string
  apiKey: string
  defaultModel: string
  requestTimeoutMs: number
  fetcher?: Fetcher
}

export class AideosImageProvider implements ImageGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly completedSubmissions = new Map<string, GenerationTask['outputs']>()
  private readonly requestedViews = new Map<string, ImageGenerationRequest['outputs']>()

  constructor(private readonly options: AideosImageProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
  }

  async submit(request: ImageGenerationRequest): Promise<ImageGenerationSubmission> {
    const referenceImages = referenceImagesFor(request)
    const payload = {
      model: this.resolveModel(request.model),
      prompt: request.prompt.trim(),
      ...(request.negativePrompt.trim() ? { negative_prompt: request.negativePrompt.trim() } : {}),
      aspect_ratio: request.aspectRatio,
      n: request.outputs.length,
      ...(request.referenceUrls.length > 0 ? { images: request.referenceUrls } : {}),
      ...(referenceImages.length > 0 ? { reference_images: referenceImages } : {}),
      ...(request.faceReferenceUrl ? { face_reference_url: request.faceReferenceUrl } : {}),
      ...(request.bodyReferenceUrl ? { body_reference_url: request.bodyReferenceUrl } : {}),
      metadata: {
        task_id: request.taskId,
        asset_id: request.assetId,
        aspect_ratio: request.aspectRatio,
        output_views: request.outputs,
        ...(request.faceReferenceUrl ? { face_reference_url: request.faceReferenceUrl } : {}),
        ...(request.bodyReferenceUrl ? { body_reference_url: request.bodyReferenceUrl } : {}),
        ...(request.attributes ? { attributes: request.attributes } : {}),
      },
    }
    if (!payload.prompt) throw new Error('Img2 图片提示词不能为空')

    const response = await this.requestJson('/v1/image/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const parsed = imageTaskResponseSchema.parse(response)
    const providerTaskId = parsed.task_id ?? parsed.id ?? request.taskId
    this.requestedViews.set(providerTaskId, request.outputs)
    const outputs = outputsFor(parsed, providerTaskId, request.outputs)

    if (outputs.length > 0) {
      this.completedSubmissions.set(providerTaskId, outputs)
      return { providerTaskId, status: 'completed', progress: 100, outputs }
    }

    if (parsed.status === 'completed') throw new Error('Aideos 图片生成完成但没有返回图片 URL')
    if (parsed.status === 'failed') throw new Error(errorMessageFor(parsed) || 'Aideos 图片生成失败')

    return {
      providerTaskId,
      status: parsed.status === 'queued' ? 'queued' : 'running',
      progress: Math.max(1, parsed.progress),
      outputs: [],
    }
  }

  async getStatus(
    providerTaskId: string,
  ): Promise<Pick<GenerationTask, 'status' | 'progress' | 'outputs' | 'error'>> {
    const cachedOutputs = this.completedSubmissions.get(providerTaskId)
    if (cachedOutputs) {
      return { status: 'completed', progress: 100, outputs: cachedOutputs, error: null }
    }

    const response = await this.requestJson(`/v1/images/${encodeURIComponent(providerTaskId)}`, {
      method: 'GET',
    })
    const parsed = imageTaskResponseSchema.parse(response)
    const requestedViews = this.requestedViews.get(providerTaskId) ?? ['single']
    const outputs = outputsFor(parsed, providerTaskId, requestedViews)
    if (outputs.length > 0 || parsed.status === 'completed') {
      if (!outputs.length) {
        this.requestedViews.delete(providerTaskId)
        return {
          status: 'failed',
          progress: 100,
          outputs: [],
          error: 'Aideos 图片生成完成但没有返回图片 URL',
        }
      }
      this.requestedViews.delete(providerTaskId)
      return { status: 'completed', progress: 100, outputs, error: null }
    }
    if (parsed.status === 'failed') {
      this.requestedViews.delete(providerTaskId)
      return {
        status: 'failed',
        progress: 100,
        outputs: [],
        error: errorMessageFor(parsed) || 'Aideos 图片生成失败',
      }
    }
    return { status: 'running', progress: Math.max(1, parsed.progress), outputs: [], error: null }
  }

  private resolveModel(model: string | null): string {
    return model && model !== 'img2-default' ? model : this.options.defaultModel
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
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
      message = parsed.error?.message || parsed.message || message
    } catch {
      // Keep the bounded text response when the provider does not return JSON.
    }
    throw new Error(`Aideos 请求失败 (${response.status})${message ? `: ${message}` : ''}`)
  }
}

function referenceImagesFor(
  request: ImageGenerationRequest,
): Array<{ role: 'face' | 'body' | 'reference'; url: string }> {
  const references: Array<{ role: 'face' | 'body' | 'reference'; url: string }> = []
  if (request.faceReferenceUrl) references.push({ role: 'face', url: request.faceReferenceUrl })
  if (request.bodyReferenceUrl) references.push({ role: 'body', url: request.bodyReferenceUrl })
  request.referenceUrls.forEach((url) => {
    if (references.some((reference) => reference.url === url)) return
    references.push({ role: 'reference', url })
  })
  return references
}

function outputsFor(
  response: z.infer<typeof imageTaskResponseSchema>,
  providerTaskId: string,
  requestedViews: ImageGenerationRequest['outputs'],
): GenerationTask['outputs'] {
  const rawOutputs = response.outputs ?? response.data ?? response.images ?? []
  const outputs: GenerationTask['outputs'] = []
  rawOutputs.forEach((output, index) => {
    const url = output.url ?? output.image_url ?? output.output_url
    if (!url) return
    const view = output.view ?? requestedViews[index] ?? 'single'
    outputs.push({
      id: output.id ?? `${providerTaskId}-${view}-${index + 1}`,
      url,
      mediaType: 'image',
      view,
    })
  })
  return outputs
}

function errorMessageFor(response: z.infer<typeof imageTaskResponseSchema>): string {
  return response.error?.message || response.error?.code || ''
}
