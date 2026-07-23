import type { Readable } from 'node:stream'

export type VideoProviderName = 'stringx-seedance' | 'aideos-seedance' | 'volc-ark-seedance'

export type VideoGenerationRequest = {
  taskId: string
  model: string | null
  prompt: string
  negativePrompt?: string
  seconds: number
  ratio: string
  resolution: string
  images: Array<VideoImageReference | string>
  generateAudio: boolean
  returnLastFrame?: boolean
  seed?: number
  watermark?: boolean
  cameraFixed?: boolean
}

export type VideoImageReference = {
  url: string
  role: 'reference_image' | 'first_frame' | 'last_frame'
}

export type VideoGenerationSubmission = {
  providerTaskId: string
  status: 'queued' | 'running'
  progress: number
}

export type VideoGenerationStatus = {
  status: 'running' | 'completed' | 'failed'
  progress: number
  error: string | null
  lastFrameUrl?: string
}

export type VideoContent = {
  stream: Readable
  contentType: string
  contentLength: string | null
  statusCode: number
  acceptRanges: string | null
  contentRange: string | null
}

export interface VideoGenerationProvider {
  submit(request: VideoGenerationRequest): Promise<VideoGenerationSubmission>
  getStatus(providerTaskId: string): Promise<VideoGenerationStatus>
  getContent(providerTaskId: string, range?: string): Promise<VideoContent>
  getLastFrameContent?(providerTaskId: string): Promise<VideoContent>
  cancel?(providerTaskId: string): Promise<void>
}
