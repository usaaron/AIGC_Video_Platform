import { describe, expect, it } from 'vitest'
import {
  hasDownloadedImageName,
  imageArchiveFileName,
  imageDownloadFileName,
  rememberDownloadedImageName,
} from './imageDownload'

describe('image download helpers', () => {
  it('builds safe local image file names from preview labels', () => {
    expect(imageDownloadFileName('老船夫:面部/基准.png', 'image/jpeg')).toBe('老船夫-面部-基准.jpg')
    expect(imageDownloadFileName('', 'image/webp')).toBe('资产图片.webp')
    expect(imageDownloadFileName('黄狗-资产预览', 'image/png')).toBe('黄狗-资产预览.png')
    expect(imageArchiveFileName('批次:01/生成结果.zip')).toBe('批次-01-生成结果.zip')
  })

  it('tracks duplicate download names as a browser-side hint', () => {
    const storage = memoryStorage()
    expect(hasDownloadedImageName('翠翠-资产预览.png', storage)).toBe(false)

    rememberDownloadedImageName('翠翠-资产预览.png', storage)

    expect(hasDownloadedImageName('翠翠-资产预览.png', storage)).toBe(true)
    expect(hasDownloadedImageName('翠翠-资产预览.PNG', storage)).toBe(true)
    expect(hasDownloadedImageName('老船夫-资产预览.png', storage)).toBe(false)
  })
})

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}
