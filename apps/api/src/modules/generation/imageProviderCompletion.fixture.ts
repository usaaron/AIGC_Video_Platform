import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  imageCompletionMediaVersion,
  type GenerationTask,
  type ImageProviderCompletionReceipt,
} from '@seqora/contracts'
import { vi, type Mocked } from 'vitest'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { downloadTask } from './deliveryDownload.fixture.js'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'

type CompletedImageFixture = {
  task: GenerationTask
  receipt: ImageProviderCompletionReceipt
  objects: Map<string, Buffer>
  storage: Mocked<Required<Pick<ObjectStorage, 'put' | 'get' | 'delete' | 'getStream'>>>
}

export function completedImage(turnaround = false, projectId?: string): CompletedImageFixture {
  const task = downloadTask(projectId)
  task.provider = 'img2'
  task.attempts = 1
  task.progress = 100
  const views: ImageProviderCompletionReceipt['outputs'][number]['view'][] = turnaround
    ? ['front', 'side', 'back']
    : ['single']
  const objects = new Map<string, Buffer>()
  const outputs = views.map((view, index) => {
    const bytes = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex')
    bytes[bytes.length - 1] = index
    const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-${view}.png`
    objects.set(storageKey, bytes)
    return {
      view,
      storageKey,
      contentType: 'image/png' as const,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  })
  task.outputs = outputs.map((output) => ({
    id: `${task.id}-${output.view}`,
    view: output.view,
    mediaType: 'image' as const,
    url: `/api/v1/generation/tasks/${task.id}/outputs/${output.view}`,
  }))
  task.resultUrl = task.outputs[0]!.url
  task.metadata = {
    turnaround,
    providerName: 'tokenadvent-img2',
    providerIdempotencyKey: `generation:${task.tenantId}:${task.id}`,
    providerState: 'completed',
    generatedOutputs: structuredClone(outputs),
    deliveryContract: freezeDeliveryContract(
      {
        version: 'seqora.delivery.v1',
        intent: { mode: 'asset', projectId: task.projectId },
        expectedArtifact: { type: 'image', count: 1 },
        must: [
          { id: 'provider-completed', statement: 'Every requested view completed', source: 'provider' },
          { id: 'media-url', statement: 'Current primary bytes verified', source: 'system' },
        ],
      },
      task.updatedAt,
    ),
  }
  const receipt: ImageProviderCompletionReceipt = {
    version: 'seqora.provider-image-completion.v1',
    attestation: 'server-observed-completion',
    tenantId: task.tenantId,
    projectId: task.projectId,
    taskId: task.id,
    provider: 'img2',
    providerName: 'tokenadvent-img2',
    requestId: task.metadata.providerIdempotencyKey as string,
    attempts: task.attempts,
    completedAt: task.updatedAt,
    mediaVersion: imageCompletionMediaVersion(task),
    outputs,
  }
  task.metadata.providerCompletionReceipt = receipt
  const storage = {
    put: vi.fn<ObjectStorage['put']>(),
    get: vi.fn<ObjectStorage['get']>(),
    delete: vi.fn<ObjectStorage['delete']>(),
    getStream: vi.fn<NonNullable<ObjectStorage['getStream']>>(async (key: string) => {
      const bytes = objects.get(key)
      if (!bytes) throw Object.assign(new Error('Synthetic missing image'), { code: 'ENOENT' })
      return { stream: Readable.from([bytes]), size: bytes.length }
    }),
  }
  return { task, receipt, objects, storage }
}
