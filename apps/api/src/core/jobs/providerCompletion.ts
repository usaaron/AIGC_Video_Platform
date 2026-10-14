import { providerCompletionReceiptSchema, videoReviewVersion, type GenerationTask } from '@seqora/contracts'
import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { VideoContent, VideoProviderName } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { GeneratedOutputDescriptor } from './taskWriteback.js'
import { registerProviderCompletionContext } from './providerCompletionContext.js'

export type ProviderPollBinding = {
  taskId: string
  tenantId: string
  projectId: string
  providerTaskId: string
  providerName: VideoProviderName
  attempts: number
  leaseOwnerId: string
  leaseToken: string
}

const ingested = new WeakMap<
  GeneratedOutputDescriptor,
  { binding: ProviderPollBinding; descriptor: GeneratedOutputDescriptor }
>()
const MAX_BYTES = 100 * 1024 * 1024

export function providerPollBinding(
  task: GenerationTask,
  providerName: VideoProviderName,
): ProviderPollBinding {
  return {
    taskId: task.id,
    tenantId: task.tenantId,
    projectId: task.projectId,
    providerName,
    providerTaskId: typeof task.metadata.providerTaskId === 'string' ? task.metadata.providerTaskId : '',
    attempts: task.attempts ?? 0,
    leaseOwnerId: task.leaseOwnerId ?? '',
    leaseToken: task.leaseToken ?? '',
  }
}

export function providerPollMatches(task: GenerationTask, binding: ProviderPollBinding): boolean {
  return (
    task.kind === 'video' &&
    task.provider === 'seedance' &&
    task.id === binding.taskId &&
    task.tenantId === binding.tenantId &&
    task.projectId === binding.projectId &&
    task.metadata.providerTaskId === binding.providerTaskId &&
    !!binding.providerTaskId &&
    task.metadata.providerName === binding.providerName &&
    (task.attempts ?? 0) === binding.attempts
  )
}

export function providerPollLeaseMatches(task: GenerationTask, binding: ProviderPollBinding): boolean {
  return (
    providerPollMatches(task, binding) &&
    task.leaseOwnerId === binding.leaseOwnerId &&
    task.leaseToken === binding.leaseToken &&
    !!binding.leaseToken
  )
}

export function remoteMediaStorageKey(task: GenerationTask, sha256: string, suffix: string): string {
  return `${task.tenantId}/${task.projectId}/generated/${task.id}-attempt-${task.attempts ?? 0}-${sha256}-${suffix}`
}

/** Only bytes read and stored by this process can attest the completion poll. */
export async function persistProviderVideo(
  task: GenerationTask,
  providerTaskId: string,
  storage: ObjectStorage,
  getContent: () => Promise<VideoContent>,
): Promise<GeneratedOutputDescriptor> {
  const providerName = task.metadata.providerName as VideoProviderName
  const binding = { ...providerPollBinding(task, providerName), providerTaskId }
  const { buffer, contentType } = await readProviderVideo(getContent)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const descriptor: GeneratedOutputDescriptor = {
    view: 'single',
    storageKey: remoteMediaStorageKey(task, sha256, 'video.mp4'),
    contentType,
    size: buffer.length,
    sha256,
  }
  await storage.put(descriptor.storageKey, buffer, descriptor.contentType)
  ingested.set(descriptor, { binding, descriptor: { ...descriptor } })
  return descriptor
}

export function recordProviderCompletion(
  task: GenerationTask,
  binding: ProviderPollBinding,
  descriptor?: GeneratedOutputDescriptor | null,
): void {
  delete task.metadata.providerCompletionReceipt
  if (task.status !== 'completed' || task.error || !descriptor || !providerPollMatches(task, binding)) return
  const proof = ingested.get(descriptor)
  ingested.delete(descriptor)
  if (
    !proof ||
    JSON.stringify(proof.binding) !== JSON.stringify(binding) ||
    JSON.stringify(proof.descriptor) !== JSON.stringify(descriptor)
  )
    return
  const { leaseOwnerId, leaseToken, ...scope } = binding
  const receipt = providerCompletionReceiptSchema.safeParse({
    version: 'seqora.provider-completion.v1',
    attestation: 'server-observed-completion',
    ...scope,
    provider: 'seedance',
    completedAt: task.updatedAt,
    mediaVersion: videoReviewVersion(task),
    media: descriptor,
  })
  if (receipt.success) {
    task.metadata.providerCompletionReceipt = receipt.data
    registerProviderCompletionContext(task, leaseOwnerId, leaseToken)
  }
}

/** Includes waiting for headers and destroys late or incomplete streams. */
export async function readProviderVideo(
  getContent: () => Promise<VideoContent>,
): Promise<{ buffer: Buffer; contentType: string }> {
  let stream: Readable | undefined
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const read = async () => {
    const content = await getContent()
    stream = content.stream
    if (stopped) {
      stream.destroy()
      throw new Error('Video content read timed out')
    }
    const contentType = content.contentType.split(';')[0]!.trim().toLowerCase()
    if (content.statusCode !== 200 || content.contentRange)
      throw new Error('Video content must be a complete HTTP 200 response')
    if (contentType !== 'video/mp4') throw new Error('Video content type is unsupported')
    const expected = content.contentLength === null ? null : Number(content.contentLength)
    if (
      expected !== null &&
      (!/^\d+$/.test(content.contentLength!) ||
        !Number.isSafeInteger(expected) ||
        expected <= 0 ||
        expected > MAX_BYTES)
    )
      throw new Error('Video content length is invalid or exceeds 100 MiB')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      if (stopped) throw new Error('Video content read timed out')
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_BYTES || (expected !== null && size > expected))
        throw new Error('Video content size limit exceeded')
      chunks.push(bytes)
    }
    if (!size || (expected !== null && size !== expected))
      throw new Error('Video content size does not match the complete response')
    const buffer = Buffer.concat(chunks)
    if (
      buffer.length < 16 ||
      !buffer.subarray(4, 8).equals(Buffer.from('ftyp')) ||
      buffer.readUInt32BE(0) < 16 ||
      buffer.readUInt32BE(0) > size
    )
      throw new Error('Video content does not have a valid MP4 signature')
    return { buffer, contentType }
  }
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          stopped = true
          stream?.destroy()
          reject(new Error('Video content read timed out'))
        }, 15_000)
      }),
    ])
  } finally {
    stopped = true
    clearTimeout(timer)
    stream?.destroy()
  }
}
