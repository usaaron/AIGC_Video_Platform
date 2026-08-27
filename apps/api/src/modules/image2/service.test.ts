import { describe, expect, it, vi } from 'vitest'
import {
  IMAGE2_CREDITS_PER_IMAGE,
  IMAGE2_MODEL_ID,
  IMAGE2_PROVIDER_DISPLAY_NAME,
  type GenerationTask,
  type Principal,
} from '@seqora/contracts'
import { Image2BatchService } from './service.js'
import type { GenerationTaskRepository } from '../generation/repository.js'
import type { MediaRepository } from '../media/repository.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { Image2AssistService } from './assist.js'

describe('Image2BatchService', () => {
  it('reuses a completed source task snapshot without running assist again', async () => {
    const principal: Principal = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['member'],
    }
    const sourceTask = makeSourceTask()
    const generationTasks = {
      canCreate: vi.fn(async () => true),
      findById: vi.fn(async (taskId: string) => (taskId === sourceTask.id ? sourceTask : null)),
      createBatchWithCharge: vi.fn(async (inputs: Array<Record<string, unknown>>) =>
        inputs.map((input, index) => makeQueuedTask(input, index, principal)),
      ),
    } as unknown as GenerationTaskRepository
    const mediaRepository = {
      findSourceById: vi.fn(),
    } as unknown as MediaRepository
    const dispatcher = {
      dispatch: vi.fn(async () => undefined),
    } as unknown as TaskDispatcher
    const assistService = {
      prepare: vi.fn(async () => {
        throw new Error('assist should not run for strict redo')
      }),
    } as unknown as Image2AssistService
    const service = new Image2BatchService(generationTasks, mediaRepository, dispatcher, true, assistService)

    const result = await service.createBatch(
      {
        clientRequestId: 'redo-1',
        sourceTaskId: sourceTask.id,
        projectId: 'project-1',
        prompt: '浏览器伪造提示词',
        negativePrompt: 'browser-negative',
        aspectRatio: '1:1',
        quality: 'low',
        imageCount: 4,
        assist: {
          promptOptimization: true,
          referenceVision: true,
        },
        references: [
          {
            mediaId: 'ref-subject',
            role: 'subject',
            referenceNumber: 1,
          },
        ],
      },
      principal,
      'trace-1',
    )

    expect(generationTasks.canCreate).toHaveBeenCalledWith('project-1', principal)
    expect(generationTasks.findById).toHaveBeenCalledWith(sourceTask.id, principal)
    expect(assistService.prepare).not.toHaveBeenCalled()
    expect(mediaRepository.findSourceById).not.toHaveBeenCalled()
    expect(generationTasks.createBatchWithCharge).toHaveBeenCalledTimes(1)
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      batchId: 'image2-redo-1',
      providerName: IMAGE2_PROVIDER_DISPLAY_NAME,
      model: IMAGE2_MODEL_ID,
      creditsPerImage: IMAGE2_CREDITS_PER_IMAGE,
      estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
    })

    const inputs = generationTasks.createBatchWithCharge.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      clientRequestId: 'image2-redo-1-1',
      projectId: 'project-1',
      kind: 'image',
      label: '生图大师 · 图片生成',
      prompt: '电影感最终提示词，严格保留图 2 的服装',
      negativePrompt: 'watermark, blurry',
      provider: 'img2',
      model: IMAGE2_MODEL_ID,
      estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
      metadata: expect.objectContaining({
        generationStage: 'image2-studio',
        providerDisplayName: IMAGE2_PROVIDER_DISPLAY_NAME,
        image2BatchId: 'image2-redo-1',
        batchIndex: 1,
        batchSize: 1,
        aspectRatio: '16:9',
        quality: 'medium',
        originalPrompt: '原始提示词',
        sourceTaskId: sourceTask.id,
        userNegativePrompt: 'watermark, blurry',
        promptOptimization: expect.objectContaining({
          requested: true,
          status: 'optimized',
        }),
        referenceVision: expect.objectContaining({
          requested: true,
          status: 'analyzed',
        }),
        generationSnapshot: expect.objectContaining({
          finalized: false,
          sourceTaskId: sourceTask.id,
          prompt: '电影感最终提示词，严格保留图 2 的服装',
          negativePrompt: 'watermark, blurry',
          userNegativePrompt: 'watermark, blurry',
          aspectRatio: '16:9',
          quality: 'medium',
          references: expect.arrayContaining([
            expect.objectContaining({
              id: 'ref-subject',
              role: 'subject',
              referenceNumber: 1,
            }),
          ]),
        }),
      }),
    })
  })
})

