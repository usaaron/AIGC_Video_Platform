import { describe, expect, it } from 'vitest'
import { image2BatchInputFromTask, image2EditFormFromTask } from './image2TaskParameters'

describe('image2 task parameter adapters', () => {
  it('recreates a single-image batch from the original task parameters', () => {
    expect(image2BatchInputFromTask(image2Task(), 'project-1')).toEqual({
      projectId: 'project-1',
      prompt: '让图 1 穿上图 2 的服装，夜景侧逆光',
      negativePrompt: 'watermark, blurry',
      aspectRatio: '9:16',
      quality: 'high',
      imageCount: 1,
      assist: {
        promptOptimization: true,
        referenceVision: true,
      },
      references: [
        {
          mediaId: '00000000-0000-4000-8000-000000000001',
          role: 'subject',
          referenceNumber: 1,
        },
        {
          mediaId: '00000000-0000-4000-8000-000000000002',
          role: 'clothing',
          referenceNumber: 2,
        },
      ],
    })
  })

  it('restores the finalized prompt and clears other references', () => {
    const form = image2EditFormFromTask(snapshotTask(), {
      id: '00000000-0000-4000-8000-000000000009',
      url: '/api/v1/media/00000000-0000-4000-8000-000000000009',
    })

    expect(form.imageCount).toBe(1)
    expect(form.prompt).toBe('电影感最终提示词，严格保留图 2 的服装')
    expect(form.references).toEqual([
      {
        mediaId: '00000000-0000-4000-8000-000000000009',
        url: '/api/v1/media/00000000-0000-4000-8000-000000000009',
        role: 'subject',
        inputNumber: 1,
      },
    ])
    expect(form.nextReferenceNumber).toBe(2)
  })

  it('reuses the finalized snapshot for redo without running assist again', () => {
    const input = image2BatchInputFromTask(snapshotTask(), 'project-1')

    expect(input).toMatchObject({
      sourceTaskId: 'image2-task-1',
      projectId: 'project-1',
      prompt: '电影感最终提示词，严格保留图 2 的服装',
      negativePrompt: 'watermark, blurry',
      aspectRatio: '16:9',
      quality: 'medium',
      imageCount: 1,
      assist: {
        promptOptimization: false,
        referenceVision: false,
      },
    })
    expect(input.references).toEqual([
      {
        mediaId: '00000000-0000-4000-8000-000000000002',
        role: 'clothing',
        referenceNumber: 2,
      },
      {
        mediaId: '00000000-0000-4000-8000-000000000001',
        role: 'subject',
        referenceNumber: 1,
      },
    ])
  })
})

function image2Task() {
  return {
    prompt: '服务端优化后的提示词',
    negativePrompt: 'watermark, blurry',
    metadata: {
      originalPrompt: '让图 1 穿上图 2 的服装，夜景侧逆光',
      aspectRatio: '9:16',
      quality: 'high',
      promptOptimization: { requested: true, status: 'optimized' },
      referenceVision: { requested: true, status: 'analyzed' },
      references: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          url: '/api/v1/media/00000000-0000-4000-8000-000000000001',
          role: 'subject',
          referenceNumber: 1,
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          url: '/api/v1/media/00000000-0000-4000-8000-000000000002',
          role: 'clothing',
          referenceNumber: 2,
        },
      ],
    },
  }
}

function snapshotTask() {
  return {
    id: 'image2-task-1',
    prompt: '服务端优化后的提示词',
    negativePrompt: 'compiled-floor',
    metadata: {
      originalPrompt: '原始提示词',
      generationSnapshot: {
        version: 1,
        finalized: true,
        prompt: '电影感最终提示词，严格保留图 2 的服装',
        originalPrompt: '原始提示词',
        negativePrompt: 'watermark, blurry, compiled-floor',
        userNegativePrompt: 'watermark, blurry',
        aspectRatio: '16:9',
        quality: 'medium',
        references: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            url: '/api/v1/media/00000000-0000-4000-8000-000000000002',
            role: 'clothing',
            referenceNumber: 2,
            order: 1,
          },
          {
            id: '00000000-0000-4000-8000-000000000001',
            url: '/api/v1/media/00000000-0000-4000-8000-000000000001',
            role: 'subject',
            referenceNumber: 1,
            order: 2,
          },
        ],
        assist: {
          promptOptimization: true,
          referenceVision: true,
        },
      },
    },
  }
}
