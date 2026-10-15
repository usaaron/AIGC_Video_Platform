import type { GenerationTask } from '@seqora/contracts'
import type { AudioGenerationRequest } from '../generation/audioProvider.js'
import type { ImageGenerationRequest } from '../generation/imageProvider.js'
import type { VideoGenerationMode, VideoGenerationRequest } from '../generation/videoProvider.js'
import { isControlledMediaUrl } from './mediaReferenceResolver.js'

const SILENT_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='

export function videoRequestFor(task: GenerationTask): VideoGenerationRequest {
  const seed = optionalInteger(task.metadata.seed)
  const watermark = optionalBoolean(task.metadata.watermark)
  const cameraFixed = optionalBoolean(task.metadata.cameraFixed)
  const sourceVideoUrl = optionalUrl(task.metadata.sourceVideoUrl)
  const firstFrameUrl = optionalUrl(task.metadata.firstFrameUrl)
  const lastFrameUrl = optionalUrl(task.metadata.lastFrameUrl)
  const maskUrl = optionalUrl(task.metadata.maskUrl)
  const backgroundReferenceUrl = optionalUrl(task.metadata.backgroundReferenceUrl)
  const lightingPreset = optionalString(task.metadata.lightingPreset)
  const upscaleFactor = optionalBoundedInteger(task.metadata.upscaleFactor, 2, 4)
  const lipSyncAudioUrl = optionalUrl(task.metadata.lipSyncAudioUrl)
  const extendSeconds = optionalBoundedInteger(task.metadata.extendSeconds, 1, 60)
  const templateId = optionalString(task.metadata.templateId)
  const agentPlanId = optionalString(task.metadata.agentPlanId)

  return {
    taskId: task.id,
    mode: videoModeFor(task.metadata.videoMode),
    model: task.model,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    seconds: boundedInteger(task.metadata.duration, 5, 1, 120),
    ratio: stringValue(task.metadata.aspectRatio, '16:9'),
    resolution: stringValue(task.metadata.resolution, '720p'),
    images: urlArrayFor(task.metadata.images),
    sourceImageUrls: urlArrayFor(task.metadata.sourceImageUrls),
    generateAudio: task.metadata.generateAudio === true,
    ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
    ...(maskUrl ? { maskUrl } : {}),
    ...(backgroundReferenceUrl ? { backgroundReferenceUrl } : {}),
    ...(lightingPreset ? { lightingPreset } : {}),
    ...(upscaleFactor === null ? {} : { upscaleFactor }),
    ...(lipSyncAudioUrl ? { lipSyncAudioUrl } : {}),
    ...(extendSeconds === null ? {} : { extendSeconds }),
    ...(templateId ? { templateId } : {}),
    ...(agentPlanId ? { agentPlanId } : {}),
    ...(seed === null ? {} : { seed }),
    ...(watermark === null ? {} : { watermark }),
    ...(cameraFixed === null ? {} : { cameraFixed }),
  }
}

export function imageRequestFor(task: GenerationTask): ImageGenerationRequest {
  const references = referenceUrlsFor(task.metadata.references)
  const faceReferenceUrl = faceReferenceUrlFor(task, references)
  const bodyReferenceUrl = bodyReferenceUrlFor(task, references)
  return {
    taskId: task.id,
    assetId: stringValue(task.metadata.assetId, ''),
    model: task.model,
    aspectRatio: stringValue(task.metadata.aspectRatio, '16:9'),
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    referenceUrls: uniqueUrls([faceReferenceUrl, bodyReferenceUrl, ...references]),
    faceReferenceUrl,
    bodyReferenceUrl,
    attributes: attributesFor(task.metadata.attributes),
    outputs: outputViewsForImage(task),
  }
}

export function audioRequestFor(task: GenerationTask): AudioGenerationRequest {
  const attributes = audioAttributesFor(task.metadata.attributes)
  return {
    taskId: task.id,
    assetId: stringValue(task.metadata.assetId, ''),
    model: task.model,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    duration: boundedInteger(task.metadata.duration ?? attributes?.duration, 15, 1, 300),
    audioType: audioTypeFor(task.metadata.audioType, attributes?.audioType),
    loop: optionalBoolean(task.metadata.loop) ?? attributes?.loop ?? false,
    attributes,
  }
}

