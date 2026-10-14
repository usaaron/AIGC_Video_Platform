import {
  deliveryContractSchema,
  deliveryVerificationSnapshotSchema,
  type GenerationTask,
} from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { buildGenerationTaskDeliveryEvidence } from './deliveryEvidence.js'
import { buildVideoTailStorageEvidence } from './deliveryStorageVerification.js'
import { buildMediaStorageEvidence } from './deliveryMediaStorageVerification.js'
import { evaluateDeliveryContract } from './deliveryContractEvaluation.js'

export async function buildDeliveryVerificationSnapshot(
  task: GenerationTask,
  storage: ObjectStorage | null,
  checkedAt: string,
  signal?: AbortSignal,
) {
  const baseEvidence = buildGenerationTaskDeliveryEvidence(task)
  const [tailEvidence, mediaEvidence] = await Promise.all([
    buildVideoTailStorageEvidence(task, storage, checkedAt, signal),
    buildMediaStorageEvidence(task, storage, checkedAt, signal),
  ])
  const evidence = baseEvidence.map((item) => {
    if (item.kind === 'continuity' && tailEvidence) return tailEvidence
    if (item.kind === 'asset' && mediaEvidence) return mediaEvidence
    if (item.kind === 'provider' && item.status === 'passed' && mediaEvidence?.status !== 'passed') {
      return {
        ...item,
        status: mediaEvidence?.status === 'failed' ? ('failed' as const) : ('pending' as const),
        details: { ...item.details, currentMediaProof: mediaEvidence?.details.storageProof ?? null },
      }
    }
    return item
  })
  const contractResult = deliveryContractSchema.safeParse(task.metadata.deliveryContract)
  const scope = evidence[0]?.scope
  const verification =
    contractResult.success && scope
      ? evaluateDeliveryContract({ contract: contractResult.data, evidence, scope, verifiedAt: checkedAt })
      : null
  return deliveryVerificationSnapshotSchema.parse({
    taskId: task.id,
    contract: contractResult.success ? contractResult.data : null,
    evidence,
    verification,
  })
}
