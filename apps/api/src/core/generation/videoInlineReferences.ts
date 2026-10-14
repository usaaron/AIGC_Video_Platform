import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

// A conservative client budget, not a claim about the upstream gateway's limit.
export const VIDEO_INLINE_BODY_BUDGET = 900_000
export type InlineReferenceEncoder = (dataUrl: string, maxBytes: number) => Promise<string>
const execFileAsync = promisify(execFile)

/** Keep every numbered slot, including continuity frames, and leave stored originals intact. */
export async function boundedInlineVideoBody<T extends { url: string }>(
  images: T[],
  serialize: (images: T[]) => string,
  encode: InlineReferenceEncoder,
): Promise<string> {
  const original = serialize(images)
  if (Buffer.byteLength(original) <= VIDEO_INLINE_BODY_BUDGET) return original
  const inline = images.filter((image) => image.url.startsWith('data:image/'))
  const overhead = Buffer.byteLength(
    serialize(images.map((image) => (image.url.startsWith('data:image/') ? { ...image, url: '' } : image))),
  )
  // Reserve each data URL prefix and base64 padding before budgeting binary bytes.
  const perImage = Math.floor((((VIDEO_INLINE_BODY_BUDGET - overhead) / inline.length - 64) * 3) / 4)
  if (!inline.length || perImage < 32_000) {
    throw new Error('视频请求文字或参考地址过长，无法在保留全部参考图的条件下提交')
  }
  const compact: T[] = []
  for (const image of images) {
    // Already small inline images need no recompression.
    const needsEncoding =
      image.url.startsWith('data:image/') && Buffer.byteLength(image.url) > (perImage * 4) / 3
    compact.push(needsEncoding ? { ...image, url: await encode(image.url, perImage) } : image)
  }
  const body = serialize(compact)
  if (Buffer.byteLength(body) > VIDEO_INLINE_BODY_BUDGET) {
    throw new Error('视频参考图仍超过传输体积限制，已停止提交；请减少本镜参考图或使用更小的图片')
  }
  return body
}

/** Lossy copies are for transport only; no cropping, no slot removal, bounded quality steps. */
export function createInlineReferenceEncoder(ffmpegPath: string, timeoutMs: number): InlineReferenceEncoder {
  return async (dataUrl, maxBytes) => {
    const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl)
    if (!match?.[1] || !match[2]) throw new Error('过大的视频参考图必须为 PNG、JPEG 或 WebP 图片')
    const directory = await mkdtemp(join(tmpdir(), 'seqora-video-reference-'))
    try {
      const input = join(directory, `input.${match[1]}`)
      const output = join(directory, 'reference.jpg')
      await writeFile(input, Buffer.from(match[2], 'base64'))
      for (const [edge, quality] of [
        [1024, 4],
        [1024, 8],
        [896, 10],
        [768, 12],
      ]) {
        await execFileAsync(
          ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-y',
            '-i',
            input,
            '-vf',
            `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`,
            '-frames:v',
            '1',
            '-c:v',
            'mjpeg',
            '-threads',
            '1',
            '-q:v',
            String(quality),
            output,
          ],
          { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
        )
        const bytes = await readFile(output)
        if (bytes.length && bytes.length <= maxBytes)
          return `data:image/jpeg;base64,${bytes.toString('base64')}`
      }
      throw new Error('参考图在保留可用清晰度后仍过大，无法提交本镜视频')
    } catch (error) {
      // Never propagate ffmpeg's command/stdout or private reference data to the UI.
      if (error instanceof Error && error.message === '参考图在保留可用清晰度后仍过大，无法提交本镜视频')
        throw error
      throw new Error('视频参考图传输预处理失败，请检查 FFmpeg 是否可用及图片是否完整')
    } finally {
      if (
        dirname(resolve(directory)) === resolve(tmpdir()) &&
        basename(directory).startsWith('seqora-video-reference-')
      ) {
        await rm(directory, { recursive: true, force: true })
      }
    }
  }
}
