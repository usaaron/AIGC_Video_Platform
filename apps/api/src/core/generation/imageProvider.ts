import type { Asset, GenerationTask } from '@seqora/contracts'

export type ImageGenerationRequest = {
  taskId: string
  assetId: string
  model: string | null
  aspectRatio: string
  prompt: string
  negativePrompt: string
  referenceUrls: string[]
  faceReferenceUrl: string | null
  bodyReferenceUrl: string | null
  attributes: Asset['attributes'] | null
  outputs: Array<'single' | 'front' | 'side' | 'back' | 'detail'>
}

export type ImageGenerationSubmission = {
  providerTaskId: string
  status: 'queued' | 'running' | 'completed'
  progress: number
  outputs: GenerationTask['outputs']
}

export interface ImageGenerationProvider {
  submit(request: ImageGenerationRequest): Promise<ImageGenerationSubmission>
  getStatus(
    providerTaskId: string,
  ): Promise<Pick<GenerationTask, 'status' | 'progress' | 'outputs' | 'error'>>
}
