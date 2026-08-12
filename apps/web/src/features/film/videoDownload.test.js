import { describe, expect, it } from 'vitest'
import { safeVideoFileName, videoDownloadUrl } from './videoDownload'

describe('video download helpers', () => {
  it('builds an authenticated attachment URL for mobile downloads', () => {
    expect(videoDownloadUrl('/api/v1/generation/tasks/task-1/content', '奋斗青年:第1集')).toBe(
      `/api/v1/generation/tasks/task-1/content?download=1&filename=${encodeURIComponent('奋斗青年-第1集.mp4')}`,
    )
  })

  it('preserves existing query parameters and normalizes file names', () => {
    expect(videoDownloadUrl('/video?version=2', '万柏林区宣传片.mp4')).toBe(
      `/video?version=2&download=1&filename=${encodeURIComponent('万柏林区宣传片.mp4')}`,
    )
    expect(safeVideoFileName('')).toBe('序幕TV成片.mp4')
  })
})
