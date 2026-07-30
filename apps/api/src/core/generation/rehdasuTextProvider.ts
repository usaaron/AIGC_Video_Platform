import { OpenAIChatTextProvider, type OpenAIChatTextOptions } from './openAIChatTextProvider.js'
import type { TextGenerationRequest } from './textProvider.js'

export type RehdasuTextOptions = Omit<OpenAIChatTextOptions, 'providerLabel'>

const REHDASU_REASONING_MODEL_MIN_OUTPUT_TOKENS = 256

export class RehdasuTextProvider extends OpenAIChatTextProvider {
  private readonly defaultModel: string

  constructor(options: RehdasuTextOptions) {
    super({ ...options, providerLabel: 'Rehdasu 文本服务', maxTokensMode: 'max_tokens' })
    this.defaultModel = options.model
  }

  generate(request: TextGenerationRequest): Promise<string> {
    const model = (request.model || this.defaultModel).trim().toLowerCase()
    if (!requiresReasoningBudgetFloor(model)) return super.generate(request)
    return super.generate({
      ...request,
      maxOutputTokens: Math.max(
        request.maxOutputTokens ?? REHDASU_REASONING_MODEL_MIN_OUTPUT_TOKENS,
        REHDASU_REASONING_MODEL_MIN_OUTPUT_TOKENS,
      ),
    })
  }
}

function requiresReasoningBudgetFloor(model: string): boolean {
  return model === 'glm-5.2' || model === 'kimi-k3-thinking'
}
