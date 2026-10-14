import {
  imageCompletionMediaVersion,
  imageProviderCompletionReceiptSchema,
  type GenerationTask,
} from '@seqora/contracts'
import { isDeepStrictEqual } from 'node:util'
import type { AppStore } from '../../infra/store.js'
import { findProviderCompletionContext } from './providerCompletionContext.js'
import { recordGenerationTaskTerminal } from './taskDiagnostics.js'

/** Capture only this execution's trusted completion, before persistence consumes its private lease. */
export function captureImageCompletion(store: AppStore, execution: GenerationTask): GenerationTask | null {
  if (execution.kind !== 'image' || execution.provider !== 'img2') return null
  return store.readGenerationTaskRuntimeCache((state) => {
    const current = state.tasks.find((task) => task.id === execution.id)
    if (
      !current ||
      current.status !== 'completed' ||
      current.tenantId !== execution.tenantId ||
      current.projectId !== execution.projectId ||
      current.attempts !== execution.attempts ||
      !imageProviderCompletionReceiptSchema.safeParse(current.metadata.providerCompletionReceipt).success
    )
      return null
    const context = findProviderCompletionContext(current)
    return context?.leaseOwnerId === execution.leaseOwnerId && context?.leaseToken === execution.leaseToken
      ? structuredClone(current)
      : null
  })
}

/** A rejected CAS or changed current receipt must never count as a successful image job. */
export function recordPersistedImageCompletion(store: AppStore, completed: GenerationTask | null): void {
  if (!completed) return
  const current = store.readGenerationTaskRuntimeCache((state) =>
    state.tasks.find((task) => task.id === completed.id),
  )
  if (
    current?.status === 'completed' &&
    current.kind === 'image' &&
    current.provider === 'img2' &&
    current.tenantId === completed.tenantId &&
    current.projectId === completed.projectId &&
    current.attempts === completed.attempts &&
    imageCompletionMediaVersion(current) === imageCompletionMediaVersion(completed) &&
    isDeepStrictEqual(
      current.metadata.providerCompletionReceipt,
      completed.metadata.providerCompletionReceipt,
    )
  ) {
    recordGenerationTaskTerminal(current)
  }
}
