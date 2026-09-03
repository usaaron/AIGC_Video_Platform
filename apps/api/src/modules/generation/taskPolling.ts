import type { GenerationTask, GenerationTaskPolling, Principal } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import type { AppState, AppStore } from '../../infra/store.js'
import type { AccountDatabase } from '../../infra/postgres.js'

type GenerationTaskPollingRow = QueryResultRow & {
  id: string
  client_request_id: string
  project_id: string
  kind: GenerationTask['kind']
  label: string
  provider: string
  model: string | null
  metadata: unknown
  status: GenerationTask['status']
  progress: number | string
  estimated_credits: number | string
  result_url: string | null
  error: string | null
  created_at: Date | string
  updated_at: Date | string
}

type GenerationTaskPollingVersionRow = QueryResultRow & {
  task_count: number | string
  latest_updated_at: Date | string
  signature: string
}

type Queryable = Pick<AccountDatabase, 'query'>

const generationTaskPollingColumns = `
  id,
  client_request_id,
  project_id,
  kind,
  label,
  provider,
  model,
  metadata,
  status,
  progress,
  estimated_credits,
  result_url,
  error,
  created_at,
  updated_at
`

const POLLING_METADATA_KEYS = [
  'assetId',
  'assetKind',
  'batchIndex',
  'batchSize',
  'compositionStage',
  'continuityMode',
  'continuitySourceTaskId',
  'duration',
  'episodeId',
  'episodeNumber',
  'generationStage',
  'image2BatchId',
  'localTaskStartedAt',
  'mode',
  'previewMode',
  'providerState',
  'referenceAssetIds',
  'resolution',
  'revisionNote',
  'scriptOperation',
  'sourceScriptFingerprint',
  'textPreview',
  'textPreviewStage',
  'textPreviewValidation',
  'textTiming',
  'turnaround',
] as const

export async function listPollingTasks(
  database: Queryable,
  projectId: string,
  principal: Principal,
): Promise<GenerationTaskPolling[]> {
  const canReadAll = canReadAllTenantContent(principal)
  const result = await database.query<GenerationTaskPollingRow>(
    `
    SELECT ${generationTaskPollingColumns}
    FROM generation_tasks
    WHERE project_id = $1
      AND tenant_id = $2
      AND ($3::boolean OR user_id = $4)
      AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
    ORDER BY created_at DESC, id DESC
    `,
    [projectId, principal.tenantId, canReadAll, principal.userId],
  )
  return result.rows.map(taskPollingFromRow)
}

export async function readPollingVersion(
  database: Queryable,
  projectId: string,
  principal: Principal,
): Promise<string> {
  const canReadAll = canReadAllTenantContent(principal)
  const result = await database.query<GenerationTaskPollingVersionRow>(
    `
    SELECT
      count(*)::integer AS task_count,
      COALESCE(max(updated_at), 'epoch'::timestamptz) AS latest_updated_at,
      COALESCE(
        sum(hashtextextended(id || ':' || updated_at::text || ':' || status || ':' || progress::text, 0)),
        0
      )::text AS signature
    FROM generation_tasks
    WHERE project_id = $1
      AND tenant_id = $2
      AND ($3::boolean OR user_id = $4)
      AND jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'
    `,
    [projectId, principal.tenantId, canReadAll, principal.userId],
  )
  const row = result.rows[0]
  return [
    Number(row?.task_count || 0),
    row?.latest_updated_at ? isoString(row.latest_updated_at) : '1970-01-01T00:00:00.000Z',
    row?.signature || '0',
  ].join(':')
}

export function listPollingTasksFromStore(
  store: AppStore,
  projectId: string,
  principal: Principal,
): GenerationTaskPolling[] {
  const canReadAll = canReadAllTenantContent(principal)
  return store
    .read((state) => filterVisibleTasks(state, projectId, principal, canReadAll))
    .map(taskPollingFromTask)
}

export function readPollingVersionFromStore(
  store: AppStore,
  projectId: string,
  principal: Principal,
): string {
  const canReadAll = canReadAllTenantContent(principal)
  const tasks = store.read((state) => filterVisibleTasks(state, projectId, principal, canReadAll))
  return pollingVersionFromTasks(tasks)
}

function filterVisibleTasks(
  state: AppState,
  projectId: string,
  principal: Principal,
  canReadAll: boolean,
): GenerationTask[] {
  return state.tasks.filter(
    (task) =>
      task.projectId === projectId &&
      task.tenantId === principal.tenantId &&
      (canReadAll || task.userId === principal.userId) &&
      typeof task.metadata.queueHiddenAt !== 'string',
  )
}

function taskPollingFromRow(row: GenerationTaskPollingRow): GenerationTaskPolling {
  return {
    id: row.id,
    clientRequestId: row.client_request_id,
    projectId: row.project_id,
    kind: row.kind,
    label: row.label,
    provider: row.provider,
    model: row.model,
    status: row.status,
    progress: Number(row.progress),
    estimatedCredits: Number(row.estimated_credits),
    metadata: compactTaskMetadata(row.metadata),
    resultUrl: row.result_url,
    error: row.error,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function taskPollingFromTask(task: GenerationTask): GenerationTaskPolling {
  return {
    id: task.id,
    clientRequestId: task.clientRequestId,
    projectId: task.projectId,
    kind: task.kind,
    label: task.label,
    provider: task.provider,
    model: task.model,
    status: task.status,
    progress: task.progress,
    estimatedCredits: task.estimatedCredits,
    metadata: compactTaskMetadata(task.metadata),
    resultUrl: task.resultUrl,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function compactTaskMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const metadata = value as Record<string, unknown>
  const compact: Record<string, unknown> = {}
  for (const key of POLLING_METADATA_KEYS) {
    if (metadata[key] !== undefined) compact[key] = compactPollingMetadataValue(key, metadata[key])
  }
  return compact
}

function compactPollingMetadataValue(key: (typeof POLLING_METADATA_KEYS)[number], value: unknown): unknown {
  if (key !== 'textPreview' || typeof value !== 'string') return value
  return value.length > 12_000 ? `${value.slice(0, 12_000)}\n\n[预览已截断]` : value
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function pollingVersionFromTasks(tasks: GenerationTask[]): string {
  const latestUpdatedAt = tasks.reduce(
    (latest, task) => (task.updatedAt > latest ? task.updatedAt : latest),
    '1970-01-01T00:00:00.000Z',
  )
  const signature = tasks
    .map((task) => `${task.id}:${task.updatedAt}:${task.status}:${task.progress}`)
    .sort()
    .join('|')
  return [tasks.length, latestUpdatedAt, hashString(signature)].join(':')
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
