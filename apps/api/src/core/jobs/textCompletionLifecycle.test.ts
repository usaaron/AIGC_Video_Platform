import { randomUUID } from 'node:crypto'
import type { GenerationTask, ScriptEpisode, TextCompletionReceipt } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { textCompletionEvidence } from '../../modules/generation/textCompletionEvidence.js'
import { queuedTextTask } from '../../testing/generationTaskFixtures.js'
import { completeLocalTask, failLocalTextTask } from './localTaskWriteback.js'
import { claimGenerationTaskLease, releaseGenerationTaskLease } from './taskLease.js'
import { DependencyResolver, TaskClaimer } from './taskRunnerComponents.js'
import { createTextCompletionRecorder } from './textCompletion.js'
import { captureTextTaskWriteGuard } from './textTaskExecutionGuard.js'
import { findTextTaskPersistenceContext } from './textTaskPersistenceContext.js'

async function fixture() {
  const store = new AppStore(null)
  await store.initialize()
  const task = queuedTextTask(randomUUID())
  task.metadata.generationStage = 'script-generate'
  claimGenerationTaskLease(task, 'completion-lifecycle-worker', 60_000)
  await store.mutate((state) => {
    state.tasks = [structuredClone(task)]
    state.scriptEpisodes = []
  })
  const guard = captureTextTaskWriteGuard(task)
  const recorder = createTextCompletionRecorder(
    { generate: async () => 'Synthetic completed text' },
    { taskWriteGuard: guard },
  )
  const script = await recorder.provider!.generate({ systemPrompt: 'Synthetic', userPrompt: 'Synthetic' })
  const result = recorder.finish({ script }, 'provider-derived')
  const complete = (value: unknown = result) =>
    completeLocalTask(store, guard.leaseOwnerId, task.id, guard.leaseToken, value, undefined, guard)
  const read = () => store.read((state) => state.tasks.find((item) => item.id === task.id))!
  return { store, task, guard, result, complete, read }
}

describe('text completion lifecycle writeback', () => {
  it('writes collector evidence and exact result in the original guarded terminal snapshot', async () => {
    const f = await fixture()
    const completed = await f.complete()
    expect(completed).not.toBeNull()
    expect(textCompletionEvidence(completed!).reason).toBe('verified')
    expect(completed!.metadata.textResult).toEqual(f.result)
    expect(completed!.leaseToken).toBeNull()
    expect(findTextTaskPersistenceContext(completed!)).toMatchObject({ kind: 'worker', guard: f.guard })
    expect(f.read()).toEqual(completed)
    expect(JSON.stringify(completed!.metadata.textCompletionReceipt)).not.toContain(f.guard.leaseToken)
  })

  it.each(['unrecorded', 'cloned', 'changed'] as const)(
    'clears carried metadata proof when the result is %s',
    async (mode) => {
      const f = await fixture()
      await f.store.mutateGenerationTaskRuntimeCacheAsync((state) => {
        state.tasks[0]!.metadata.textCompletionReceipt = { forged: true }
        state.tasks[0]!.metadata.textResult = { script: 'Old result' }
      })
      let result = f.result
      if (mode === 'unrecorded') result = { script: 'Unrecorded result' }
      if (mode === 'cloned') result = structuredClone(f.result)
      if (mode === 'changed') result.script = 'Changed after collector registration'
      const completed = await f.complete(result)
      expect(completed!.status).toBe('completed')
      expect(completed!.metadata.textCompletionReceipt).toBeUndefined()
      expect(completed!.metadata.textResult).toEqual(result)
      expect(textCompletionEvidence(completed!).reason).toBe('missing-receipt')
    },
  )

  it('rejects a replaced token without consuming the original result evidence', async () => {
    const f = await fixture()
    await f.store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks[0]!.leaseToken = 'replacement-token'
    })
    expect(await f.complete()).toBeNull()
    expect(f.read().status).toBe('running')
    expect(f.read().metadata.textCompletionReceipt).toBeUndefined()
    await f.store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks[0]!.leaseToken = f.guard.leaseToken
    })
    expect(textCompletionEvidence((await f.complete())!).reason).toBe('verified')
  })

  it('clears carried receipt on the guarded failure path', async () => {
    const f = await fixture()
    await f.store.mutateGenerationTaskRuntimeCacheAsync((state) => {
      state.tasks[0]!.metadata.textCompletionReceipt = { forged: true }
    })
    const failed = await failLocalTextTask(f.store, f.guard, 'Synthetic failure', {
      executionStartedAtMs: Date.now(),
      firstPreviewAtMs: null,
      textTimings: [],
    })
    expect(failed!.status).toBe('failed')
    expect(failed!.metadata.textCompletionReceipt).toBeUndefined()
    expect(failed!.leaseToken).toBeNull()
    expect(await f.complete()).toBeNull()
  })

  it.each([true, false])(
    'clears old completion facts when claiming with countAttempt=%s',
    async (countAttempt) => {
      const f = await fixture()
      const completed = (await f.complete())!
      const previousAttempt = completed.attempts!
      claimGenerationTaskLease(completed, 'next-worker', 60_000, new Date(), { countAttempt })
      expect(completed.status).toBe('running')
      expect(completed.attempts).toBe(previousAttempt + (countAttempt ? 1 : 0))
      expect(completed.metadata.textCompletionReceipt).toBeUndefined()
      expect(completed.metadata.textResult).toBeUndefined()
      expect(completed.metadata.localTaskCompletedAt).toBeUndefined()
    },
  )

  it.each(['queued', 'paused', 'running', 'cancelled', 'failed'] as const)(
    'removes a carried receipt when releasing a %s task',
    async (status) => {
      const f = await fixture()
      const task = (await f.complete())!
      task.status = status
      releaseGenerationTaskLease(task)
      expect(task.metadata.textCompletionReceipt).toBeUndefined()
      expect(task.leaseOwnerId).toBeNull()
      expect(task.leaseToken).toBeNull()
    },
  )

  it('preserves truthful completed evidence when a completed task releases its lease again', async () => {
    const f = await fixture()
    const task = (await f.complete())!
    const receipt = structuredClone(task.metadata.textCompletionReceipt)
    releaseGenerationTaskLease(task)
    expect(task.metadata.textCompletionReceipt).toEqual(receipt)
    expect(textCompletionEvidence(task).reason).toBe('verified')
  })
})

