import {
  IMAGE2_CREDITS_PER_IMAGE,
  IMAGE2_MODEL_ID,
  IMAGE2_PROVIDER_DISPLAY_NAME,
  type CreateGenerationTask,
  type CreateImage2Batch,
  type Image2ReferenceRole,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { traceContext, traceIdFromGenerationTask } from '../../core/observability/trace.js'
import type { GenerationTaskRepository } from '../generation/repository.js'
import type { MediaObjectSource, MediaRepository } from '../media/repository.js'
import type { Image2AssistReference, Image2AssistResult, Image2AssistService } from './assist.js'

export type Image2BatchResult = {
  batchId: string
  providerName: typeof IMAGE2_PROVIDER_DISPLAY_NAME
  model: typeof IMAGE2_MODEL_ID
  creditsPerImage: typeof IMAGE2_CREDITS_PER_IMAGE
  estimatedCredits: number
  tasks: GenerationTask[]
}

export class Image2BatchService {
  constructor(
    private readonly generationTasks: GenerationTaskRepository,
    private readonly mediaRepository: MediaRepository,
    private readonly dispatcher: TaskDispatcher,
    private readonly imageProviderAvailable: boolean,
    private readonly assistService: Image2AssistService,
  ) {}

  async createBatch(
    input: CreateImage2Batch,
    principal: Principal,
    traceId?: string | null,
  ): Promise<Image2BatchResult> {
    if (!this.imageProviderAvailable) {
      throw new AppError(503, 'IMAGE2_PROVIDER_NOT_CONFIGURED', '序幕 image2 服务尚未配置')
    }
    if (!(await this.generationTasks.canCreate(input.projectId, principal))) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权生成')
    }
    const requestKey = input.clientRequestId || randomUUID()
    const batchId = `image2-${requestKey}`
    const sourceTaskId = input.sourceTaskId?.trim() || ''
    const strictRedo = sourceTaskId
      ? await this.loadStrictRedoSource(sourceTaskId, principal, input.projectId)
      : null
    const assistReferences = strictRedo ? [] : await this.buildAssistReferences(input, principal)
    const assist = strictRedo
      ? null
      : await this.assistService.prepare({
          assist: input.assist,
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          quality: input.quality,
          imageModel: IMAGE2_MODEL_ID,
          references: assistReferences,
        })
    const references = strictRedo ? strictRedo.references : metadataReferences(assist!)
    const generationSnapshot = strictRedo
      ? createStrictRedoGenerationSnapshot(strictRedo, sourceTaskId)
      : createGenerationSnapshot({
          input,
          assist: assist!,
          references,
        })
    const tasks = await this.generationTasks.createBatchWithCharge(
      Array.from({ length: strictRedo ? 1 : input.imageCount }, (_, index): CreateGenerationTask => ({
        clientRequestId: `${batchId}-${index + 1}`,
        projectId: input.projectId,
        kind: 'image',
        label:
          (strictRedo ? 1 : input.imageCount) === 1
            ? `${IMAGE2_PROVIDER_DISPLAY_NAME} · 图片生成`
            : `${IMAGE2_PROVIDER_DISPLAY_NAME} · 图片 ${index + 1}/${strictRedo ? 1 : input.imageCount}`,
        prompt: strictRedo ? strictRedo.prompt : assist!.prompt,
        negativePrompt: strictRedo ? strictRedo.negativePrompt : input.negativePrompt || '',
        provider: 'img2',
        model: IMAGE2_MODEL_ID,
        estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
        metadata: {
          generationStage: 'image2-studio',
          providerDisplayName: IMAGE2_PROVIDER_DISPLAY_NAME,
          image2BatchId: batchId,
          batchIndex: index + 1,
          batchSize: strictRedo ? 1 : input.imageCount,
          aspectRatio: strictRedo ? strictRedo.aspectRatio : input.aspectRatio,
          quality: strictRedo ? strictRedo.quality : input.quality,
          originalPrompt: strictRedo ? strictRedo.originalPrompt : input.prompt,
          ...(strictRedo
            ? {
                sourceTaskId: strictRedo.sourceTaskId,
                userNegativePrompt: strictRedo.userNegativePrompt,
              }
            : {}),
          promptOptimization: strictRedo ? strictRedo.promptOptimization : assist!.promptOptimization,
          referenceVision: strictRedo ? strictRedo.referenceVision : assist!.referenceVision,
          references,
          generationSnapshot,
        },
      })),
      principal,
      traceContext(traceId),
    )

    await Promise.all(
      tasks.map((task) =>
        this.dispatcher.dispatch(task, { traceId: traceId ?? traceIdFromGenerationTask(task) }),
      ),
    )

    return {
      batchId,
      providerName: IMAGE2_PROVIDER_DISPLAY_NAME,
      model: IMAGE2_MODEL_ID,
      creditsPerImage: IMAGE2_CREDITS_PER_IMAGE,
      estimatedCredits: (strictRedo ? 1 : input.imageCount) * IMAGE2_CREDITS_PER_IMAGE,
      tasks,
    }
  }

  private async assertReferences(
    input: CreateImage2Batch,
    principal: Principal,
  ): Promise<Map<string, MediaObjectSource>> {
    const sources = new Map<string, MediaObjectSource>()
    for (const reference of input.references) {
      const source = await this.mediaRepository.findSourceById(
        reference.mediaId,
        input.projectId,
        principal.tenantId,
        'image',
      )
      if (!source) {
        throw new AppError(404, 'REFERENCE_MEDIA_NOT_FOUND', '引用图不存在或不属于当前项目')
      }
      sources.set(reference.mediaId, source)
    }
    return sources
  }

  private async buildAssistReferences(
    input: CreateImage2Batch,
    principal: Principal,
  ): Promise<Image2AssistReference[]> {
    const sourceByMediaId = await this.assertReferences(input, principal)
    return input.references.map((reference): Image2AssistReference => ({
      id: reference.mediaId,
      name: `image-${reference.referenceNumber}-${referenceRoleSlug(reference.role)}.jpg`,
      role: reference.role,
      referenceNumber: reference.referenceNumber,
      source: sourceByMediaId.get(reference.mediaId)!,
    }))
  }

  private async loadStrictRedoSource(
    sourceTaskId: string,
    principal: Principal,
    projectId: string,
  ): Promise<StrictRedoSource | null> {
    const sourceTask = await this.generationTasks.findById(sourceTaskId, principal)
    if (!sourceTask) {
      throw new AppError(404, 'SOURCE_TASK_NOT_FOUND', '重做源任务不存在或无权访问')
    }
    if (sourceTask.projectId !== projectId) {
      throw new AppError(400, 'SOURCE_TASK_PROJECT_MISMATCH', '重做源任务必须属于当前项目')
    }
    if (sourceTask.kind !== 'image' || sourceTask.provider !== 'img2') {
      throw new AppError(400, 'SOURCE_TASK_NOT_REUSABLE', '只有序幕 image2 任务可以严格重做')
    }
    if (sourceTask.status !== 'completed') {
      throw new AppError(400, 'SOURCE_TASK_NOT_COMPLETED', '只有已完成的图片任务才有可复用快照')
    }
    const snapshot = generationSnapshotFromTask(sourceTask)
    if (!snapshot || snapshot.finalized !== true) {
      throw new AppError(400, 'SOURCE_TASK_SNAPSHOT_NOT_READY', '该任务没有可复用的完整快照')
    }
    const strict = normalizeStrictRedoSnapshot(sourceTask, snapshot)
    return strict
  }
}

