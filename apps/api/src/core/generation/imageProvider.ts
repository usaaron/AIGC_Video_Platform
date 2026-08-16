import type { Asset, Image2Quality, Image2ReferenceRole } from '@seqora/contracts'

export type ImageReference = {
  name: string
  contentType: string
  content: Buffer
  role?: Image2ReferenceRole
  referenceNumber?: number
  visionDescription?: string
}

export type ImageGenerationRequest = {
  taskId: string
  idempotencyKey?: string
  assetId: string
  model?: string | null
  aspectRatio: string
  quality?: Image2Quality
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
