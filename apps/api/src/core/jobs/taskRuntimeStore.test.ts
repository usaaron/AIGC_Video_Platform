import type { GenerationTask } from '@seqora/contracts'
import type { PoolClient, QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'
import { PostgresTaskRuntimeStore } from './taskRuntimeStore.js'
import type { PostgresTransactionRunner } from '../../infra/postgresStore.js'

const timestamp = new Date('2026-01-01T00:00:00.000Z')

describe('PostgresTaskRuntimeStore', () => {
  it('claims queued tasks with row locks instead of loading AppState', async () => {
    const { calls, runner } = createTransactionRunner([
      [],
      userRows(),
      [{ count: '0' }],
      queuedTaskRow(),
      claimedTaskRow(),
    ])
    const runtime = new PostgresTaskRuntimeStore(runner)

    const plan = await runtime.claimQueuedTasks(remoteCapability(), false)

    expect(plan.video).toHaveLength(1)
    expect(plan.video[0]).toMatchObject({ id: 'task-1', status: 'running' })
    const sql = joinedSql(calls)
    expect(sql).toContain('for update skip locked')
    expect(sql).toContain('from generation_tasks')
    expect(sql).toContain('update generation_tasks')
    expect(sql).not.toContain('loadpostgresstate')
    expect(sql).not.toContain('syncpostgresstate')
  })

  it('writes completed outputs through explicit task, media and asset SQL updates', async () => {
    const materialized = {
      outputs: [
        {
          id: 'media-1',
          url: '/api/v1/media/media-1',
          mediaType: 'image' as const,
          view: 'single' as const,
        },
      ],
      media: [
        {
          id: 'media-1',
          projectId: 'project-1',
          tenantId: 'tenant-1',
          kind: 'image' as const,
          name: 'Frame',
          contentType: 'image/png',
          size: 12,
          storageKey: 'tenant-1/project-1/generated/task-1/media-1.png',
          createdAt: timestamp,
        },
      ],
    }
    const { calls, runner } = createTransactionRunner([imageTaskRow(), [], [], assetRow(), []])
    const runtime = new PostgresTaskRuntimeStore(runner)

    await runtime.applyProviderStatus(
      'task-1',
      { status: 'completed', progress: 100, error: null },
      materialized,
    )

    const sql = joinedSql(calls)
    expect(sql).toContain('insert into media')
    expect(sql).toContain('update generation_tasks')
    expect(sql).toContain('from assets')
    expect(sql).toContain('for update')
    expect(sql).toContain('update assets')
    expect(sql).not.toContain('syncpostgresstate')
  })
})

type QueryCall = {
  sql: string
  params: unknown[] | undefined
}

function createTransactionRunner(responses: QueryResultRow[][]): {
  calls: QueryCall[]
  runner: PostgresTransactionRunner
} {
  const calls: QueryCall[] = []
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params })
      const rows = responses.shift() ?? []
      return { rows, rowCount: rows.length }
    },
  } as unknown as PoolClient

  return {
    calls,
    runner: {
      withTransaction: (operation) => operation(client),
    },
  }
}

function joinedSql(calls: QueryCall[]): string {
  return calls.map((call) => call.sql.toLowerCase()).join('\n')
}

function userRows(): QueryResultRow[] {
  return [
    {
      id: 'user-1',
      tenantId: 'tenant-1',
      plan: 'free',
    },
  ]
}

function queuedTaskRow(): QueryResultRow[] {
  return [
    taskRow({
      status: 'queued',
      progress: 0,
      provider: 'seedance',
      metadata: {},
    }),
  ]
}

function claimedTaskRow(): QueryResultRow[] {
  return [
    taskRow({
      status: 'running',
      progress: 1,
      provider: 'seedance',
      metadata: { providerName: 'aideos-seedance', providerState: 'submitting' },
    }),
  ]
}

function imageTaskRow(): QueryResultRow[] {
  return [
    taskRow({
      status: 'running',
      progress: 42,
      kind: 'image',
      provider: 'img2',
      metadata: {
        assetId: 'asset-1',
        generationStage: 'face',
        turnaround: false,
      },
    }),
  ]
}

function assetRow(): QueryResultRow[] {
  return [
    {
      id: 'asset-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      kind: 'character',
      sourceMode: 'generate',
      name: 'Character',
      description: '',
      prompt: '',
      promptMode: 'standard',
      customPromptMode: 'append',
      customPrompt: '',
      negativePrompt: '',
      references: [],
      attributes: {
        type: 'character',
        subjectType: 'human',
        gender: 'female',
        ageGroup: 'young',
        exactAge: null,
        species: '',
        anthropomorphic: false,
        visualStyle: 'cinematic-cg',
        framing: 'full',
        bodyType: 'balanced',
        background: 'solid',
        faceStatus: 'pending',
        bodyStatus: 'pending',
        faceReference: null,
        bodyReference: null,
        legStretch: false,
        faceBrightening: false,
        turnaround: false,
        turnaroundReferences: [],
        turnaroundLayout: 'sheet',
      },
      imageUrl: null,
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
}

function taskRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: 'task-1',
    clientRequestId: 'client-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    kind: 'video',
    label: 'Task',
    prompt: '',
    negativePrompt: '',
    provider: 'seedance',
    model: null,
    metadata: {},
    status: 'queued',
    progress: 0,
    estimatedCredits: 6,
    resultUrl: null,
    outputs: [],
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function remoteCapability() {
  return {
    usesRemoteProvider: (task: GenerationTask) => task.kind === 'video' || task.kind === 'image',
    usesRemoteVideoProvider: (task: GenerationTask) => task.kind === 'video',
    usesRemoteImageProvider: (task: GenerationTask) => task.kind === 'image',
    usesRemoteAudioProvider: () => false,
  }
}
