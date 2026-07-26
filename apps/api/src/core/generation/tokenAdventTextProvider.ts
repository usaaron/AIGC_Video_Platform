import { OpenAIChatTextProvider, type OpenAIChatTextOptions } from './openAIChatTextProvider.js'

export type TokenAdventTextOptions = Omit<OpenAIChatTextOptions, 'providerLabel'>

export class TokenAdventTextProvider extends OpenAIChatTextProvider {
  constructor(options: TokenAdventTextOptions) {
    super({ ...options, providerLabel: 'TokenAdvent GPT text' })
  }
}
