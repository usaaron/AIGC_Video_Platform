export type TextGenerationRequest = {
  systemPrompt: string
  userPrompt: string
  maxOutputTokens?: number
  model?: string | undefined
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
