import type { GenerationTask } from '@seqora/contracts'
import { isDeepStrictEqual } from 'node:util'
import type { AppStore } from '../../infra/store.js'
import {
  findTextTaskPersistenceContext,
  registerTextTaskControlPersistenceContext,
} from './textTaskPersistenceContext.js'
import { markTextTaskTerminalPending, settleTextTaskTerminal } from './textTaskTerminalEffects.js'

export function captureTextTaskBaselines(store: AppStore, taskId?: string): Map<string, GenerationTask> {
  return store.readGenerationTaskRuntimeCache(
    (state) =>
      new Map(
        state.tasks
          .filter(
            (task) =>
              task.kind === 'text' &&
              task.provider === 'text' &&
              !task.projectId.startsWith('sm-standalone-') &&
              (!taskId || task.id === taskId),
          )
          .map((task) => [task.id, structuredClone(task)]),
      ),
  )
}

/** Recovery and claims use a locked snapshot CAS; worker writes retain their original lease. */
export function registerTextTaskMutations(
  store: AppStore,
  previous: Map<string, GenerationTask>,
): GenerationTask[] {
  return store.readGenerationTaskRuntimeCache((state) => {
    const snapshots: GenerationTask[] = []
    for (const task of state.tasks) {
      const before = previous.get(task.id)
      if (!before || isDeepStrictEqual(task, before)) continue
      if (!findTextTaskPersistenceContext(task)) registerTextTaskControlPersistenceContext(task, before)
      if (task.status !== before.status && (task.status === 'completed' || task.status === 'failed'))
        markTextTaskTerminalPending(store, task)
      snapshots.push(structuredClone(task))
    }
    return snapshots
  })
}

export function settleTextTaskMutations(store: AppStore, tasks: GenerationTask[]): void {
  for (const task of tasks) settleTextTaskTerminal(store, task)
}