describe('text completion draft recovery provenance', () => {
  it.each(['active marker', 'expired legacy'] as const)(
    'recovers %s draft without retaining or inventing a completion receipt',
    async (mode) => {
      const f = await fixture()
      const completed = (await f.complete())!
      const receipt = completed.metadata.textCompletionReceipt as TextCompletionReceipt
      const now = new Date().toISOString()
      const episode: ScriptEpisode = {
        id: 'recovery-episode',
        projectId: f.task.projectId,
        tenantId: f.task.tenantId,
        episodeNumber: 1,
        title: 'Recovered episode',
        content: '',
        draftContent: 'Recovered durable draft',
        status: 'draft',
        summary: '',
        continuityState:
          mode === 'active marker' ? { generationClientRequestId: f.task.clientRequestId } : {},
        revision: 1,
        lastEditedBy: f.task.userId,
        createdAt: now,
        updatedAt: now,
      }
      const running: GenerationTask = {
        ...f.task,
        metadata: { ...f.task.metadata, textCompletionReceipt: receipt, textPreview: 'Recovered preview' },
        leaseExpiresAt: mode === 'active marker' ? f.task.leaseExpiresAt : '2020-01-01T00:00:00.000Z',
      }
      await f.store.mutate((state) => {
        state.tasks = [running]
        state.scriptEpisodes = [episode]
      })
      const claimer = new TaskClaimer(f.store, new DependencyResolver(), {
        leaseOwnerId: 'recovery-worker',
        leaseTtlMs: 30_000,
        videoProviderName: 'stringx-seedance',
        hasVideoProvider: true,
        hasImageProvider: true,
        hasObjectStorage: true,
      })
      expect((await claimer.recoverStaleRunningTasks()).local).toEqual([])
      const recovered = f.read()
      expect(recovered.status).toBe('completed')
      expect(recovered.metadata.textResult).toMatchObject({ script: episode.draftContent, episode })
      expect(recovered.metadata.textCompletionReceipt).toBeUndefined()
      expect(recovered.metadata.scriptWritebackRecoveredAt).toEqual(expect.any(String))
      expect(textCompletionEvidence(recovered).reason).toBe('missing-receipt')
      expect(recovered.leaseToken).toBeNull()
    },
  )
})
