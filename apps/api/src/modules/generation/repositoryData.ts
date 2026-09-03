import type { Asset, GenerationTask, Project, Shot } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import { normalizeGenerationTaskLifecycle } from '../../core/jobs/taskLease.js'
import type { AppState } from '../../infra/store.js'

export type GenerationTaskRow = QueryResultRow & {
  id: string
  client_request_id: string
  project_id: string
  tenant_id: string
  user_id: string
  kind: GenerationTask['kind']
  label: string
  prompt: string
  negative_prompt: string
  provider: string
  model: string | null
  tier: GenerationTask['tier'] | null
  metadata: unknown
  status: GenerationTask['status']
  progress: number | string
  estimated_credits: number | string
  attempts: number | string
  max_attempts: number | string | null
  lease_owner_id: string | null
  lease_token: string | null
  lease_acquired_at: Date | string | null
  lease_heartbeat_at: Date | string | null
  lease_expires_at: Date | string | null
  result_url: string | null
  outputs: unknown
  error: string | null
  created_at: Date | string
  updated_at: Date | string
}

export type GenerationProjectRow = QueryResultRow & {
  id: string
  tenant_id: string
  owner_user_id: string
  name: string
  content_type: Project['contentType']
  visual_style: NonNullable<Project['visualStyle']>
  episode_duration_seconds: number | string
  aspect_ratio: Project['aspectRatio']
  status: Project['status']
  synopsis: string
  script: string
  version: number | string
  created_at: Date | string
  updated_at: Date | string
}

export type GenerationShotRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  shot_order: number | string
  title: string
  framing: string
  duration_seconds: number | string
  prompt: string
  negative_prompt: string
  image_url: string | null
  selected_image_task_id: string | null
  selected_video_task_id: string | null
  continuity_mode: Shot['continuityMode']
  continuity_note: string
  episode_break_before: boolean
  episode_number: number | string
  episode_title: string
  episode_kind: Shot['episodeKind']
  created_at: Date | string
  updated_at: Date | string
}

export type GenerationAssetRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  kind: Asset['kind']
  source_mode: Asset['sourceMode']
  name: string
  description: string
  prompt: string
  prompt_mode: Asset['promptMode']
  custom_prompt_mode: Asset['customPromptMode']
  custom_prompt: string
  negative_prompt: string
  reference_items: unknown
  attributes: unknown
  image_url: string | null
  status: Asset['status']
  created_at: Date | string
  updated_at: Date | string
}

export const generationTaskColumns = `
  id,
  client_request_id,
  project_id,
  tenant_id,
  user_id,
  kind,
  label,
  prompt,
  negative_prompt,
  provider,
  model,
  tier,
  metadata,
  status,
  progress,
  estimated_credits,
  attempts,
  max_attempts,
  lease_owner_id,
  lease_token,
  lease_acquired_at,
  lease_heartbeat_at,
  lease_expires_at,
  result_url,
  outputs,
  error,
  created_at,
  updated_at
`

export function taskFromRow(row: GenerationTaskRow): GenerationTask {
  return normalizeGenerationTaskLifecycle({
    id: row.id,
    clientRequestId: row.client_request_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    kind: row.kind,
    label: row.label,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    provider: row.provider,
    model: row.model,
    tier: row.tier ?? null,
    metadata: jsonValue(row.metadata, {}),
    status: row.status,
    progress: Number(row.progress),
    estimatedCredits: Number(row.estimated_credits),
    attempts: Number(row.attempts),
    maxAttempts: row.max_attempts === null ? undefined : Number(row.max_attempts),
    leaseOwnerId: row.lease_owner_id,
    leaseToken: row.lease_token,
    leaseAcquiredAt: nullableIsoString(row.lease_acquired_at),
    leaseHeartbeatAt: nullableIsoString(row.lease_heartbeat_at),
    leaseExpiresAt: nullableIsoString(row.lease_expires_at),
    resultUrl: row.result_url,
    outputs: jsonValue(row.outputs, []),
    error: row.error,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  })
}

export function upsertTaskInState(state: AppState, task: GenerationTask): void {
  const index = state.tasks.findIndex((item) => item.id === task.id)
  if (index >= 0) {
    if (Date.parse(state.tasks[index]!.updatedAt) > Date.parse(task.updatedAt)) return
    state.tasks[index] = task
  } else {
    state.tasks.unshift(task)
  }
}

export function projectFromRow(row: GenerationProjectRow): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerId: row.owner_user_id,
    name: row.name,
    contentType: row.content_type,
    visualStyle: row.visual_style,
    episodeDurationSeconds: Number(row.episode_duration_seconds),
    aspectRatio: row.aspect_ratio,
    status: row.status,
    synopsis: row.synopsis,
    script: row.script,
    version: Number(row.version),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function shotFromRow(row: GenerationShotRow): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    scriptEpisodeId: null,
    order: Number(row.shot_order),
    title: row.title,
    framing: row.framing,
    duration: Number(row.duration_seconds),
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    imageUrl: row.image_url,
    selectedImageTaskId: row.selected_image_task_id,
    continuityMode: row.continuity_mode,
    continuityNote: row.continuity_note,
    episodeBreakBefore: row.episode_break_before,
    episodeNumber: Number(row.episode_number),
    episodeTitle: row.episode_title,
    episodeKind: row.episode_kind,
    selectedVideoTaskId: row.selected_video_task_id,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function assetFromRow(row: GenerationAssetRow): Asset {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    kind: row.kind,
    sourceMode: row.source_mode,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    promptMode: row.prompt_mode,
    customPromptMode: row.custom_prompt_mode,
    customPrompt: row.custom_prompt,
    negativePrompt: row.negative_prompt,
    references: jsonValue(row.reference_items, []),
    attributes: jsonValue(row.attributes, { type: row.kind }) as Asset['attributes'],
    imageUrl: row.image_url,
    status: row.status,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return structuredClone(value) as T
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : isoString(value)
}
