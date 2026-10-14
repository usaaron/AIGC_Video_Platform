import {
  IMAGE_COMPLETION_MAX_BYTES,
  imageCompletionMediaVersion,
  imageProviderCompletionReceiptSchema,
  type GenerationTask,
} from '@seqora/contracts'
import { createHash } from 'node:crypto'
import type { ImageGenerationOutput, ImageGenerationRequest } from '../generation/imageProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { registerProviderCompletionContext } from './providerCompletionContext.js'
import type { GeneratedOutputDescriptor } from './taskWriteback.js'

type ImageView = ImageGenerationRequest['outputs'][number]
export type ImageCompletionBinding = Readonly<{
  taskId: string
  tenantId: string
  projectId: string
  providerName: 'tokenadvent-img2'
  requestId: string
  attempts: number
  leaseOwnerId: string
  leaseToken: string
  views: readonly ImageView[]
}>
const prepared = new WeakSet<ImageCompletionBinding>()
const ingested = new WeakMap<
  GeneratedOutputDescriptor[],
  { binding: ImageCompletionBinding; descriptors: GeneratedOutputDescriptor[]; snapshot: string }
>()
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** Capture the actual request before calling the Provider; copied bindings cannot attest anything. */
export function prepareImageCompletion(
  task: GenerationTask,
  request: ImageGenerationRequest,
): ImageCompletionBinding {
  const views = [...request.outputs]
  if (
    [task.id, task.tenantId, task.projectId].some(
      (value) => !/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 200,
    ) ||
    !views.length ||
    new Set(views).size !== views.length ||
    views.some((view) => !['single', 'front', 'side', 'back', 'detail'].includes(view)) ||
    typeof request.idempotencyKey !== 'string' ||
    !request.idempotencyKey.length ||
    request.idempotencyKey.length > 500 ||
    request.taskId !== task.id ||
    request.idempotencyKey !== task.metadata.providerIdempotencyKey
  )
    throw new Error('Image completion request identity or expected views are invalid')
  const binding: ImageCompletionBinding = Object.freeze({
    taskId: task.id,
    tenantId: task.tenantId,
    projectId: task.projectId,
    providerName: 'tokenadvent-img2',
    requestId: request.idempotencyKey ?? '',
    attempts: task.attempts ?? 0,
    leaseOwnerId: task.leaseOwnerId ?? '',
    leaseToken: task.leaseToken ?? '',
    views: Object.freeze(views),
  })
  prepared.add(binding)
  if (task.status !== 'running' || !imageCompletionMatches(task, binding)) {
    prepared.delete(binding)
    throw new Error('Image completion task identity is invalid')
  }
  Object.freeze(request.outputs)
  Object.freeze(request)
  return binding
}

export function imageCompletionMatches(task: GenerationTask, binding: ImageCompletionBinding): boolean {
  return (
    prepared.has(binding) &&
    task.kind === 'image' &&
    task.provider === 'img2' &&
    task.id === binding.taskId &&
    task.tenantId === binding.tenantId &&
    task.projectId === binding.projectId &&
    task.metadata.providerName === binding.providerName &&
    task.metadata.providerIdempotencyKey === binding.requestId &&
    !!binding.requestId &&
    (task.attempts ?? 0) === binding.attempts &&
    JSON.stringify(binding.views) ===
      JSON.stringify(task.metadata.turnaround === true ? ['front', 'side', 'back'] : ['single']) &&
    Number.isInteger(binding.attempts) &&
    binding.attempts > 0 &&
    task.leaseOwnerId === binding.leaseOwnerId &&
    !!binding.leaseOwnerId &&
    task.leaseToken === binding.leaseToken &&
    !!binding.leaseToken
  )
}

