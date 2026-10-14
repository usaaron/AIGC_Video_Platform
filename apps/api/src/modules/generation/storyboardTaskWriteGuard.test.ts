import type { CreateGenerationTask, Principal, Shot } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import type { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'

const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}
const projectId = 'project-midnight-film'
const originalTime = '2026-09-20T01:00:00.000Z'
const revisedTime = '2026-09-20T02:00:00.000Z'
const creationModes = ['charged', 'free', 'batch'] as const
type CreationMode = (typeof creationModes)[number]

function input(id = 'revision-race-task', shotId = 'revision-shot'): CreateGenerationTask {
  return {
    projectId,
    clientRequestId: id,
    kind: 'video',
    provider: 'seedance',
    label: '修订并发测试',
    estimatedCredits: 7,
    metadata: { shotId, sourceShotUpdatedAt: originalTime },
  }
}

function shot(id = 'revision-shot'): Shot {
  return {
    id,
    projectId,
    tenantId: principal.tenantId,
    scriptEpisodeId: null,
    order: 1,
    title: '测试镜头',
    prompt: '林澈翻开档案。',
    framing: '中景',
    duration: 5,
    negativePrompt: '',
    imageUrl: null,
    continuityMode: 'independent',
    continuityNote: '',
    episodeBreakBefore: false,
    episodeNumber: 1,
    episodeTitle: '第 1 集',
    episodeKind: 'standard',
    createdAt: originalTime,
    updatedAt: originalTime,
  }
}

function filmInput(): CreateGenerationTask {
  return {
    projectId,
    clientRequestId: 'film-revision-race',
    kind: 'video',
    provider: 'local-compose',
    label: '修订并发成片测试',
    estimatedCredits: 0,
    metadata: {
      generationStage: 'film-preview',
      sourceShotIds: ['revision-shot', 'second-shot'],
      sourceVideoTaskIds: ['first-video', 'second-video'],
    },
  }
}

function create(repository: GenerationTaskRepository, mode: CreationMode, value = input()) {
  if (mode === 'batch') return repository.createBatchWithCharge([value], principal)
  if (mode === 'free') return repository.create(value, principal)
  return repository.createWithCharge(value, principal)
}

async function fixture() {
  const store = new AppStore(null)
  await store.initialize()
  await store.mutate((state) => {
    state.shots = [shot(), { ...shot('second-shot'), order: 2 }]
    state.tasks = []
  })
  return { store, repository: new GenerationTaskRepository(store) }
}

function balances(store: AppStore) {
  return store.read((state) => ({
    credits: state.users.find((user) => user.id === principal.userId)!.credits,
    ledger: state.ledger,
    tasks: state.tasks,
  }))
}

describe('storyboard task creation after script revision', () => {
  for (const mode of creationModes) {
    it(`${mode}: rejects removed targets without inserting or charging`, async () => {
      const { store, repository } = await fixture()
      await store.mutate((state) => {
        state.shots = []
      })
      const before = balances(store)

      await expect(create(repository, mode)).rejects.toMatchObject({ code: 'SHOT_NOT_FOUND' })
      expect(balances(store)).toEqual(before)
    })

    it(`${mode}: rejects a changed snapshot without inserting or charging`, async () => {
      const { store, repository } = await fixture()
      await store.mutate((state) => {
        state.shots[0]!.updatedAt = revisedTime
        state.shots[0]!.prompt = '林澈将档案放回桌面。'
      })
      const before = balances(store)

      await expect(create(repository, mode)).rejects.toMatchObject({ code: 'SHOT_CHANGED' })
      expect(balances(store)).toEqual(before)
    })

    it(`${mode}: accepts current targets and replays a committed request after removal`, async () => {
      const { store, repository } = await fixture()
      const created = await create(repository, mode)
      await store.mutate((state) => {
        state.shots = []
      })
      const before = balances(store)

      expect(await create(repository, mode)).toEqual(created)
      expect(balances(store)).toEqual(before)
      expect(before.tasks).toHaveLength(1)
    })
  }

  it('validates every batch target before charging any of them', async () => {
    const { store, repository } = await fixture()
    await store.mutate((state) => {
      state.shots[1]!.updatedAt = revisedTime
    })
    const before = balances(store)

    await expect(
      repository.createBatchWithCharge([input(), input('second-task', 'second-shot')], principal),
    ).rejects.toMatchObject({ code: 'SHOT_CHANGED' })
    expect(balances(store)).toEqual(before)
  })

  it('also rejects removed image targets that have no video snapshot', async () => {
    const { store, repository } = await fixture()
    const before = balances(store)
    await expect(
      repository.createWithCharge(
        { ...input(), kind: 'image', provider: 'local', metadata: { shotId: 'removed-shot' } },
        principal,
      ),
    ).rejects.toMatchObject({ code: 'SHOT_NOT_FOUND' })
    expect(balances(store)).toEqual(before)
  })

  it('does not accept a matching shot id belonging to another tenant', async () => {
    const { store, repository } = await fixture()
    await store.mutate((state) => {
      state.shots[0]!.tenantId = 'other-tenant'
    })
    const before = balances(store)
    await expect(repository.createWithCharge(input(), principal)).rejects.toMatchObject({
      code: 'SHOT_NOT_FOUND',
    })
    expect(balances(store)).toEqual(before)
  })

  it('accepts equivalent snapshot timestamp formats', async () => {
    const { repository } = await fixture()
    await expect(
      repository.createWithCharge(
        {
          ...input(),
          metadata: { shotId: 'revision-shot', sourceShotUpdatedAt: '2026-09-20T09:00:00+08:00' },
        },
        principal,
      ),
    ).resolves.toMatchObject({ status: 'queued' })
  })
})

