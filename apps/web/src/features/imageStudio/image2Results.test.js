import { describe, expect, it } from 'vitest'
import { groupImage2Batches, image2ResultCacheRecords, mergeImage2Tasks } from './image2Results'

describe('image2 result aggregation', () => {
  it('groups tasks by batch and hides soft-deleted results', () => {
    const tasks = [
      task('task-1', 'batch-early', 'completed', '2026-08-15T14:39:00.000', 1, 1),
      task('task-2', 'batch-late', 'running', '2026-08-15T16:31:00.000', 1, 1),
      task('task-3', 'batch-old', 'completed', '2026-08-14T23:17:00.000', 1, 2),
      task('task-4', 'batch-old', 'failed', '2026-08-14T23:18:00.000', 2, 2),
      {
        ...task('task-hidden', 'batch-hidden', 'completed', '2026-08-14T10:02:00.000', 1, 1),
        metadata: {
          ...task('task-hidden', 'batch-hidden', 'completed', '2026-08-14T10:02:00.000', 1, 1).metadata,
          queueHiddenAt: '2026-08-14T10:03:00.000',
        },
      },
    ]

    const batches = groupImage2Batches(tasks, 'project-1')

    expect(batches.map((batch) => batch.batchId)).toEqual(['batch-late', 'batch-early', 'batch-old'])
    expect(batches.map((batch) => batch.label)).toEqual(['第 2 次生成', '第 1 次生成', '第 1 次生成'])
    expect(batches[0]).toMatchObject({
      prompt: '镜头测试',
      originalPrompt: '镜头测试',
    })
    expect(batches[1]).toMatchObject({
      totalCount: 1,
      completedCount: 1,
      failedCount: 0,
    })
    expect(batches[2]).toMatchObject({
      totalCount: 2,
      completedCount: 1,
      failedCount: 1,
    })
  })

  it('lets a live task override the cached snapshot with the same id', () => {
    const cachedResults = [
      {
        id: 'task-1',
        projectId: 'project-1',
        batchId: 'batch-1',
        url: '/media/task-1.png',
        task: task('task-1', 'batch-1', 'completed', '2026-08-13T10:00:00.000Z', 1, 1),
      },
    ]
    const liveTask = task('task-1', 'batch-1', 'running', '2026-08-14T10:00:00.000Z', 1, 1)

    expect(mergeImage2Tasks([liveTask], cachedResults, 'project-1')).toEqual([liveTask])
  })

  it('keeps task metadata needed by redo and restores cached image URLs', () => {
    const sourceTask = {
      ...task('task-1', 'batch-1', 'completed', '2026-08-14T10:00:00.000Z', 1, 1),
      prompt: '原始镜头提示词',
      negativePrompt: '水印',
      metadata: {
        ...task('task-1', 'batch-1', 'completed', '2026-08-14T10:00:00.000Z', 1, 1).metadata,
        aspectRatio: '16:9',
        quality: 'high',
        references: [{ id: 'media-1', role: 'subject', referenceNumber: 1 }],
      },
    }
    const [record] = image2ResultCacheRecords([sourceTask], 'project-1')
    const [restored] = mergeImage2Tasks([], [{ ...record, cachedUrl: 'blob:cached' }], 'project-1')

    expect(restored.resultUrl).toBe('blob:cached')
    expect(restored.prompt).toBe('原始镜头提示词')
    expect(restored.negativePrompt).toBe('水印')
    expect(restored.metadata).toMatchObject({
      aspectRatio: '16:9',
      quality: 'high',
      references: [{ id: 'media-1', role: 'subject', referenceNumber: 1 }],
    })
  })
})

function task(id, batchId, status, updatedAt, batchIndex, batchSize) {
  return {
    id,
    projectId: 'project-1',
    status,
    progress: status === 'completed' ? 100 : 40,
    prompt: '镜头测试',
    estimatedCredits: 6,
    updatedAt,
    metadata: {
      image2BatchId: batchId,
      batchIndex,
      batchSize,
    },
    outputs:
      status === 'completed' ? [{ id: `${id}-output`, mediaType: 'image', url: `/media/${id}.png` }] : [],
  }
}
