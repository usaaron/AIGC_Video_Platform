import { api } from '../../services/apiClient'

const REFERENCE_PREPROCESS_MAX_EDGE = 2048
const REFERENCE_PREPROCESS_JPEG_QUALITY = 0.88

export function createImage2Batch(input) {
  return api.createImage2Batch(input)
}

export function deleteImage2Task(taskId) {
  return api.deleteTask(taskId)
}

export async function pollImage2Batch(projectId, batchId) {
  const tasks = await api.tasks(projectId)
  return tasks.filter((task) => task.metadata?.image2BatchId === batchId)
}

export async function uploadReference(projectId, file) {
  return api.uploadMedia(projectId, await preprocessReferenceFile(file))
}

export async function uploadGeneratedResult(projectId, image) {
  const response = await fetch(image.url, { credentials: 'include' })
  if (!response.ok) throw new Error('无法读取生成结果，请刷新后重试')
  const blob = await response.blob()
  if (blob.type && !blob.type.startsWith('image/')) {
    throw new Error('生成结果不是可用的图片文件')
  }
  const file = new File([blob], image.fileName || 'image2-result.png', {
    type: blob.type || 'image/png',
    lastModified: Date.now(),
  })
  return uploadReference(projectId, file)
}

export async function preprocessReferenceFile(file) {
  if (typeof document === 'undefined') return file

  const decoded = await decodeReferenceImage(file)
  const sourceWidth = decoded.naturalWidth || decoded.width
  const sourceHeight = decoded.naturalHeight || decoded.height
  if (!sourceWidth || !sourceHeight) throw new Error('无法读取参考图尺寸')

  const scale = Math.min(1, REFERENCE_PREPROCESS_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = getReferenceCanvasContext(canvas)
  if (!context) throw new Error('浏览器无法创建图片处理画布')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(decoded, 0, 0, width, height)
  decoded.close?.()

  const blob = await canvasToJpegBlob(canvas)
  return new File([blob], processedReferenceName(file.name), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  })
}

async function decodeReferenceImage(file) {
  if ('createImageBitmap' in globalThis) {
    try {
      return await createImageBitmap(file, {
        colorSpaceConversion: 'default',
        imageOrientation: 'from-image',
      })
    } catch {
      return await createImageBitmap(file)
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('浏览器无法解码这张参考图'))
    }
    image.src = url
  })
}

function getReferenceCanvasContext(canvas) {
  try {
    return canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' }) ?? canvas.getContext('2d')
  } catch {
    return canvas.getContext('2d')
  }
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('参考图压缩失败'))
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      REFERENCE_PREPROCESS_JPEG_QUALITY,
    )
  })
}

function processedReferenceName(name) {
  const baseName = String(name || 'reference')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${baseName || 'reference'}.jpg`
}
