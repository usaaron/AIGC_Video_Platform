import {
  IMAGE2_CREDITS_PER_IMAGE,
  IMAGE2_MODEL_ID,
  IMAGE2_PROVIDER_DISPLAY_NAME,
  type CreateGenerationTask,
  type CreateImage2Batch,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import { traceContext, traceIdFromGenerationTask } from '../../core/observability/trace.js'
import type { GenerationTaskRepository } from '../generation/repository.js'
import type { MediaRepository } from '../media/repository.js'

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
    await this.assertReferences(input, principal)

    const requestKey = input.clientRequestId || randomUUID()
    const batchId = `image2-${requestKey}`
    const references = input.referenceMediaIds.map((id, index) => ({
      id,
      url: `/api/v1/media/${id}`,
      name: `reference-${index + 1}.png`,
    }))
    const tasks = await this.generationTasks.createBatchWithCharge(
      Array.from({ length: input.imageCount }, (_, index): CreateGenerationTask => ({
        clientRequestId: `${batchId}-${index + 1}`,
        projectId: input.projectId,
        kind: 'image',
        label:
          input.imageCount === 1
            ? `${IMAGE2_PROVIDER_DISPLAY_NAME} · 图片生成`
            : `${IMAGE2_PROVIDER_DISPLAY_NAME} · 图片 ${index + 1}/${input.imageCount}`,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt || '',
        provider: 'img2',
        model: IMAGE2_MODEL_ID,
        estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
        metadata: {
          generationStage: 'image2-studio',
          providerDisplayName: IMAGE2_PROVIDER_DISPLAY_NAME,
          image2BatchId: batchId,
          batchIndex: index + 1,
          batchSize: input.imageCount,
          aspectRatio: input.aspectRatio,
          quality: input.quality,
          references,
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
      estimatedCredits: input.imageCount * IMAGE2_CREDITS_PER_IMAGE,
      tasks,
    }
  }

  private async assertReferences(input: CreateImage2Batch, principal: Principal): Promise<void> {
    for (const mediaId of input.referenceMediaIds) {
      const source = await this.mediaRepository.findSourceById(
        mediaId,
        input.projectId,
        principal.tenantId,
        'image',
      )
      if (!source) {
        throw new AppError(404, 'REFERENCE_MEDIA_NOT_FOUND', '引用图不存在或不属于当前项目')
      }
    }
  }
}
