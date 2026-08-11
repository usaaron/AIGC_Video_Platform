import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearProjectTaskCache, readProjectTaskCache, writeProjectTaskCache } from './projectTaskCache'

afterEach(() => vi.unstubAllGlobals())

describe('project task cache', () => {
  it('restores a project task snapshot during workflow navigation', () => {
    const storage = memoryStorage()
    vi.stubGlobal('window', { sessionStorage: storage })
    const tasks = [{ id: 'video-1', projectId: 'project-1', status: 'running', progress: 42 }]

    writeProjectTaskCache('project-1', tasks)

    expect(readProjectTaskCache('project-1')).toEqual(tasks)
  })

  it('clears a cached project after deletion', () => {
    const storage = memoryStorage()
    vi.stubGlobal('window', { sessionStorage: storage })
    writeProjectTaskCache('project-1', [{ id: 'video-1' }])

    clearProjectTaskCache('project-1')

    expect(readProjectTaskCache('project-1')).toEqual([])
  })
})

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}
