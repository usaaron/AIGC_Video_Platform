import {
  AGENT_CREDIT_COSTS,
  type Asset,
  type FaceConfirmationRequest,
  type FaceConfirmationResponse,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { createHash } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { ProjectRepository } from '../projects/repository.js'
import type { GenerationTaskRepository } from '../generation/repository.js'
import type { GenerationService } from '../generation/service.js'
import type { TrustedAssetService } from './service.js'

/** Confirmation is durable even if registration configuration, billing or dispatch fails. */
export class FaceConfirmationService {
  constructor(
    private readonly projects: Pick<ProjectRepository, 'confirmFace'>,
    private readonly tasks: Pick<GenerationTaskRepository, 'findByClientRequestId' | 'listByProject'>,
    private readonly generation: Pick<GenerationService, 'createTask'>,
    private readonly trusted: Pick<TrustedAssetService, 'validateFaceReference'>,
  ) {}

  async confirm(
    projectId: string,
    assetId: string,
    input: FaceConfirmationRequest,
    principal: Principal,
    traceId?: string,
  ): Promise<FaceConfirmationResponse> {
    // Provider configuration is deliberately not part of saving a valid face.
    const source = await this.trusted.validateFaceReference(
      projectId,
      assetId,
      input.faceReference,
      principal,
    )
    const asset = await this.projects.confirmFace(projectId, assetId, source.faceReference, principal)
    if (!asset) throw new AppError(404, 'CHARACTER_ASSET_NOT_FOUND', '人物资产不存在或无权操作')
    const result: FaceConfirmationResponse = { asset, registrationTask: null, registrationError: null }
    if (
      asset.attributes.type !== 'character' ||
      asset.sourceMode !== 'generate' ||
      asset.attributes.subjectType !== 'human' ||
      asset.attributes.portraitSource !== 'ai-virtual' ||
      asset.attributes.trustedPortrait?.groupType === 'LivenessFace' ||
      !source.generated
    )
      return result

    const clientRequestId = automaticFaceRegistrationId(asset, source.faceReference)
    try {
      const portrait = asset.attributes.trustedPortrait
      if (
        (!portrait?.faceReferenceId || portrait.faceReferenceId === source.faceReference.id) &&
        (portrait?.status === 'active' || portrait?.status === 'processing')
      )
        return result
      const previous = await this.tasks.findByClientRequestId(clientRequestId, principal)
      // Reuse a manual registration for this exact face, including a prior failure.
      const faceTasks = (await this.tasks.listByProject(projectId, principal))
        .filter(
          (task) =>
            task.provider === 'asset-library' &&
            task.metadata.trustedAssetOperation === 'register-virtual' &&
            task.metadata.assetId === assetId &&
            task.metadata.faceReferenceId === source.faceReference.id,
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      const active = faceTasks.find((task) => ['queued', 'paused', 'running'].includes(task.status))
      if (active) return { ...result, registrationTask: active, registrationError: null }
      if (previous)
        return {
          ...result,
          registrationTask: previous,
          registrationError: registrationFailure(previous, asset),
        }
      if (faceTasks[0])
        return {
          ...result,
          registrationTask: faceTasks[0],
          registrationError: registrationFailure(faceTasks[0], asset),
        }
      if (portrait?.status === 'failed')
        return { ...result, registrationError: portrait.errorMessage || '人像资源入库失败，请手动重试' }
      const task = await this.generation.createTask(
        {
          clientRequestId,
          projectId,
          kind: 'text',
          label: `${asset.name} · 创建 AI 人像资源`,
          provider: 'asset-library',
          estimatedCredits: AGENT_CREDIT_COSTS.trustedPortrait,
          metadata: {
            assetId,
            generationStage: 'trusted-portrait',
            trustedAssetOperation: 'register-virtual',
            faceReferenceId: source.faceReference.id,
            automaticFaceConfirmation: true,
          },
        },
        principal,
        traceId,
      )
      return { ...result, registrationTask: task, registrationError: registrationFailure(task, asset) }
    } catch (error) {
      // A dispatcher can fail after the task + debit + outbox transaction commits.
      const task = await this.tasks.findByClientRequestId(clientRequestId, principal).catch(() => null)
      return {
        ...result,
        registrationTask: task,
        registrationError:
          error instanceof AppError
            ? error.message
            : '面部已保存，人像入库暂未完成，请稍后重试或查看任务状态',
      }
    }
  }
}

export function automaticFaceRegistrationId(
  asset: Pick<Asset, 'tenantId' | 'projectId' | 'id'>,
  face: FaceConfirmationRequest['faceReference'],
): string {
  return `face-confirmation-${createHash('sha256')
    .update(JSON.stringify([asset.tenantId, asset.projectId, asset.id, face.id, face.url]))
    .digest('hex')}`
}

function registrationFailure(task: GenerationTask, asset: Asset): string | null {
  if (task.status === 'failed' || task.status === 'cancelled')
    return task.error || '人像入库未完成，请手动重试'
  if (asset.attributes.type === 'character' && asset.attributes.trustedPortrait?.status === 'failed') {
    return asset.attributes.trustedPortrait.errorMessage || '人像资源审核失败，请手动重试'
  }
  if (
    task.status === 'completed' &&
    asset.attributes.type === 'character' &&
    !asset.attributes.trustedPortrait
  ) {
    return '该面部曾提交入库，但当前未绑定可用资源，请手动重试'
  }
  return null
}
