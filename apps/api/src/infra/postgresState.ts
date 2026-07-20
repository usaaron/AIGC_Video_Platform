import type { Asset, GenerationTask, LedgerEntry, Project, Role, Shot } from '@seqora/contracts'
import type { PoolClient, QueryResultRow } from 'pg'
import type { AppState, StoredMedia, StoredUser } from './store.js'
import { normalizeState } from './store.js'

type UserRow = QueryResultRow & {
  id: string
  email: string
  name: string
  passwordHash: string
  tenantId: string
  roles: Role[]
  plan: StoredUser['plan']
  credits: number
}

type ProjectRow = QueryResultRow &
  Omit<Project, 'contentType' | 'aspectRatio' | 'createdAt' | 'updatedAt'> & {
    contentType: Project['contentType']
    aspectRatio: Project['aspectRatio']
    createdAt: Date | string
    updatedAt: Date | string
  }

type AssetRow = QueryResultRow &
  Omit<
    Asset,
    | 'sourceMode'
    | 'promptMode'
    | 'customPromptMode'
    | 'references'
    | 'attributes'
    | 'imageUrl'
    | 'createdAt'
    | 'updatedAt'
  > & {
    sourceMode: Asset['sourceMode']
    promptMode: Asset['promptMode']
    customPromptMode: Asset['customPromptMode']
    references: unknown
    attributes: unknown
    imageUrl: string | null
    createdAt: Date | string
    updatedAt: Date | string
  }

type ShotRow = QueryResultRow &
  Omit<Shot, 'order' | 'createdAt' | 'updatedAt'> & {
    order: number
    createdAt: Date | string
    updatedAt: Date | string
  }

type TaskRow = QueryResultRow &
  Omit<
    GenerationTask,
    | 'clientRequestId'
    | 'negativePrompt'
    | 'estimatedCredits'
    | 'resultUrl'
    | 'metadata'
    | 'outputs'
    | 'createdAt'
    | 'updatedAt'
  > & {
    clientRequestId: string
    negativePrompt: string
    estimatedCredits: number
    resultUrl: string | null
    metadata: unknown
    outputs: unknown
    createdAt: Date | string
    updatedAt: Date | string
  }

type LedgerRow = QueryResultRow & Omit<LedgerEntry, 'createdAt'> & { createdAt: Date | string }
type MediaRow = QueryResultRow &
  Omit<StoredMedia, 'contentType' | 'storageKey' | 'createdAt'> & {
    contentType: string
    storageKey: string
    createdAt: Date | string
  }

export async function loadPostgresState(client: PoolClient): Promise<AppState> {
  const users = await rows<UserRow>(
    client,
    `
      select id, email, name, password_hash as "passwordHash", tenant_id as "tenantId",
        roles, plan, credits
      from users
      order by created_at, id
    `,
  )
  const projects = await rows<ProjectRow>(
    client,
    `
      select id, tenant_id as "tenantId", owner_id as "ownerId", name,
        content_type as "contentType", aspect_ratio as "aspectRatio", status,
        synopsis, script, version, created_at as "createdAt", updated_at as "updatedAt"
      from projects
      order by updated_at desc, id
    `,
  )
  const assets = await rows<AssetRow>(
    client,
    `
      select id, project_id as "projectId", tenant_id as "tenantId", kind,
        source_mode as "sourceMode", name, description, prompt,
        prompt_mode as "promptMode", custom_prompt_mode as "customPromptMode",
        custom_prompt as "customPrompt", negative_prompt as "negativePrompt",
        references, attributes, image_url as "imageUrl", status,
        created_at as "createdAt", updated_at as "updatedAt"
      from assets
      order by updated_at desc, id
    `,
  )
  const shots = await rows<ShotRow>(
    client,
    `
      select id, project_id as "projectId", tenant_id as "tenantId",
        order_index as "order", title, framing, duration, prompt,
        image_url as "imageUrl", created_at as "createdAt", updated_at as "updatedAt"
      from shots
      order by project_id, order_index
    `,
  )
  const tasks = await rows<TaskRow>(
    client,
    `
      select id, client_request_id as "clientRequestId", project_id as "projectId",
        tenant_id as "tenantId", user_id as "userId", kind, label, prompt,
        negative_prompt as "negativePrompt", provider, model, metadata, status,
        progress, estimated_credits as "estimatedCredits", result_url as "resultUrl",
        outputs, error, created_at as "createdAt", updated_at as "updatedAt"
      from generation_tasks
      order by created_at desc, id
    `,
  )
  const ledger = await rows<LedgerRow>(
    client,
    `
      select id, user_id as "userId", tenant_id as "tenantId", amount, balance,
        type, description, created_at as "createdAt"
      from ledger_entries
      order by created_at desc, id
    `,
  )
  const media = await rows<MediaRow>(
    client,
    `
      select id, project_id as "projectId", tenant_id as "tenantId", kind, name,
        content_type as "contentType", size, storage_key as "storageKey",
        created_at as "createdAt"
      from media
      order by created_at desc, id
    `,
  )

  return normalizeState({
    users: users.map((user) => ({ ...user, email: user.email.toLowerCase() })),
    projects: projects.map((project) => ({
      ...project,
      createdAt: iso(project.createdAt),
      updatedAt: iso(project.updatedAt),
    })),
    assets: assets.map((asset) => ({
      ...asset,
      references: array<Asset['references'][number]>(asset.references),
      attributes: record(asset.attributes) as Asset['attributes'],
      createdAt: iso(asset.createdAt),
      updatedAt: iso(asset.updatedAt),
    })),
    shots: shots.map((shot) => ({
      ...shot,
      createdAt: iso(shot.createdAt),
      updatedAt: iso(shot.updatedAt),
    })),
    tasks: tasks.map((task) => ({
      ...task,
      metadata: record(task.metadata),
      outputs: array<GenerationTask['outputs'][number]>(task.outputs),
      createdAt: iso(task.createdAt),
      updatedAt: iso(task.updatedAt),
    })),
    ledger: ledger.map((entry) => ({ ...entry, createdAt: iso(entry.createdAt) })),
    media: media.map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
  })
}

async function rows<T extends QueryResultRow>(client: PoolClient, sql: string): Promise<T[]> {
  const result = await client.query<T>(sql)
  return result.rows
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
