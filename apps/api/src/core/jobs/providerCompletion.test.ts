import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VideoContent } from '../generation/videoProvider.js'
import { readProviderVideo } from './providerCompletion.js'

const video = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
const content = (buffer = video, overrides: Partial<VideoContent> = {}): VideoContent => ({
  stream: Readable.from([buffer]),
  contentType: 'video/mp4',
  contentLength: String(buffer.length),
  statusCode: 200,
  contentRange: null,
  acceptRanges: null,
  ...overrides,
})
afterEach(() => vi.useRealTimers())

describe('complete provider media read', () => {
  it('accepts a complete MP4 stream without relying on an optional length header', async () => {
    const value = content(video, { contentLength: null, contentType: 'video/mp4; charset=binary' })
    expect(await readProviderVideo(async () => value)).toEqual({ buffer: video, contentType: 'video/mp4' })
    expect(value.stream.destroyed).toBe(true)
  })

  it.each([
    ['partial HTTP', { statusCode: 206 }],
    ['range header', { contentRange: 'bytes 0-23/100' }],
    ['HTML MIME', { contentType: 'text/html' }],
    ['excessive declared size', { contentLength: String(100 * 1024 * 1024 + 1) }],
    ['invalid declared size', { contentLength: '-1' }],
    ['truncated response', { contentLength: '100' }],
    ['oversized response', { contentLength: '1' }],
  ] as const)('rejects %s and destroys its stream', async (_label, overrides) => {
    const value = content(video, overrides)
    await expect(readProviderVideo(async () => value)).rejects.toThrow()
    expect(value.stream.destroyed).toBe(true)
  })

  it.each([
    Buffer.alloc(0),
    Buffer.from('<html>provider error</html>'),
    Buffer.from('00000018e6f4f9f069736f6d0000020069736f6d69736f32', 'hex'),
    Buffer.from('000000ff6674797069736f6d0000020069736f6d69736f32', 'hex'),
  ])('rejects empty or invalid video bytes', async (buffer) => {
    const value = content(buffer, { contentLength: null })
    await expect(readProviderVideo(async () => value)).rejects.toThrow()
    expect(value.stream.destroyed).toBe(true)
  })

  it('caps unadvertised streams at 100 MiB while reading', async () => {
    const chunk = Buffer.alloc(1024 * 1024)
    const value = content(video, {
      stream: Readable.from(Array.from({ length: 101 }, () => chunk)),
      contentLength: null,
    })
    await expect(readProviderVideo(async () => value)).rejects.toThrow('size limit')
    expect(value.stream.destroyed).toBe(true)
  })

  it('times out a stalled body and destroys the underlying stream', async () => {
    vi.useFakeTimers()
    const value = content(video, { stream: new Readable({ read() {} }), contentLength: null })
    const pending = readProviderVideo(async () => value)
    const rejection = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    expect(value.stream.destroyed).toBe(true)
  })

  it('destroys media that arrives after the header timeout', async () => {
    vi.useFakeTimers()
    let resolve!: (value: VideoContent) => void
    const late = new Promise<VideoContent>((done) => {
      resolve = done
    })
    const pending = readProviderVideo(() => late)
    const rejection = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    const value = content()
    resolve(value)
    await Promise.resolve()
    expect(value.stream.destroyed).toBe(true)
  })

  it('propagates midstream failures without returning partial evidence', async () => {
    const stream = Readable.from(
      (async function* () {
        yield video
        throw new Error('connection lost')
      })(),
    )
    await expect(
      readProviderVideo(async () => content(video, { stream, contentLength: null })),
    ).rejects.toThrow('connection lost')
    expect(stream.destroyed).toBe(true)
  })
})
