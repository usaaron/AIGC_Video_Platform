import { deliveryContractSchema, type GenerationTask, type Principal } from '@seqora/contracts'
import { freezeDeliveryContract } from './deliveryContractFreeze.js'
import { evaluateDeliveryContract } from './deliveryContractEvaluation.js'
import { buildGenerationTaskDeliveryEvidence } from './deliveryEvidence.js'
import { evaluateDeliveryGate } from './deliveryGate.js'
import { deliveryTaskFingerprint, type DeliveryDownloadDraft } from './deliveryDownloadRepository.js'
import { buildQueuedGenerationTask } from './taskCreation.js'

export const downloadPrincipal: Principal = {
  tenantId: 'tenant-seqora-demo',
  userId: 'user-member',
  roles: ['member'],
}

export function downloadTask(projectId = 'project-midnight-film'): GenerationTask {
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: 'download-task',
      projectId,
      kind: 'image',
      provider: 'image2',
      label: 'Synthetic download',
      estimatedCredits: 3,
    },
    downloadPrincipal,
    '2026-10-14T00:00:00.000Z',
  )
  task.clientRequestId = 'download-task-' + task.id
  task.status = 'completed'
  task.resultUrl = `/api/v1/generation/tasks/${task.id}/outputs/single`
  task.metadata.deliveryContract = freezeDeliveryContract(
    {
      version: 'seqora.delivery.v1',
      intent: { mode: 'asset', projectId },
      expectedArtifact: { type: 'image', count: 1 },
      must: [{ id: 'media-url', statement: 'Current media verified', source: 'system' }],
    },
    task.updatedAt,
  )
  return task
}

export function downloadDraft(task: GenerationTask, clientRequestId = 'download-1'): DeliveryDownloadDraft {
  const evidence = buildGenerationTaskDeliveryEvidence(task).map((item) =>
    item.kind === 'asset'
      ? {
          ...item,
          status: 'passed' as const,
          details: {
            ...item.details,
            storageProof: {
              status: 'passed',
              reason: 'verified',
              contentType: 'image/png',
              expectedSize: 24,
              actualSize: 24,
              expectedSha256: 'a'.repeat(64),
              actualSha256: 'a'.repeat(64),
            },
          },
        }
      : item,
  )
  const contract = deliveryContractSchema.parse(task.metadata.deliveryContract)
  const verification = evaluateDeliveryContract({
    contract,
    evidence,
    scope: evidence[0]!.scope,
    verifiedAt: task.updatedAt,
  })
  return {
    clientRequestId,
    sourceTaskUpdatedAt: task.updatedAt,
    contractHash: contract.contractHash!,
    contentType: 'image/png',
    size: 24,
    sha256: 'a'.repeat(64),
    sourceFingerprint: deliveryTaskFingerprint(task),
    snapshot: { taskId: task.id, contract, evidence, verification },
    gate: evaluateDeliveryGate({ task, contract, evidence, verification, verifiedAt: task.updatedAt }),
  }
}
