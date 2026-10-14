import {
  imageProviderMediaProofSchema,
  type GenerationTask,
  type ImageProviderMediaProof,
} from '@seqora/contracts'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { imageProviderCompletionEvidence } from './imageProviderCompletionEvidence.js'
import { verifyMediaStorageDescriptor } from './deliveryMediaStorageVerification.js'

/** All receipt outputs share the 100 MiB schema budget and a single 15 second read deadline. */
export async function verifyImageProviderMedia(
  task: GenerationTask,
  storage: ObjectStorage | null,
  signal?: AbortSignal,
): Promise<ImageProviderMediaProof | null> {
  const receipt = imageProviderCompletionEvidence(task).receipt
  if (!receipt) return null
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 15_000)
  const outputs: ImageProviderMediaProof['outputs'] = []
  try {
    // Sequential reads keep the existing GET request concurrency bound valid.
    for (const output of receipt.outputs) {
      const proof = await verifyMediaStorageDescriptor(output, storage, controller.signal)
      outputs.push({
        view: output.view,
        storageProof:
          timedOut && proof.reason === 'read-error' ? { ...proof, reason: 'read-timeout' } : proof,
      })
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
  const status = outputs.some((output) => output.storageProof.status === 'failed')
    ? 'failed'
    : outputs.every((output) => output.storageProof.status === 'passed')
      ? 'passed'
      : 'pending'
  return imageProviderMediaProofSchema.parse({
    status,
    reason: status === 'passed' ? 'verified' : status === 'failed' ? 'output-failed' : 'output-pending',
    expectedOutputCount: receipt.outputs.length,
    verifiedOutputCount: outputs.filter((output) => output.storageProof.status === 'passed').length,
    outputs,
  })
}
