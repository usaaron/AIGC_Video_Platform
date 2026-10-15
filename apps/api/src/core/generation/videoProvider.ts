import type { Readable } from 'node:stream'

export type VideoGenerationMode =
  | 'text-to-video'
  | 'video-to-video'
  | 'first-last-frame'
  | 'extend'
  | 'inpaint'
  | 'replace-background'
  | 'relight'
  | 'upscale'
  | 'lip-sync'

export type VideoGenerationRequest = {
  taskId: string
  mode: VideoGenerationMode
  model: string | null
  prompt: string
  negativePrompt: string
  seconds: number
  ratio: string
  resolution: string
  images: string[]
  sourceVideoUrl?: string
  sourceImageUrls: string[]
  firstFrameUrl?: string
  lastFrameUrl?: string
  maskUrl?: string
  backgroundReferenceUrl?: string
  lightingPreset?: string
  upscaleFactor?: number
  lipSyncAudioUrl?: string
  extendSeconds?: number
  templateId?: string
  agentPlanId?: string
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
  cancel?(providerTaskId: string): Promise<void>
}
