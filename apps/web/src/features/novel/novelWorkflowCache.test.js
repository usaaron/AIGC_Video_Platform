import { describe, expect, it } from 'vitest'
import {
  restoreActiveNovelDocumentId,
  restoreNovelDevelopmentCache,
  saveActiveNovelDocumentId,
  saveNovelDevelopmentCache,
} from './novelWorkflowCache'

const summariesResult = {
  summaries: [{ id: 'summary-1', chapterId: 'chapter-1', title: '第一章', summary: '渡口日常' }],
  completed: false,
  missingSummaryCount: 1,
}

const storyBibleResult = {
  storyBible: { title: '边城故事概要', logline: '渡口少女的成长故事' },
  summaryCount: 2,
  chapterCount: 2,
  missingSummaryCount: 0,
}

describe('novel workflow cache', () => {
  it('restores the active novel document for a project', () => {
    const storage = memoryStorage()

    saveActiveNovelDocumentId('project-1', 'document-1', storage)

    expect(restoreActiveNovelDocumentId('project-1', storage)).toBe('document-1')
  })

  it('ignores broken active document cache', () => {
    const storage = memoryStorage()
    storage.setItem('seqora:novel-active-document:project-1', '{')

    expect(restoreActiveNovelDocumentId('project-1', storage)).toBeNull()
  })

  it('merges cached summaries and story overview results', () => {
    const storage = memoryStorage()

    saveNovelDevelopmentCache('document-1', { summariesResult }, storage)
    saveNovelDevelopmentCache('document-1', { storyBibleResult }, storage)

    expect(restoreNovelDevelopmentCache('document-1', storage)).toEqual({
      summariesResult,
      storyBibleResult,
    })
  })

  it('treats failed writes as best-effort', () => {
    const storage = {
      setItem() {
        throw new Error('quota exceeded')
      },
      getItem() {
        return null
      },
    }

    expect(() => saveNovelDevelopmentCache('document-1', { summariesResult }, storage)).not.toThrow()
  })
})

function memoryStorage() {
  const records = new Map()
  return {
    getItem(key) {
      return records.has(key) ? records.get(key) : null
    },
    setItem(key, value) {
      records.set(key, String(value))
    },
    removeItem(key) {
      records.delete(key)
    },
  }
}
