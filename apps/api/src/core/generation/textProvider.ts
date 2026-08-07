export type TextGenerationRequest = {
  systemPrompt: string
  userPrompt: string
  maxOutputTokens?: number
  responseFormat?: 'text' | 'json'
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
