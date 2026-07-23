import type { Asset } from '@seqora/contracts'

export type ImageReference = {
  name: string
  contentType: string
  content: Buffer
}

export type ImageGenerationRequest = {
  taskId: string
  assetId: string
  aspectRatio: string
  prompt: string
  negativePrompt: string
  references: ImageReference[]
  attributes?: Asset['attributes']
  outputs: Array<'single' | 'front' | 'side' | 'back' | 'detail'>
}

export type ImageGenerationOutput = {
  view: 'single' | 'front' | 'side' | 'back' | 'detail'
  contentType: string
  content: Buffer
}

export interface ImageGenerationProvider {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationOutput[]>
}
