import type { GenerationTask } from '@seqora/contracts'
import { z } from 'zod'
import type {
  AudioGenerationProvider,
  AudioGenerationRequest,
  AudioGenerationSubmission,
} from './audioProvider.js'
import { fetchWithProviderTimeout } from './providerHttp.js'

const providerOutputSchema = z
  .object({
    id: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    audio_url: z.string().min(1).optional(),
    output_url: z.string().min(1).optional(),
  })
  .passthrough()

const audioTaskResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    task_id: z.string().min(1).optional(),
    status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'unknown']).optional(),
    progress: z.number().int().min(0).max(100).optional().default(0),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough().optional(),
    audio: providerOutputSchema.optional(),
    data: z.union([providerOutputSchema, z.array(providerOutputSchema)]).optional(),
    outputs: z.array(providerOutputSchema).optional(),
  })
  .passthrough()

type Fetcher = typeof fetch

export type AideosAudioProviderOptions = {
  baseUrl: string
  apiKey: string
  defaultModel: string
  requestTimeoutMs: number
  fetcher?: Fetcher
}

export class AideosAudioProvider implements AudioGenerationProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly completedSubmissions = new Map<string, GenerationTask['outputs']>()

  constructor(private readonly options: AideosAudioProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
  }

  async submit(request: AudioGenerationRequest): Promise<AudioGenerationSubmission> {
    const payload = {
      model: request.model || this.options.defaultModel,
      prompt: request.prompt.trim(),
      ...(request.negativePrompt.trim() ? { negative_prompt: request.negativePrompt.trim() } : {}),
      duration: request.duration,
      audio_type: request.audioType,
      loop: request.loop,
      ...(request.attributes ? { voice: voiceFor(request.attributes) } : {}),
      metadata: {
        task_id: request.taskId,
        asset_id: request.assetId,
        audio_type: request.audioType,
        duration: request.duration,
        loop: request.loop,
        ...(request.attributes ? { attributes: request.attributes } : {}),
      },
    }
    if (!payload.prompt) throw new Error('Audio prompt cannot be empty')

    const response = await this.requestJson('/v1/audio/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const parsed = audioTaskResponseSchema.parse(response)
    const providerTaskId = parsed.task_id ?? parsed.id ?? request.taskId
    const outputs = outputsFor(parsed, providerTaskId)

    if (outputs.length > 0) {
      this.completedSubmissions.set(providerTaskId, outputs)
      return { providerTaskId, status: 'completed', progress: 100, outputs }
    }

    if (parsed.status === 'completed') throw new Error('Aideos audio completed without an audio URL')
    if (parsed.status === 'failed')
      throw new Error(errorMessageFor(parsed) || 'Aideos audio generation failed')

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
    if (cachedOutputs) return { status: 'completed', progress: 100, outputs: cachedOutputs, error: null }

    const response = await this.requestJson(`/v1/audios/${encodeURIComponent(providerTaskId)}`, {
      method: 'GET',
    })
    const parsed = audioTaskResponseSchema.parse(response)
    const outputs = outputsFor(parsed, providerTaskId)
    if (outputs.length > 0 || parsed.status === 'completed') {
      if (!outputs.length) {
        return {
          status: 'failed',
          progress: 100,
          outputs: [],
          error: 'Aideos audio completed without an audio URL',
        }
      }
      return { status: 'completed', progress: 100, outputs, error: null }
    }
    if (parsed.status === 'failed') {
      return {
        status: 'failed',
        progress: 100,
        outputs: [],
        error: errorMessageFor(parsed) || 'Aideos audio generation failed',
      }
    }
    return { status: 'running', progress: Math.max(1, parsed.progress), outputs: [], error: null }
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.request(path, init)
    return response.json().catch(() => {
      throw new Error('Aideos returned invalid JSON')
    })
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetchWithProviderTimeout(
      'Aideos Audio',
      this.fetcher,
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      },
      this.options.requestTimeoutMs,
    )
    if (response.ok) return response

    const body = await response.text().catch(() => '')
    let message = body.slice(0, 500)
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
      message = parsed.error?.message || parsed.message || message
    } catch {
      // Keep the bounded text response when the provider does not return JSON.
    }
    throw new Error(`Aideos request failed (${response.status})${message ? `: ${message}` : ''}`)
  }
}

function voiceFor(attributes: AudioGenerationRequest['attributes']) {
  if (!attributes || attributes.audioType !== 'voice') return undefined
  return {
    gender: attributes.gender,
    age_group: attributes.ageGroup,
    emotion: attributes.emotion,
    tone: attributes.tone,
    speed: attributes.speed,
    language: attributes.language,
  }
}

function outputsFor(
  response: z.infer<typeof audioTaskResponseSchema>,
  providerTaskId: string,
): GenerationTask['outputs'] {
  const rawOutputs = normalizeOutputs(response)
  return rawOutputs.flatMap((output, index) => {
    const url = output.url ?? output.audio_url ?? output.output_url
    if (!url) return []
    return {
      id: output.id ?? `${providerTaskId}-audio-${index + 1}`,
      url,
      mediaType: 'audio' as const,
      view: 'single' as const,
    }
  })
}

function normalizeOutputs(
  response: z.infer<typeof audioTaskResponseSchema>,
): z.infer<typeof providerOutputSchema>[] {
  if (response.outputs?.length) return response.outputs
  if (response.audio) return [response.audio]
  if (!response.data) return []
  return Array.isArray(response.data) ? response.data : [response.data]
}

function errorMessageFor(response: z.infer<typeof audioTaskResponseSchema>): string {
  return response.error?.message || response.error?.code || ''
}