/** Validate and copy every image before any put, then attest only the complete bounded batch. */
export async function persistProviderImages(
  task: GenerationTask,
  outputs: ImageGenerationOutput[],
  storage: ObjectStorage,
  binding: ImageCompletionBinding,
): Promise<GeneratedOutputDescriptor[]> {
  if (task.status !== 'running' || !imageCompletionMatches(task, binding))
    throw new Error('Image completion request is stale')
  if (
    !Array.isArray(outputs) ||
    outputs.length !== binding.views.length ||
    new Set(outputs.map((output) => output.view)).size !== binding.views.length ||
    outputs.some((output) => !binding.views.includes(output.view))
  )
    throw new Error('Image completion requires every requested view exactly once')
  let total = 0
  const snapshots = binding.views.map((view) => {
    const output = outputs.find((item) => item.view === view)!
    if (
      !Buffer.isBuffer(output.content) ||
      !output.content.length ||
      output.content.length > IMAGE_COMPLETION_MAX_BYTES ||
      (total += output.content.length) > IMAGE_COMPLETION_MAX_BYTES
    )
      throw new Error('Image completion exceeds the 100 MiB image or batch size limit')
    const contentType = output.contentType.split(';')[0]!.trim().toLowerCase()
    if (!Object.hasOwn(extensions, contentType)) throw new Error('Image content type is unsupported')
    const buffer = Buffer.from(output.content)
    if (!imageSignatureMatches(buffer, contentType)) throw new Error('Image content signature is invalid')
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const descriptor: GeneratedOutputDescriptor = {
      view,
      contentType,
      size: buffer.length,
      sha256,
      storageKey: `${binding.tenantId}/${binding.projectId}/generated/${binding.taskId}-attempt-${binding.attempts}-${sha256}-${view}.${extensions[contentType as keyof typeof extensions]}`,
    }
    return { buffer, descriptor }
  })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => {
        for (const { buffer, descriptor } of snapshots) {
          if (stopped) throw new Error('Image storage timed out')
          await storage.put(descriptor.storageKey, buffer, descriptor.contentType)
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          stopped = true
          reject(new Error('Image storage timed out'))
        }, 30_000)
      }),
    ])
    if (stopped || task.status !== 'running' || !imageCompletionMatches(task, binding))
      throw new Error('Image completion request is stale')
    const descriptors = snapshots.map(({ descriptor }) => descriptor)
    ingested.set(descriptors, {
      binding,
      descriptors: [...descriptors],
      snapshot: JSON.stringify(descriptors),
    })
    return descriptors
  } finally {
    stopped = true
    clearTimeout(timer)
  }
}

export function verifiedImageCompletionBinding(
  task: GenerationTask,
  descriptors: GeneratedOutputDescriptor[],
  leaseOwnerId: string,
  leaseToken: string,
): ImageCompletionBinding | null {
  const proof = ingested.get(descriptors)
  return task.status === 'running' &&
    proof &&
    imageCompletionMatches(task, proof.binding) &&
    proof.binding.leaseOwnerId === leaseOwnerId &&
    proof.binding.leaseToken === leaseToken &&
    proof.snapshot === JSON.stringify(descriptors) &&
    proof.descriptors.every((descriptor, index) => descriptor === descriptors[index])
    ? proof.binding
    : null
}

export function recordImageProviderCompletion(
  task: GenerationTask,
  descriptors: GeneratedOutputDescriptor[],
  binding: ImageCompletionBinding,
): boolean {
  const proof = ingested.get(descriptors)
  if (
    task.status !== 'completed' ||
    task.error ||
    !imageCompletionMatches(task, binding) ||
    proof?.binding !== binding ||
    proof.snapshot !== JSON.stringify(descriptors) ||
    !proof.descriptors.every((descriptor, index) => descriptor === descriptors[index])
  )
    return false
  const { leaseOwnerId, leaseToken, views: _views, ...scope } = binding
  const receipt = imageProviderCompletionReceiptSchema.safeParse({
    version: 'seqora.provider-image-completion.v1',
    attestation: 'server-observed-completion',
    ...scope,
    provider: 'img2',
    completedAt: task.updatedAt,
    mediaVersion: imageCompletionMediaVersion(task),
    outputs: descriptors,
  })
  if (!receipt.success) return false
  ingested.delete(descriptors)
  task.metadata.providerCompletionReceipt = receipt.data
  registerProviderCompletionContext(task, leaseOwnerId, leaseToken)
  return true
}

function imageSignatureMatches(buffer: Buffer, contentType: string): boolean {
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  if (contentType === 'image/jpeg')
    return buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
  if (contentType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
}