describe('database storyboard creation transaction boundary', () => {
  // These doubles model a revision committing while the project row lock is awaited.
  // Real Postgres locking/FK behavior remains the integration suite's responsibility.
  for (const mode of creationModes) {
    for (const removed of [true, false]) {
      it(`${mode}: rereads the ${removed ? 'removed' : 'updated'} target after acquiring the import lock`, async () => {
        const events: string[] = []
        let heldProject = false
        let timestamp: string | null = originalTime
        const database = {
          transaction: async (run: (client: unknown) => Promise<unknown>) =>
            run({
              query: async (sql: string, params: unknown[]) => {
                if (sql.includes('FROM generation_tasks') && sql.includes('client_request_id =')) {
                  return { rows: [] }
                }
                if (sql.includes('FROM projects')) {
                  expect(sql).toContain('FOR UPDATE')
                  expect(params).toEqual([projectId, principal.tenantId, false, principal.userId])
                  events.push('project-lock')
                  timestamp = removed ? null : revisedTime
                  heldProject = true
                  return { rows: [{ id: projectId }] }
                }
                if (sql.includes('FROM shots')) {
                  expect(heldProject).toBe(true)
                  expect(params).toEqual(['revision-shot', projectId, principal.tenantId])
                  events.push('read-shot')
                  return { rows: timestamp ? [{ updated_at: new Date(timestamp) }] : [] }
                }
                events.push('unexpected-billing-or-write')
                throw new Error(`Unexpected query before rejecting the stale target: ${sql}`)
              },
            }),
        } as unknown as AccountDatabase
        const repository = new GenerationTaskRepository(null, null, database)

        await expect(create(repository, mode)).rejects.toMatchObject({
          code: removed ? 'SHOT_NOT_FOUND' : 'SHOT_CHANGED',
        })
        expect(events).toEqual(['project-lock', 'read-shot'])
      })
    }
  }
})

describe('film preview task creation after script revision', () => {
  for (const mode of creationModes) {
    it(`${mode}: rejects a plan whose source shot was replaced`, async () => {
      const { store, repository } = await fixture()
      await store.mutate((state) => {
        state.shots[1]!.id = 'revised-second-shot'
      })
      const before = balances(store)

      await expect(create(repository, mode, filmInput())).rejects.toMatchObject({
        code: 'FILM_STORYBOARD_CHANGED',
      })
      expect(balances(store)).toEqual(before)
    })

    it(`${mode}: rejects a plan whose chosen video changed`, async () => {
      const { store, repository } = await fixture()
      await store.mutate((state) => {
        state.shots[1]!.selectedVideoTaskId = 'newly-selected-video'
      })
      const before = balances(store)

      await expect(create(repository, mode, filmInput())).rejects.toMatchObject({
        code: 'FILM_STORYBOARD_CHANGED',
      })
      expect(balances(store)).toEqual(before)
    })
  }

  it('keeps the planner fallback when a shot has no explicit selected video', async () => {
    const { store, repository } = await fixture()
    await store.mutate((state) => {
      state.shots[0]!.selectedVideoTaskId = 'first-video'
      state.shots[1]!.selectedVideoTaskId = null
    })
    await expect(repository.create(filmInput(), principal)).resolves.toMatchObject({ status: 'queued' })
  })

  for (const removed of [true, false]) {
    it(`database: rejects a preview pre-read before the ${removed ? 'shot' : 'selected video'} changed`, async () => {
      const events: string[] = []
      let locked = false
      const database = {
        transaction: async (run: (client: unknown) => Promise<unknown>) =>
          run({
            query: async (sql: string, params: unknown[]) => {
              if (sql.includes('FROM generation_tasks') && sql.includes('client_request_id =')) {
                return { rows: [] }
              }
              if (sql.includes('FROM projects')) {
                expect(sql).toContain('FOR UPDATE')
                events.push('project-lock')
                locked = true
                return { rows: [{ id: projectId }] }
              }
              if (sql.includes('FROM shots')) {
                expect(locked).toBe(true)
                expect(params).toEqual([['revision-shot', 'second-shot'], projectId, principal.tenantId])
                events.push('read-film-shots')
                return {
                  rows: [
                    { id: 'revision-shot', selected_video_task_id: 'first-video' },
                    ...(removed ? [] : [{ id: 'second-shot', selected_video_task_id: 'new-video' }]),
                  ],
                }
              }
              throw new Error('Preview task must be rejected before billing or insertion')
            },
          }),
      } as unknown as AccountDatabase
      const repository = new GenerationTaskRepository(null, null, database)

      await expect(repository.create(filmInput(), principal)).rejects.toMatchObject({
        code: 'FILM_STORYBOARD_CHANGED',
      })
      expect(events).toEqual(['project-lock', 'read-film-shots'])
    })
  }
})