function makeSourceTask(): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: 'source-task-1',
    clientRequestId: 'image2-source-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    kind: 'image',
    label: '生图大师 · 图片生成',
    prompt: '电影感最终提示词，严格保留图 2 的服装',
    negativePrompt: 'watermark, blurry, compiled-floor',
    provider: 'img2',
    model: IMAGE2_MODEL_ID,
    tier: null,
    metadata: {
      generationStage: 'image2-studio',
      providerDisplayName: IMAGE2_PROVIDER_DISPLAY_NAME,
      image2BatchId: 'image2-source-batch',
      batchIndex: 1,
      batchSize: 1,
      aspectRatio: '16:9',
      quality: 'medium',
      originalPrompt: '原始提示词',
      userNegativePrompt: 'watermark, blurry',
      promptOptimization: {
        requested: true,
        status: 'optimized',
        prompt: '电影感最终提示词，严格保留图 2 的服装',
        reason: '',
        elapsedMs: 120,
        model: 'gpt-5.4',
      },
      referenceVision: {
        requested: true,
        status: 'analyzed',
        reason: '',
        elapsedMs: 80,
        analyzedCount: 1,
        model: 'gpt-5.4',
      },
      references: [
        {
          id: 'ref-subject',
          url: '/api/v1/media/ref-subject',
          name: 'image-1-subject.jpg',
          role: 'subject',
          referenceNumber: 1,
          order: 1,
        },
        {
          id: 'ref-clothing',
          url: '/api/v1/media/ref-clothing',
          name: 'image-2-clothing.jpg',
          role: 'clothing',
          referenceNumber: 2,
          order: 2,
        },
      ],
      generationSnapshot: {
        version: 1,
        finalized: true,
        sourceTaskId: 'source-task-1',
        model: IMAGE2_MODEL_ID,
        prompt: '电影感最终提示词，严格保留图 2 的服装',
        originalPrompt: '原始提示词',
        negativePrompt: 'watermark, blurry, compiled-floor',
        userNegativePrompt: 'watermark, blurry',
        aspectRatio: '16:9',
        quality: 'medium',
        imageCount: 1,
        references: [
          {
            id: 'ref-subject',
            url: '/api/v1/media/ref-subject',
            name: 'image-1-subject.jpg',
            role: 'subject',
            referenceNumber: 1,
            order: 1,
          },
          {
            id: 'ref-clothing',
            url: '/api/v1/media/ref-clothing',
            name: 'image-2-clothing.jpg',
            role: 'clothing',
            referenceNumber: 2,
            order: 2,
          },
        ],
        assist: {
          promptOptimization: true,
          referenceVision: true,
        },
        assistResults: {
          promptOptimization: {
            requested: true,
            status: 'optimized',
            prompt: '电影感最终提示词，严格保留图 2 的服装',
            reason: '',
            elapsedMs: 120,
            model: 'gpt-5.4',
          },
          referenceVision: {
            requested: true,
            status: 'analyzed',
            reason: '',
            elapsedMs: 80,
            analyzedCount: 1,
            model: 'gpt-5.4',
          },
        },
      },
    },
    status: 'completed',
    progress: 100,
    estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
    attempts: 1,
    maxAttempts: 3,
    leaseOwnerId: null,
    leaseToken: null,
    leaseAcquiredAt: null,
    leaseHeartbeatAt: null,
    leaseExpiresAt: null,
    resultUrl: null,
    outputs: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

function makeQueuedTask(input: Record<string, unknown>, index: number, principal: Principal): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: `task-${index + 1}`,
    clientRequestId: String(input.clientRequestId),
    projectId: String(input.projectId),
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: 'image',
    label: String(input.label),
    prompt: String(input.prompt),
    negativePrompt: String(input.negativePrompt),
    provider: String(input.provider),
    model: String(input.model),
    tier: null,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
    status: 'queued',
    progress: 0,
    estimatedCredits: Number(input.estimatedCredits ?? IMAGE2_CREDITS_PER_IMAGE),
    attempts: 0,
    maxAttempts: 3,
    leaseOwnerId: null,
    leaseToken: null,
    leaseAcquiredAt: null,
    leaseHeartbeatAt: null,
    leaseExpiresAt: null,
    resultUrl: null,
    outputs: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}
