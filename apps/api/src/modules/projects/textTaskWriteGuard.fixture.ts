import { createProjectSchema, type Principal } from '@seqora/contracts'
import { captureTextTaskWriteGuard } from '../../core/jobs/textTaskExecutionGuard.js'
import { claimGenerationTaskLease } from '../../core/jobs/taskLease.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from '../generation/repository.js'
import { buildQueuedGenerationTask } from '../generation/taskCreation.js'
import { UserRepository } from '../users/repository.js'
import { ProjectRepository } from './repository.js'

export const textWritePrincipal: Principal = {
  tenantId: 'tenant-seqora-demo',
  userId: 'user-member',
  roles: ['member'],
}

export async function setupTextWriteGuard(database: AccountDatabase | null = null) {
  const store = database ? new AppStore(null, undefined, true, true, true, true) : new AppStore(null)
  await store.initialize()
  if (database) await new UserRepository(store, database).bootstrapFromStore()
  const repository = new ProjectRepository(store, database)
  const project = await repository.create(
    createProjectSchema.parse({ name: 'Text write guard', contentType: 'short-drama', aspectRatio: '9:16' }),
    textWritePrincipal,
  )
  const episode = (await repository.writeScriptEpisodeDraft(
    project.id,
    null,
    'Original episode draft',
    textWritePrincipal,
  ))!
  const task = buildQueuedGenerationTask(
    {
      clientRequestId: `text-write-${project.id}`,
      projectId: project.id,
      kind: 'text',
      provider: 'text',
      model: 'synthetic-text-model',
      label: 'Synthetic text write guard',
      estimatedCredits: 0,
      metadata: { scriptOperation: 'generate' },
    },
    textWritePrincipal,
    new Date().toISOString(),
  )
  claimGenerationTaskLease(task, 'text-write-worker', 60_000)
  const guard = captureTextTaskWriteGuard(task)
  await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
    state.tasks = [structuredClone(task)]
  })
  if (database) await new GenerationTaskRepository(store, null, database).importFromStore()
  return { store, repository, project, episode, task, guard }
}