function metadataReferences(assist: Image2AssistResult): Array<Record<string, unknown>> {
  return assist.references.map((reference, index) => ({
    id: reference.id,
    url: `/api/v1/media/${reference.id}`,
    name: reference.name,
    role: reference.role,
    referenceNumber: reference.referenceNumber,
    order: index + 1,
    ...(reference.visionDescription ? { visionDescription: reference.visionDescription } : {}),
    ...(reference.visionModel ? { visionModel: reference.visionModel } : {}),
  }))
}

type StrictRedoSource = {
  sourceTaskId: string
  prompt: string
  originalPrompt: string
  negativePrompt: string
  userNegativePrompt: string
  aspectRatio: string
  quality: 'low' | 'medium' | 'high'
  references: Array<Record<string, unknown>>
  promptOptimization: Record<string, unknown>
  referenceVision: Record<string, unknown>
  snapshot: Record<string, unknown>
}

function normalizeStrictRedoSnapshot(
  task: GenerationTask,
  snapshot: Record<string, unknown>,
): StrictRedoSource {
  const references = snapshotReferences(snapshot)
  const prompt = stringValue(snapshot['prompt'], '')
  const originalPrompt = stringValue(snapshot['originalPrompt'], prompt)
  const userNegativePrompt = stringValue(snapshot['userNegativePrompt'], stringValue(task.negativePrompt, ''))
  const aspectRatio = stringValue(snapshot['aspectRatio'], '')
  const quality = image2Quality(snapshot['quality'])
  const assistResults = objectValue(snapshot['assistResults'])
  const promptOptimization = objectValue(
    assistResults['promptOptimization'] ?? snapshot['promptOptimization'],
  )
  const referenceVision = objectValue(assistResults['referenceVision'] ?? snapshot['referenceVision'])

  if (!prompt || !aspectRatio || !quality || !references.length) {
    throw new AppError(400, 'SOURCE_TASK_SNAPSHOT_NOT_READY', '该任务没有可复用的完整快照')
  }

  const clonedSnapshot = structuredClone(snapshot) as Record<string, unknown>
  clonedSnapshot.finalized = false
  clonedSnapshot.sourceTaskId = task.id

  return {
    sourceTaskId: task.id,
    prompt,
    originalPrompt,
    negativePrompt: userNegativePrompt,
    userNegativePrompt,
    aspectRatio,
    quality,
    references,
    promptOptimization,
    referenceVision,
    snapshot: clonedSnapshot,
  }
}

