import type { GenerationTask } from '@seqora/contracts'
import type { StateStore } from '../../infra/store.js'
import type { ImageGenerationRequest } from '../generation/imageProvider.js'
import type { VideoGenerationRequest } from '../generation/videoProvider.js'
import { createSignedMediaUrl } from '../../modules/media/signedUrl.js'

const SIGNED_REFERENCE_TTL_SECONDS = 10 * 60
const CONTROLLED_MEDIA_PATH = /^\/api\/v1\/media\/([0-9a-fA-F-]{36})(?:\/signed)?$/

export class MediaReferenceResolver {
  constructor(
    private readonly store: StateStore,
    private readonly apiPublicBaseUrl: string,
    private readonly authSecret: string,
    private readonly ttlSeconds = SIGNED_REFERENCE_TTL_SECONDS,
  ) {}

  async resolveImageRequest(
    task: GenerationTask,
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationRequest> {
    const faceReferenceUrl = await this.resolveOptionalUrl(task, request.faceReferenceUrl)
    const bodyReferenceUrl = await this.resolveOptionalUrl(task, request.bodyReferenceUrl)
    const referenceUrls = await Promise.all(
      request.referenceUrls.map((url) => this.resolveRequiredUrl(task, url)),
    )

    return {
      ...request,
      faceReferenceUrl,
      bodyReferenceUrl,
      referenceUrls: uniqueUrls([faceReferenceUrl, bodyReferenceUrl, ...referenceUrls]),
    }
  }

  async resolveVideoRequest(
    task: GenerationTask,
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationRequest> {
    return {
      ...request,
      images: uniqueUrls(await Promise.all(request.images.map((url) => this.resolveRequiredUrl(task, url)))),
    }
  }

  private async resolveOptionalUrl(task: GenerationTask, url: string | null): Promise<string | null> {
    return url ? this.resolveRequiredUrl(task, url) : null
  }

  private async resolveRequiredUrl(task: GenerationTask, url: string): Promise<string> {
    const mediaId = controlledMediaIdFor(url, this.apiPublicBaseUrl)
    if (!mediaId) return url

    const media = await this.store.read(
      (state) =>
        state.media.find(
          (item) =>
            item.id === mediaId &&
            item.tenantId === task.tenantId &&
            item.projectId === task.projectId &&
            item.kind === 'image',
        ) ?? null,
    )
    if (!media) throw new Error('参考图不存在、不是图片或不属于当前项目')

    return createSignedMediaUrl(this.apiPublicBaseUrl, media.id, this.authSecret, this.ttlSeconds)
  }
}

export function isControlledMediaUrl(value: string): boolean {
  return controlledMediaIdFor(value, '') !== null
}

function controlledMediaIdFor(value: string, apiPublicBaseUrl: string): string | null {
  const url = parseUrl(value, apiPublicBaseUrl)
  if (!url) return null
  return CONTROLLED_MEDIA_PATH.exec(url.pathname)?.[1] ?? null
}

function parseUrl(value: string, apiPublicBaseUrl: string): URL | null {
  if (value.startsWith('/')) return new URL(value, 'https://seqora.local')
  if (!apiPublicBaseUrl) return null

  try {
    const url = new URL(value)
    const baseUrl = new URL(apiPublicBaseUrl)
    return url.origin === baseUrl.origin ? url : null
  } catch {
    return null
  }
}

function uniqueUrls(urls: Array<string | null>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))]
}
