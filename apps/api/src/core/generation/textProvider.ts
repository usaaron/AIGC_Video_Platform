export type TextGenerationTiming = {
  label?: string
  outcome?: 'completed' | 'failed'
  responseHeadersMs: number | null
  firstTokenMs: number | null
  generationMs: number | null
  totalMs: number
  attempt: number
}

export type TextGenerationRequest = {
  systemPrompt: string
  userPrompt: string
  maxOutputTokens?: number
  responseFormat?: 'text' | 'json'
  /** Receives the accumulated visible completion while an upstream stream is active. */
  onTextProgress?: (text: string) => void
  /** Receives timing for each completed upstream call. */
  onTextTiming?: (timing: TextGenerationTiming) => void
  /** Labels a call when one logical operation performs a repair/retry request. */
  timingLabel?: string
  /** Logical model selected in the product; providers may map it to an upstream model. */
  model?: string
  usageContext?: {
    tenantId?: string | null
    organizationId?: string | null
    userId?: string | null
    traceId?: string | null
    taskId?: string | null
    jobId?: string | null
  }
}

export class TextGenerationProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TextGenerationProviderError'
  }
}

export interface TextGenerationProvider {
  generate(request: TextGenerationRequest): Promise<string>
}