function createStrictRedoGenerationSnapshot(
  source: StrictRedoSource,
  sourceTaskId: string,
): Record<string, unknown> {
  const assist = objectValue(source.snapshot['assist'])
  return {
    ...source.snapshot,
    sourceTaskId,
    finalized: false,
    prompt: source.prompt,
    originalPrompt: source.originalPrompt,
    negativePrompt: source.negativePrompt,
    userNegativePrompt: source.userNegativePrompt,
    aspectRatio: source.aspectRatio,
    quality: source.quality,
    references: source.references.map((reference) => ({ ...reference })),
    assist: {
      promptOptimization: assist['promptOptimization'] === true,
      referenceVision: assist['referenceVision'] === true,
    },
    assistResults: {
      promptOptimization: source.promptOptimization,
      referenceVision: source.referenceVision,
    },
  }
}

function generationSnapshotFromTask(task: GenerationTask): Record<string, unknown> | null {
  const snapshot = task.metadata.generationSnapshot
  return isRecord(snapshot) ? snapshot : null
}

function snapshotReferences(snapshot: Record<string, unknown>): Array<Record<string, unknown>> {
  const references = Array.isArray(snapshot.references) ? snapshot.references : []
  return references.filter(isRecord).map((reference) => structuredClone(reference) as Record<string, unknown>)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function image2Quality(value: unknown): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

function createGenerationSnapshot(input: {
  input: CreateImage2Batch
  assist: Image2AssistResult
  references: Array<Record<string, unknown>>
}): Record<string, unknown> {
  const userNegativePrompt = input.input.negativePrompt || ''
  return {
    version: 1,
    finalized: false,
    model: IMAGE2_MODEL_ID,
    prompt: input.assist.prompt,
    originalPrompt: input.input.prompt,
    negativePrompt: userNegativePrompt,
    userNegativePrompt,
    aspectRatio: input.input.aspectRatio,
    quality: input.input.quality,
    imageCount: input.input.imageCount,
    references: input.references.map((reference) => ({ ...reference })),
    assist: {
      promptOptimization: input.input.assist.promptOptimization,
      referenceVision: input.input.assist.referenceVision,
    },
    assistResults: {
      promptOptimization: input.assist.promptOptimization,
      referenceVision: input.assist.referenceVision,
    },
  }
}

function referenceRoleSlug(role: Image2ReferenceRole): string {
  return (
    {
      subject: 'subject',
      clothing: 'clothing',
      accessory: 'accessory',
      style: 'style',
      composition: 'composition',
      color: 'color',
    } satisfies Record<Image2ReferenceRole, string>
  )[role]
}
