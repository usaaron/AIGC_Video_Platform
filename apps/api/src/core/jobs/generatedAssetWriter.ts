import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { buffer } from 'node:stream/consumers'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { StoredMedia } from '../../infra/store.js'
import type { VideoContent } from '../generation/videoProvider.js'

type Fetcher = typeof fetch

export type MaterializedGenerationOutputs = {
  outputs: GenerationTask['outputs']
  media: StoredMedia[]
}

export class GeneratedAssetWriter {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async writeRemoteOutputs(
    task: GenerationTask,
    outputs: GenerationTask['outputs'],
  ): Promise<MaterializedGenerationOutputs> {
    return this.writeOutputs(
      task,
      await Promise.all(
        outputs.map(async (output) => ({
          output,
          content: await this.download(output.url, output.mediaType),
        })),
      ),
    )
  }

  async writeVideoContent(
    task: GenerationTask,
    content: VideoContent,
  ): Promise<MaterializedGenerationOutputs> {
    return this.writeOutputs(task, [
      {
        output: { id: `${task.id}-video`, url: '', mediaType: 'video', view: 'single' },
        content: {
          body: await buffer(content.stream),
          contentType: content.contentType || 'video/mp4',
        },
      },
    ])
  }

  private async writeOutputs(
    task: GenerationTask,
    items: Array<{
      output: GenerationTask['outputs'][number]
      content: DownloadedContent
    }>,
  ): Promise<MaterializedGenerationOutputs> {
    const media: StoredMedia[] = []
    const outputs: GenerationTask['outputs'] = []

    try {
      for (const item of items) {
        const mediaId = randomUUID()
        const storageKey = storageKeyFor(task, mediaId, item.content.contentType)
        await this.storage.put(storageKey, item.content.body, item.content.contentType)

        media.push({
          id: mediaId,
          projectId: task.projectId,
          tenantId: task.tenantId,
          kind: item.output.mediaType,
          name: mediaNameFor(task, item.output),
          contentType: item.content.contentType,
          size: item.content.body.length,
          storageKey,
          createdAt: new Date().toISOString(),
        })
        outputs.push({
          ...item.output,
          id: mediaId,
          url: `/api/v1/media/${mediaId}`,
        })
      }
    } catch (error) {
      await Promise.allSettled(media.map((item) => this.storage.delete(item.storageKey)))
      throw error
    }

    return { outputs, media }
  }

  private async download(url: string, mediaType: GenerationTask['outputs'][number]['mediaType']) {
    if (!/^https?:\/\//.test(url)) {
      throw new Error('远程生成结果必须是 HTTP URL 才能资产化')
    }
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`远程生成结果下载失败 (${response.status})`)

    const contentType =
      normalizeContentType(response.headers.get('content-type')) ?? fallbackContentType(mediaType)
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType,
    }
  }
}

type DownloadedContent = {
  body: Buffer
  contentType: string
}

function storageKeyFor(task: GenerationTask, mediaId: string, contentType: string): string {
  return `${task.tenantId}/${task.projectId}/generated/${task.id}/${mediaId}${extensionFor(contentType)}`
}

function mediaNameFor(task: GenerationTask, output: GenerationTask['outputs'][number]): string {
  const view = output.view === 'single' ? '' : `-${output.view}`
  return `${task.label}${view}`.slice(0, 255) || `${task.id}${view}`
}

function normalizeContentType(value: string | null): string | null {
  const contentType = value?.split(';')[0]?.trim().toLowerCase()
  return contentType || null
}

function fallbackContentType(mediaType: GenerationTask['outputs'][number]['mediaType']): string {
  if (mediaType === 'video') return 'video/mp4'
  if (mediaType === 'audio') return 'audio/mpeg'
  return 'image/png'
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/jpeg') return '.jpg'
  if (contentType === 'image/webp') return '.webp'
  if (contentType === 'video/webm') return '.webm'
  if (contentType === 'audio/wav' || contentType === 'audio/x-wav') return '.wav'
  if (contentType === 'audio/ogg') return '.ogg'
  if (contentType.startsWith('video/')) return '.mp4'
  if (contentType.startsWith('audio/')) return '.mp3'
  return '.png'
}
