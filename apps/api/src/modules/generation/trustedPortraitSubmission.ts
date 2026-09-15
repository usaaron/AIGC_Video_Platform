import {
  AGENT_CREDIT_COSTS,
  type Asset,
  type CreateGenerationTask,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import type { PoolClient } from 'pg'
import type { AppState } from '../../infra/store.js'
import { AppError } from '../../core/errors.js'
import { assetColumns, assetFromRow, type AssetRow } from '../projects/repositoryData.js'
import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from './repositoryData.js'

export function isVirtualRegistration(input: CreateGenerationTask): boolean {
  return input.provider === 'asset-library' && input.metadata?.trustedAssetOperation === 'register-virtual'
}

/** The asset row lock serializes manual and automatic submissions with face changes and writeback. */
export async function preparePortraitSubmission(
  client: PoolClient,
  input: CreateGenerationTask,
  principal: Principal,
) {
  if (!isVirtualRegistration(input)) return { input, existing: null }
  const assets = await client.query<AssetRow>(
    `SELECT ${assetColumns} FROM assets WHERE id=$1 AND project_id=$2 AND tenant_id=$3 FOR UPDATE`,
    [input.metadata?.assetId, input.projectId, principal.tenantId],
  )
  const asset = assets.rows[0] ? assetFromRow(assets.rows[0]) : null
  const normalized = normalizeSubmission(input, asset)
  const tasks = await client.query<GenerationTaskRow>(
    `SELECT ${generationTaskColumns} FROM generation_tasks
     WHERE tenant_id=$1 AND project_id=$2 AND provider='asset-library'
       AND metadata->>'assetId'=$3 AND metadata->>'trustedAssetOperation'='register-virtual'
       AND metadata->>'faceReferenceId'=$4 ORDER BY created_at DESC, id DESC`,
    [principal.tenantId, input.projectId, asset!.id, normalized.metadata!.faceReferenceId],
  )
  return { input: normalized, existing: reusableSubmission(normalized, asset!, tasks.rows.map(taskFromRow)) }
}

export function preparePortraitSubmissionInState(
  state: AppState,
  input: CreateGenerationTask,
  principal: Principal,
) {
  if (!isVirtualRegistration(input)) return { input, existing: null }
  const asset =
    state.assets.find(
      (item) =>
        item.id === input.metadata?.assetId &&
        item.projectId === input.projectId &&
        item.tenantId === principal.tenantId,
    ) ?? null
  const normalized = normalizeSubmission(input, asset)
  const tasks = state.tasks
    .filter(
      (task) =>
        task.tenantId === principal.tenantId &&
        task.projectId === input.projectId &&
        task.provider === 'asset-library' &&
        task.metadata.trustedAssetOperation === 'register-virtual' &&
        task.metadata.assetId === asset!.id &&
        task.metadata.faceReferenceId === normalized.metadata!.faceReferenceId,
    )
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id),
    )
  return { input: normalized, existing: reusableSubmission(normalized, asset!, tasks) }
}

function normalizeSubmission(input: CreateGenerationTask, asset: Asset | null): CreateGenerationTask {
  if (!asset || asset.attributes.type !== 'character') {
    throw new AppError(404, 'CHARACTER_ASSET_NOT_FOUND', '人物资产不存在或无权操作')
  }
  const attributes = asset.attributes
  if (
    attributes.subjectType !== 'human' ||
    attributes.portraitSource !== 'ai-virtual' ||
    attributes.trustedPortrait?.groupType === 'LivenessFace'
  ) {
    throw new AppError(409, 'VIRTUAL_HUMAN_REQUIRED', '仅 AI 人物可以创建 AI 人像资源')
  }
  const face = attributes.faceReference
  if (
    attributes.faceStatus !== 'approved' ||
    !face ||
    (input.metadata?.faceReferenceId && input.metadata.faceReferenceId !== face.id)
  ) {
    throw new AppError(409, 'FACE_CONFIRMATION_CHANGED', '请重新确认当前人物面部后再创建资源')
  }
  if (
    input.metadata?.automaticFaceConfirmation === true &&
    (asset.sourceMode !== 'generate' || !face.url.startsWith('/api/v1/generation/tasks/'))
  ) {
    throw new AppError(409, 'GENERATED_FACE_REQUIRED', '自动入库仅适用于已确认的 AI 生成人物面部')
  }
  return {
    ...input,
    estimatedCredits: AGENT_CREDIT_COSTS.trustedPortrait,
    metadata: { ...input.metadata, generationStage: 'trusted-portrait', faceReferenceId: face.id },
  }
}

function reusableSubmission(
  input: CreateGenerationTask,
  asset: Asset,
  tasks: GenerationTask[],
): GenerationTask | null {
  const active = tasks.find((task) => ['queued', 'paused', 'running'].includes(task.status))
  if (active) return active
  const portrait = asset.attributes.type === 'character' ? asset.attributes.trustedPortrait : null
  if (
    portrait &&
    (!portrait.faceReferenceId || portrait.faceReferenceId === input.metadata?.faceReferenceId) &&
    ['active', 'processing'].includes(portrait.status)
  ) {
    const completed = tasks.find((task) => task.status === 'completed')
    if (completed) return completed
    throw new AppError(409, 'PORTRAIT_ALREADY_REGISTERED', '当前面部已入库或正在审核，无需重复提交')
  }
  // Automatic confirmation never starts a second paid attempt; explicit manual submission may retry.
  if (input.metadata?.automaticFaceConfirmation === true) {
    if (tasks[0]) return tasks[0]
    if (portrait?.status === 'failed') {
      throw new AppError(
        409,
        'PORTRAIT_REGISTRATION_FAILED',
        portrait.errorMessage || '人像入库失败，请手动重试',
      )
    }
  }
  return null
}
