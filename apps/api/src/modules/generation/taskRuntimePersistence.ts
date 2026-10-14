import { isDeepStrictEqual } from 'node:util'
import type { GenerationTask } from '@seqora/contracts'
import { normalizeGenerationTaskLifecycle } from '../../core/jobs/taskLease.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type { AppStore } from '../../infra/store.js'
import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from './repositoryData.js'
import { clearProviderCompletionContext } from '../../core/jobs/providerCompletionContext.js'
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
      const persisted = await updateGenerationTaskLifecycle(client, task)
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
    if (!rejected.includes(task)) clearImageWorkspaceWriteback(store, task)
  }
  await reconcileRejectedProviderCompletions(store, database, rejected)
  for (const task of rejected) clearImageWorkspaceWriteback(store, task)
  return updated
}

/** A rejected worker timestamp is not authority to retain its receipt in the runtime cache. */
async function reconcileRejectedProviderCompletions(
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
          persisted?.metadata.providerCompletionReceipt === undefined
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
