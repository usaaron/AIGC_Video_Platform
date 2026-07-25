import { describe, expect, it } from 'vitest'
import { decodeNovelFileText, looksLikeMojibake } from './textFileEncoding'

describe('novel text file encoding', () => {
  it('keeps valid UTF-8 text as UTF-8', () => {
    const bytes = new TextEncoder().encode('第一章 雨夜来信\n林夏收到一封信。')

    const decoded = decodeNovelFileText(bytes.buffer)

    expect(decoded).toEqual({
      encoding: 'utf-8',
      text: '第一章 雨夜来信\n林夏收到一封信。',
    })
  })

  it('decodes common GB18030 Chinese TXT files', () => {
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2])

    const decoded = decodeNovelFileText(bytes.buffer)

    expect(decoded.encoding).toBe('gb18030')
    expect(decoded.text).toBe('中文\n第一章')
  })

  it('detects replacement-character mojibake before import', () => {
    expect(looksLikeMojibake('����������Ϊ���������(txt02.com)������������')).toBe(true)
    expect(looksLikeMojibake('第一章 一\n由四川过湖南去，靠东有一条官路。')).toBe(false)
  })
})
