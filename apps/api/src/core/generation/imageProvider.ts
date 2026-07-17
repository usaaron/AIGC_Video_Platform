import type { Asset, GenerationTask } from '@seqora/contracts'

export type ImageGenerationRequest = {
  taskId: string
  assetId: string
  aspectRatio: string
  prompt: string
  negativePrompt: string
  referenceUrls: string[]
  attributes: Asset['attributes']
  outputs: Array<'single' | 'front' | 'side' | 'back' | 'detail'>
}

export type ImageGenerationSubmission = {
  providerTaskId: string
  status: 'queued' | 'running'
}

export interface ImageGenerationProvider {
  submit(request: ImageGenerationRequest): Promise<ImageGenerationSubmission>
  getStatus(
    providerTaskId: string,
  ): Promise<Pick<GenerationTask, 'status' | 'progress' | 'outputs' | 'error'>>
}
