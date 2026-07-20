import type { GenerationTask, Project } from '@seqora/contracts'
import type { PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import type { AppState, StoredMedia, StoredUser } from './store.js'
import { syncPostgresState } from './postgresWrite.js'

describe('syncPostgresState', () => {
  it('writes table diffs without truncating the database', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    const user: StoredUser = {
      id: 'user-1',
      email: 'creator@example.com',
      name: 'Creator',
      passwordHash: 'hash',
      tenantId: 'tenant-1',
      roles: ['creator'],
      plan: 'free',
      credits: 10,
    }
    const project: Project = {
      id: 'project-1',
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: 'Project',
      contentType: 'short-drama',
      aspectRatio: '9:16',
      status: 'producing',
      synopsis: '',
      script: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    const queuedTask: GenerationTask = {
      id: 'task-1',
      clientRequestId: 'client-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      kind: 'image',
      label: '角色图',
      prompt: 'character',
      negativePrompt: '',
      provider: 'img2',
      model: null,
      metadata: {},
      status: 'queued',
      progress: 0,
      estimatedCredits: 4,
      resultUrl: null,
      outputs: [],
      error: null,
      createdAt: now,
      updatedAt: now,
    }
    const media: StoredMedia = {
      id: 'media-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      kind: 'image',
      name: '角色图.png',
      contentType: 'image/png',
      size: 128,
      storageKey: 'generated/media-1.png',
      createdAt: now,
    }
    const previous: AppState = {
      users: [user],
      projects: [project],
      assets: [],
      shots: [],
      tasks: [queuedTask],
      ledger: [],
      media: [],
    }
    const next: AppState = {
      ...previous,
      tasks: [
        {
          ...queuedTask,
          status: 'completed',
          progress: 100,
          resultUrl: '/api/v1/media/media-1',
          outputs: [{ id: 'media-1', url: '/api/v1/media/media-1', mediaType: 'image', view: 'single' }],
          updatedAt: now,
        },
      ],
      media: [media],
    }
    const client = createRecordingClient()

    await syncPostgresState(client, previous, next)

    const sql = client.queries.join('\n').toLowerCase()
    expect(sql).not.toContain('truncate')
    expect(sql).toContain('insert into generation_tasks')
    expect(sql).toContain('insert into media')
    expect(sql).not.toContain('insert into users')
    expect(sql).not.toContain('insert into projects')
  })
})

function createRecordingClient() {
  const queries: string[] = []
  return {
    queries,
    async query(sql: string) {
      queries.push(sql)
      return { rows: [], rowCount: 0 }
    },
  } as unknown as PoolClient & { queries: string[] }
}
