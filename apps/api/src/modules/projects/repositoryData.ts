import type { Asset, GenerationTask, Project, ScriptEpisode, Shot } from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import type { AppState } from '../../infra/store.js'

export type ProjectRow = QueryResultRow & {
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

export type AssetRow = QueryResultRow & {
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

export type ShotRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  script_episode_id: string | null
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

export type ScriptEpisodeRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  episode_number: number | string
  title: string
  content: string
  draft_content: string
  status: ScriptEpisode['status']
  summary: string
  continuity_state: unknown
  revision: number | string
  last_edited_by: string
  created_at: Date | string
  updated_at: Date | string
}

export type ProjectTaskPreviewRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  kind: GenerationTask['kind']
  label: string
  status: GenerationTask['status']
  progress: number | string
  metadata: unknown
  outputs: unknown
  updated_at: Date | string
}

export type ProjectListAssetRow = QueryResultRow & {
  project_id: string
  kind: Asset['kind']
  reference_items: unknown
  attributes: unknown
  image_url: string | null
  updated_at: Date | string
}

export type ProjectListShotRow = QueryResultRow & {
  project_id: string
  shot_order: number | string
  image_url: string | null
}

export const projectColumns = `
  id,
  tenant_id,
  owner_user_id,
  name,
  content_type,
  visual_style,
  episode_duration_seconds,
  aspect_ratio,
  status,
  synopsis,
  script,
  version,
  created_at,
  updated_at
`

// Project cards do not need the potentially very large script body.
export const projectListColumns = `
  id,
  tenant_id,
  owner_user_id,
  name,
  content_type,
  visual_style,
  episode_duration_seconds,
  aspect_ratio,
  status,
  synopsis,
  ''::text AS script,
  version,
  created_at,
  updated_at
`

export const assetColumns = `
  id,
  project_id,
  tenant_id,
  kind,
  source_mode,
  name,
  description,
  prompt,
  prompt_mode,
  custom_prompt_mode,
  custom_prompt,
  negative_prompt,
  reference_items,
  attributes,
  image_url,
  status,
  created_at,
  updated_at
`

export const shotColumns = `
  id,
  project_id,
  tenant_id,
  script_episode_id,
  shot_order,
  title,
  framing,
  duration_seconds,
  prompt,
  negative_prompt,
  image_url,
  selected_image_task_id,
  selected_video_task_id,
  continuity_mode,
  continuity_note,
  episode_break_before,
  episode_number,
  episode_title,
  episode_kind,
  created_at,
  updated_at
`

export const scriptEpisodeColumns = `
  id,
  project_id,
  tenant_id,
  episode_number,
  title,
  content,
  draft_content,
  status,
  summary,
  continuity_state,
  revision,
  last_edited_by,
  created_at,
  updated_at
`

export function projectFromRow(row: ProjectRow): Project {
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

export function scriptEpisodeFromRow(row: ScriptEpisodeRow): ScriptEpisode {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    episodeNumber: Number(row.episode_number),
    title: row.title,
    content: row.content,
    draftContent: row.draft_content,
    status: row.status,
    summary: row.summary,
    continuityState: jsonValue(row.continuity_state, {}),
    revision: Number(row.revision),
    lastEditedBy: row.last_edited_by,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function assetFromRow(row: AssetRow): Asset {
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

export function shotFromRow(row: ShotRow): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    scriptEpisodeId: row.script_episode_id,
    order: Number(row.shot_order),
    title: row.title,
    framing: row.framing,
    duration: Number(row.duration_seconds),
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    imageUrl: row.image_url,
    selectedImageTaskId: row.selected_image_task_id,
    selectedVideoTaskId: row.selected_video_task_id,
    continuityMode: row.continuity_mode,
    continuityNote: row.continuity_note,
    episodeBreakBefore: row.episode_break_before,
    episodeNumber: Number(row.episode_number),
    episodeTitle: row.episode_title,
    episodeKind: row.episode_kind,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function projectPreviewTaskFromRow(row: ProjectTaskPreviewRow): GenerationTask {
  return {
    id: row.id,
    clientRequestId: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    userId: '',
    kind: row.kind,
    label: row.label,
    prompt: '',
    negativePrompt: '',
    provider: '',
    model: null,
    tier: null,
    metadata: jsonValue(row.metadata, {}),
    status: row.status,
    progress: Number(row.progress),
    estimatedCredits: 0,
    createdAt: isoString(row.updated_at),
    updatedAt: isoString(row.updated_at),
    resultUrl: null,
    outputs: jsonValue(row.outputs, []),
    error: null,
  }
}

export function upsertProject(state: AppState, project: Project): void {
  const index = state.projects.findIndex(
    (item) => item.id === project.id && item.tenantId === project.tenantId,
  )
  if (index >= 0) state.projects[index] = project
  else state.projects.push(project)
}

export function upsertAsset(state: AppState, asset: Asset): void {
  const index = state.assets.findIndex(
    (item) => item.id === asset.id && item.projectId === asset.projectId && item.tenantId === asset.tenantId,
  )
  if (index >= 0) state.assets[index] = asset
  else state.assets.push(asset)
}

export function upsertShot(state: AppState, shot: Shot): void {
  const index = state.shots.findIndex(
    (item) => item.id === shot.id && item.projectId === shot.projectId && item.tenantId === shot.tenantId,
  )
  if (index >= 0) state.shots[index] = shot
  else state.shots.push(shot)
}

export function jsonValue<T>(value: unknown, fallback: T): T {
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

export function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
