import type { Readable } from 'node:stream'

export type VideoGenerationRequest = {
  taskId: string
  model: string | null
  prompt: string
  seconds: number
  ratio: string
  resolution: string
  images: string[]
  generateAudio: boolean
  seed?: number
  watermark?: boolean
  cameraFixed?: boolean
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
}

export type VideoContent = {
  stream: Readable
  contentType: string
  contentLength: string | null
}

export interface VideoGenerationProvider {
  submit(request: VideoGenerationRequest): Promise<VideoGenerationSubmission>
  getStatus(providerTaskId: string): Promise<VideoGenerationStatus>
  getContent(providerTaskId: string): Promise<VideoContent>
}