export function localOutputsFor(task: GenerationTask): GenerationTask['outputs'] {
  if (task.kind === 'audio') {
    return [
      {
        id: `${task.id}-audio`,
        url: SILENT_WAV_DATA_URL,
        mediaType: 'audio',
        view: 'single',
      },
    ]
  }
  if (task.kind === 'image' || task.kind === 'video') {
    const images = ['/demo/lin.jpg', '/demo/station.jpg', '/demo/rain.jpg', '/demo/room.jpg']
    const start = Math.abs(hash(task.id)) % images.length
    const mediaType: 'image' | 'video' = task.kind
    const views = task.kind === 'image' ? outputViewsForImage(task) : (['single'] as const)
    return views.map((view, index) => ({
      id: `${task.id}-${view}`,
      url: images[(start + index) % images.length] ?? images[0]!,
      mediaType,
      view,
    }))
  }
  return []
}

export function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '远程生成请求失败'
}

function referenceUrlsFor(value: unknown): string[] {
  return urlArrayFor(value)
}

function faceReferenceUrlFor(task: GenerationTask, references: string[]): string | null {
  const attributes = attributesFor(task.metadata.attributes)
  const attributeUrl = publicReferenceUrl(recordValue(attributes, 'faceReference'))
  if (attributeUrl) return attributeUrl
  if (task.metadata.generationStage === 'body' || task.metadata.generationStage === 'turnaround') {
    return references[0] ?? null
  }
  return null
}

function bodyReferenceUrlFor(task: GenerationTask, references: string[]): string | null {
  const attributes = attributesFor(task.metadata.attributes)
  const attributeUrl = publicReferenceUrl(recordValue(attributes, 'bodyReference'))
  if (attributeUrl) return attributeUrl
  if (task.metadata.generationStage === 'turnaround') return references[1] ?? null
  return null
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : null
}

function publicReferenceUrl(value: unknown): string | null {
  return isRecord(value) ? optionalUrl(value.url) : null
}

function uniqueUrls(urls: Array<string | null>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))]
}

function attributesFor(value: unknown): ImageGenerationRequest['attributes'] {
  return isRecord(value) && typeof value.type === 'string'
    ? (value as ImageGenerationRequest['attributes'])
    : null
}

function outputViewsForImage(task: GenerationTask): ImageGenerationRequest['outputs'] {
  const requestedViews = outputViewsValue(task.metadata.outputViews)
  if (requestedViews.length > 0) return requestedViews
  const regenerateView = outputViewValue(task.metadata.regenerateView)
  if (regenerateView) return [regenerateView]
  if (task.metadata.turnaround === true || task.metadata.generationStage === 'turnaround') {
    return ['front', 'side', 'back']
  }
  return ['single']
}

function outputViewsValue(value: unknown): ImageGenerationRequest['outputs'] {
  if (!Array.isArray(value)) return []
  return value.reduce<ImageGenerationRequest['outputs']>((views, item) => {
    const view = outputViewValue(item)
    if (view) views.push(view)
    return views
  }, [])
}

function outputViewValue(value: unknown): ImageGenerationRequest['outputs'][number] | null {
  return value === 'single' || value === 'front' || value === 'side' || value === 'back' || value === 'detail'
    ? value
    : null
}

function audioAttributesFor(value: unknown): AudioGenerationRequest['attributes'] {
  return isRecord(value) && value.type === 'audio' ? (value as AudioGenerationRequest['attributes']) : null
}

function audioTypeFor(
  value: unknown,
  fallback: AudioGenerationRequest['audioType'] | undefined,
): AudioGenerationRequest['audioType'] {
  if (value === 'voice' || value === 'ambience' || value === 'sfx' || value === 'music') return value
  return fallback ?? 'ambience'
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = numberValue(value, fallback)
  return Math.min(max, Math.max(min, Math.round(number)))
}

function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function optionalBoundedInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function videoModeFor(value: unknown): VideoGenerationMode {
  if (
    value === 'text-to-video' ||
    value === 'video-to-video' ||
    value === 'first-last-frame' ||
    value === 'extend' ||
    value === 'inpaint' ||
    value === 'replace-background' ||
    value === 'relight' ||
    value === 'upscale' ||
    value === 'lip-sync'
  ) {
    return value
  }
  return 'text-to-video'
}

function urlArrayFor(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.reduce<string[]>((urls, item) => {
    const url = urlFromValue(item)
    if (url) urls.push(url)
    return urls
  }, [])
}

function urlFromValue(value: unknown): string | null {
  if (typeof value === 'string') return optionalUrl(value)
  return isRecord(value) ? optionalUrl(value.url) : null
}

function optionalUrl(value: unknown): string | null {
  return typeof value === 'string' && (/^https?:\/\//.test(value) || isControlledMediaUrl(value))
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hash(value: string): number {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) | 0, 0)
}
