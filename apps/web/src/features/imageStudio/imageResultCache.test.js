import { describe, expect, it } from 'vitest'
import {
  IMAGE2_RESULT_CACHE_LIMIT,
  cacheImageResults,
  loadCachedImageResults,
  removeCachedImageResult,
} from './imageResultCache'

describe('image2 result cache', () => {
  it('uses localStorage metadata as a fallback without persisting blobs', async () => {
    const storage = memoryStorage()
    const record = cacheRecord('task-1', 1)

    await cacheImageResults([record], { storage, indexedDb: false })

    const stored = JSON.parse(storage.getItem('seqora:image2-result-cache:v1'))
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: 'task-1', url: record.url })
    expect(stored[0]).not.toHaveProperty('blob')

    const loaded = await loadCachedImageResults('project-1', { storage, indexedDb: false })
    expect(loaded[0]).toMatchObject({ id: 'task-1', url: record.url })
    expect(loaded[0]).not.toHaveProperty('blob')
  })

  it(`keeps only the most recent ${IMAGE2_RESULT_CACHE_LIMIT} results`, async () => {
    const storage = memoryStorage()
    const records = Array.from({ length: IMAGE2_RESULT_CACHE_LIMIT + 5 }, (_, index) =>
      cacheRecord(`task-${index + 1}`, index + 1),
    )

    await cacheImageResults(records, { storage, indexedDb: false })

    const loaded = await loadCachedImageResults('project-1', { storage, indexedDb: false })
    expect(loaded).toHaveLength(IMAGE2_RESULT_CACHE_LIMIT)
    expect(loaded[0].id).toBe('task-65')
    expect(loaded.at(-1).id).toBe('task-6')
  })

  it('removes one cached result without affecting the rest', async () => {
    const storage = memoryStorage()
    await cacheImageResults([cacheRecord('task-1', 1), cacheRecord('task-2', 2)], {
      storage,
      indexedDb: false,
    })

    await removeCachedImageResult('task-1', { storage, indexedDb: false })

    const loaded = await loadCachedImageResults('project-1', { storage, indexedDb: false })
    expect(loaded.map((record) => record.id)).toEqual(['task-2'])
  })
})

function cacheRecord(id, savedAt) {
  return {
    id,
    projectId: 'project-1',
    batchId: 'image2-batch-1',
    url: `/media/${id}.png`,
    alt: `批次 1 ${id}`,
    fileName: `${id}.png`,
    savedAt,
    task: {
      id,
      projectId: 'project-1',
      prompt: '镜头测试',
      metadata: {
        image2BatchId: 'image2-batch-1',
        batchIndex: savedAt,
        batchSize: 1,
      },
    },
  }
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}
