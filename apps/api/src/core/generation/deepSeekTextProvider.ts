import { OpenAIChatTextProvider, type OpenAIChatTextOptions } from './openAIChatTextProvider.js'

export type DeepSeekTextOptions = Omit<OpenAIChatTextOptions, 'providerLabel' | 'completionsPath'> & {
  completionsPath?: string
}

export class DeepSeekTextProvider extends OpenAIChatTextProvider {
  constructor(options: DeepSeekTextOptions) {
    super({
      ...options,
      completionsPath: options.completionsPath ?? '/api/v1/chat/completions',
      providerLabel: 'DeepSeek V3',
      providerName: 'deepseek-v3',
    })
  }
}
