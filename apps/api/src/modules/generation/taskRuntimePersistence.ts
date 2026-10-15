import { isDeepStrictEqual } from 'node:util'
import type { GenerationTask } from '@seqora/contracts'
import { normalizeGenerationTaskLifecycle } from '../../core/jobs/taskLease.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from './repositoryData.js'
import { clearProviderCompletionContext } from '../../core/jobs/providerCompletionContext.js'
import { clearTextTaskPersistenceContext } from '../../core/jobs/textTaskPersistenceContext.js'
import { settleTextTaskTerminal } from '../../core/jobs/textTaskTerminalEffects.js'
import {
  clearImageWorkspaceWriteback,
  restoreRejectedImageWorkspaceWriteback,
} from '../../core/jobs/imageWorkspaceWriteback.js'
import { updateGenerationTaskLifecycle, updateTaskResultTargets } from './taskLifecyclePersistence.js'

type RuntimeTaskSnapshot = {
  task: GenerationTask
  selectedVersions?: { imageTaskId: string | null; videoTaskId: string | null } | undefined
}

export async function persistRuntimeTaskSnapshots(
  store: AppStore,
  database: AccountDatabase,
  snapshots: RuntimeTaskSnapshot[],
): Promise<number> {
  const rejected: GenerationTask[] = []
  const updated = await database.transaction(async (client) => {
    let count = 0
    for (const { task, selectedVersions } of snapshots) {
      const persisted = await updateGenerationTaskLifecycle(client, task, { runtimeSnapshot: true })
      if (!persisted) {
        rejected.push(task)
        continue
      }
      count += 1
      await updateTaskResultTargets(client, persisted, selectedVersions)
    }
    return count
  })
  for (const { task } of snapshots) {
    clearProviderCompletionContext(task)
    clearTextTaskPersistenceContext(task)
    if (!rejected.includes(task)) clearImageWorkspaceWriteback(store, task)
  }
  await reconcileRejectedTaskSnapshots(store, database, rejected)
  for (const task of rejected) clearImageWorkspaceWriteback(store, task)
  for (const { task } of snapshots) settleTextTaskTerminal(store, task, !rejected.includes(task))
  return updated
}

/** Rejected worker results must not remain authoritative in the runtime cache. */
async function reconcileRejectedTaskSnapshots(
  store: AppStore,
  database: AccountDatabase,
  rejected: GenerationTask[],
): Promise<void> {
  if (!rejected.length) return
  const result = await database.query<GenerationTaskRow>(
    `SELECT ${generationTaskColumns} FROM generation_tasks
     WHERE id = ANY($1::text[]) AND project_id NOT LIKE 'sm-standalone-%'`,
    [rejected.map((task) => task.id)],
  )
  const current = new Map(result.rows.map(taskFromRow).map((task) => [task.id, task]))
  await store.mutateRuntimeCachesAsync(
    (state) => {
      for (const snapshot of rejected) {
        const persisted = current.get(snapshot.id)
        const accepted =
          persisted?.status === 'completed' &&
          isDeepStrictEqual(
            persisted.metadata.providerCompletionReceipt,
            snapshot.metadata.providerCompletionReceipt,
          )
        if (!accepted) restoreRejectedImageWorkspaceWriteback(store, state, snapshot)
        if (
          snapshot.metadata.providerCompletionReceipt === undefined &&
          persisted?.metadata.providerCompletionReceipt === undefined &&
          !(snapshot.kind === 'text' && snapshot.provider === 'text') &&
          !(persisted?.kind === 'text' && persisted.provider === 'text')
        ) {
          continue
        }
        const index = state.tasks.findIndex((task) => task.id === snapshot.id)
        if (
          index < 0 ||
          !isDeepStrictEqual(normalizeGenerationTaskLifecycle(state.tasks[index]!), snapshot)
        ) {
          continue
        }
        if (persisted) state.tasks[index] = persisted
        else state.tasks.splice(index, 1)
      }
    },
    ['generationTasks', 'projectWorkspace'],
  )
}
