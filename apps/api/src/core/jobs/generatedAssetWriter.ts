import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
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
    private readonly maxDownloadBytes = 104_857_600,
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
          body: await readNodeStreamWithLimit(content.stream, this.maxDownloadBytes, content.contentLength),
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

  private async download(
    url: string,
    mediaType: GenerationTask['outputs'][number]['mediaType'],
  ): Promise<DownloadedContent> {
    if (!/^https?:\/\//.test(url)) {
      throw new Error('Remote generated asset must be an HTTP URL before it can be materialized')
    }

    const response = await this.fetcher(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Remote generated asset download failed (${response.status})`)
    assertContentLengthWithinLimit(response.headers.get('content-length'), this.maxDownloadBytes)

    return {
      body: await readResponseBodyWithLimit(response, this.maxDownloadBytes),
      contentType:
        normalizeContentType(response.headers.get('content-type')) ?? fallbackContentType(mediaType),
    }
  }
}

type DownloadedContent = {
  body: Buffer
  contentType: string
}

async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer())
    assertBufferWithinLimit(body, maxBytes)
    return body
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) throw new Error(`Remote generated asset exceeds ${maxBytes} bytes`)
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

async function readNodeStreamWithLimit(
  stream: Readable,
  maxBytes: number,
  contentLength: string | number | null,
): Promise<Buffer> {
  assertContentLengthWithinLimit(contentLength, maxBytes)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const body = Buffer.from(chunk)
    total += body.length
    if (total > maxBytes) throw new Error(`Remote generated asset exceeds ${maxBytes} bytes`)
    chunks.push(body)
  }
  return Buffer.concat(chunks)
}

function assertBufferWithinLimit(body: Buffer, maxBytes: number): void {
  if (body.length > maxBytes) throw new Error(`Remote generated asset exceeds ${maxBytes} bytes`)
}

function assertContentLengthWithinLimit(value: string | number | null, maxBytes: number): void {
  if (value === null || value === '') return
  const size = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (Number.isFinite(size) && size > maxBytes) {
    throw new Error(`Remote generated asset exceeds ${maxBytes} bytes`)
  }
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
