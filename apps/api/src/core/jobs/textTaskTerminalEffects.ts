import { isDeepStrictEqual } from 'node:util'
import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import { recordGenerationTaskTerminal } from './taskDiagnostics.js'

const pending = new WeakMap<AppStore, Map<string, GenerationTask>>()

/** Terminal cache writes are not authority to emit metrics or refund credits. */
export function markTextTaskTerminalPending(store: AppStore, task: GenerationTask): void {
  if (task.kind !== 'text' || task.provider !== 'text') return
  let tasks = pending.get(store)
  if (!tasks) pending.set(store, (tasks = new Map()))
  tasks.set(task.id, structuredClone(task))
}

export function isTextTaskTerminalPending(store: AppStore, task: GenerationTask): boolean {
  const snapshot = pending.get(store)?.get(task.id)
  return Boolean(
    snapshot &&
    snapshot.tenantId === task.tenantId &&
    snapshot.projectId === task.projectId &&
    snapshot.userId === task.userId &&
    snapshot.clientRequestId === task.clientRequestId &&
    snapshot.attempts === task.attempts &&
    snapshot.status === task.status,
  )
}

/** Called only after persistence/reconciliation (or the local store write) succeeds. */
export function settleTextTaskTerminal(store: AppStore, snapshot: GenerationTask, persisted = false): void {
  const tasks = pending.get(store)
  if (
    !isDeepStrictEqual(tasks?.get(snapshot.id), snapshot) &&
    !(persisted && isTextTaskTerminalPending(store, snapshot))
  )
    return
  const current = store.readGenerationTaskRuntimeCache((state) =>
    state.tasks.find((task) => task.id === snapshot.id),
  )
  if (current && !isDeepStrictEqual(current, snapshot) && isTextTaskTerminalPending(store, current)) return
  tasks!.delete(snapshot.id)
  if (!isDeepStrictEqual(current, snapshot)) return
  recordGenerationTaskTerminal(snapshot, snapshot.error ? new Error(snapshot.error) : undefined)
}
