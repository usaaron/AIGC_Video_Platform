import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Principal } from '@seqora/contracts'
import { AccountDatabase } from '../../infra/postgres.js'
import { AppStore } from '../../infra/store.js'
import { startPostgresAuthFixture, type PostgresAuthFixture } from '../../testing/postgresAuth.js'
import { UserRepository } from '../users/repository.js'
import { ProjectRepository } from '../projects/repository.js'
import { GenerationTaskRepository } from './repository.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }
let fixture: PostgresAuthFixture
let db: AccountDatabase
let tasks: GenerationTaskRepository

beforeAll(async () => {
  fixture = await startPostgresAuthFixture()
}, 120_000)
beforeEach(async () => {
  await fixture.reset()
  db = new AccountDatabase(fixture.connectionString)
  const store = new AppStore(null)
  await store.initialize()
  await new UserRepository(store, db).bootstrapFromStore()
  await new ProjectRepository(store, db).importFromStore()
  tasks = new GenerationTaskRepository(store, null, db)
})
afterEach(async () => {
  await db?.close()
})
afterAll(async () => {
  await fixture?.close()
})

async function image(request: string) {
  const task = await tasks.create(
    {
      clientRequestId: request,
      projectId: 'project-midnight-film',
      kind: 'image',
      label: 'completed reference',
      prompt: '',
      negativePrompt: '',
      provider: 'img2',
      model: 'image2',
      estimatedCredits: 0,
      metadata: {},
    },
    principal,
  )
  await db.query(
    `UPDATE generation_tasks SET status = 'completed', progress = 100,
    outputs = $2::jsonb WHERE id = $1`,
    [
      task.id,
      JSON.stringify([
        {
          id: `${task.id}-single`,
          mediaType: 'image',
          view: 'single',
          url: `/api/v1/generation/tasks/${task.id}/outputs/single`,
        },
      ]),
    ],
  )
  return task.id
}

async function restartedActiveIds() {
  const store = new AppStore(null)
  await store.initialize()
  const repository = new GenerationTaskRepository(store, null, db)
  await repository.refreshRuntimeCacheFromDatabase({ activeOnly: true })
  return store.readGenerationTaskRuntimeCache((state) => state.tasks.map((task) => task.id))
}

describe('Postgres video reference image task dependencies', () => {
  it.each(['queued', 'running'])(
    'retains completed local image sources across a worker restart for %s video',
    async (status) => {
      const face = await image('face-reference')
      const scene = await image('scene-reference')
      const unrelated = await image('unrelated-image')
      const video = await tasks.create(
        {
          clientRequestId: 'video',
          projectId: 'project-midnight-film',
          kind: 'video',
          label: 'video with references',
          prompt: '',
          negativePrompt: '',
          provider: 'seedance',
          model: 'seedance',
          estimatedCredits: 0,
          metadata: {
            shotId: 'shot-1',
            images: [
              `/api/v1/generation/tasks/${face}/outputs/single`,
              `/api/v1/generation/tasks/${scene}/outputs/single`,
            ],
          },
        },
        principal,
      )
      await db.query('UPDATE generation_tasks SET status = $2 WHERE id = $1', [video.id, status])
      const ids = await restartedActiveIds()
      expect(ids).toEqual(expect.arrayContaining([video.id, face, scene]))
      expect(ids).not.toContain(unrelated)
    },
  )

  it('rejects completed source tasks outside the video project or tenant while preserving valid sources', async () => {
    const valid = await image('valid-reference')
    await db.query(
      `INSERT INTO tenants (id, name, status) VALUES ('foreign-tenant', 'Foreign test', 'active')`,
    )
    for (const [project, tenant, source] of [
      ['foreign-project', 'foreign-tenant', 'foreign-tenant-image'],
      ['other-project', principal.tenantId, 'other-project-image'],
    ]) {
      await db.query(
        `INSERT INTO projects SELECT (jsonb_populate_record(NULL::projects,
          to_jsonb(p) || jsonb_build_object('id', $1::text, 'tenant_id', $2::text))).*
          FROM projects p WHERE p.id = 'project-midnight-film'`,
        [project, tenant],
      )
      await db.query(
        `INSERT INTO generation_tasks
        (id, client_request_id, project_id, tenant_id, user_id, kind, label, provider, status)
        VALUES ($1, $1, $2, $3, $4, 'image', 'foreign source', 'img2', 'completed')`,
        [source, project, tenant, principal.userId],
      )
    }
    const video = await tasks.create(
      {
        clientRequestId: 'video',
        projectId: 'project-midnight-film',
        kind: 'video',
        label: 'scoped references',
        prompt: '',
        negativePrompt: '',
        provider: 'seedance',
        model: 'seedance',
        estimatedCredits: 0,
        metadata: {
          shotId: 'shot-1',
          images: [valid, 'foreign-tenant-image', 'other-project-image'].map(
            (id) => `/api/v1/generation/tasks/${id}/outputs/single`,
          ),
        },
      },
      principal,
    )
    const ids = await restartedActiveIds()
    expect(ids).toEqual(expect.arrayContaining([video.id, valid]))
    expect(ids).not.toContain('foreign-tenant-image')
    expect(ids).not.toContain('other-project-image')
  })
})
