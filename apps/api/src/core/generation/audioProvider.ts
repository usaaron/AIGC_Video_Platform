import type { Asset, GenerationTask } from '@seqora/contracts'

export type AudioGenerationRequest = {
  taskId: string
  assetId: string
  model: string | null
  prompt: string
  negativePrompt: string
  duration: number
  audioType: 'voice' | 'ambience' | 'sfx' | 'music'
  loop: boolean
  attributes: Extract<Asset['attributes'], { type: 'audio' }> | null
}

export type AudioGenerationSubmission = {
  providerTaskId: string
  status: GenerationTask['status']
  progress: number
  outputs: GenerationTask['outputs']
}

export interface AudioGenerationProvider {
  submit(request: AudioGenerationRequest): Promise<AudioGenerationSubmission>
  getStatus(
    providerTaskId: string,
  ): Promise<Pick<GenerationTask, 'status' | 'progress' | 'outputs' | 'error'>>
}
