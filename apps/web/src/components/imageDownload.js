const DOWNLOAD_HISTORY_KEY = 'seqora:image-download-history:v1'
const MAX_HISTORY_ITEMS = 120

export function imageDownloadFileName(requestedName, contentType) {
  const extension = extensionFor(contentType)
  const baseName = sanitizeFileName(requestedName).replace(/\.(png|jpe?g|webp|gif)$/i, '') || '资产图片'
  return `${baseName}.${extension}`
}

export function hasDownloadedImageName(fileName, storage = browserStorage()) {
  return readDownloadHistory(storage).includes(normalizeFileName(fileName))
}

export function rememberDownloadedImageName(fileName, storage = browserStorage()) {
  if (!storage) return
  const normalized = normalizeFileName(fileName)
  const history = readDownloadHistory(storage).filter((item) => item !== normalized)
  history.unshift(normalized)
  try {
    storage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)))
  } catch {
    // Download history is a UX hint only. Ignore storage quota/private-mode failures.
  }
}

export async function downloadImage(url, requestedName) {
  const blob = await fetchImageBlob(url)
  const fileName = imageDownloadFileName(requestedName, blob.type)
  const duplicate = hasDownloadedImageName(fileName)
  triggerBlobDownload(blob, fileName)
  rememberDownloadedImageName(fileName)
  return { duplicate, fileName }
}

export async function downloadImagesAsZip(images, requestedName) {
  if (!images.length) throw new Error('当前没有可下载的图片')
  const { default: JSZip } = await import('jszip')
  const results = await Promise.allSettled(
    images.map(async (image) => {
      const blob = await fetchImageBlob(image.url)
      return {
        blob,
        fileName: imageDownloadFileName(image.fileName || image.alt || '序幕-image2-结果', blob.type),
      }
    }),
  )
  const zip = new JSZip()
  const usedNames = new Set()
  const failures = []
  let successCount = 0

  for (const result of results) {
    if (result.status === 'fulfilled') {
      zip.file(uniqueArchiveFileName(result.value.fileName, usedNames), result.value.blob)
      successCount += 1
    } else {
      failures.push(result.reason instanceof Error ? result.reason.message : '文件读取失败')
    }
  }

  if (!successCount) throw new Error('没有可下载的图片，请刷新后重试')
  if (failures.length) {
    zip.file(
      '下载失败.txt',
      `有 ${failures.length} 张图片暂时无法读取，请重新生成后再试。\n${failures.join('\n')}`,
    )
  }

  const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  const fileName = imageArchiveFileName(requestedName)
  triggerBlobDownload(archive, fileName)
  return { fileName, successCount, failedCount: failures.length }
}

export function imageArchiveFileName(requestedName) {
  const baseName = sanitizeFileName(requestedName)
    .replace(/\.zip$/i, '')
    .trim()
  return `${baseName || '序幕-image2-结果'}.zip`
}

async function fetchImageBlob(url) {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error('图片下载失败，请稍后重试')
  return response.blob()
}

function triggerBlobDownload(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

function readDownloadHistory(storage) {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(DOWNLOAD_HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(normalizeFileName).filter(Boolean) : []
  } catch {
    return []
  }
}

function extensionFor(contentType) {
  const normalizedContentType = String(contentType || '')
  if (normalizedContentType.includes('jpeg')) return 'jpg'
  if (normalizedContentType.includes('webp')) return 'webp'
  if (normalizedContentType.includes('gif')) return 'gif'
  return 'png'
}

function sanitizeFileName(value) {
  const reserved = '<>:"/\\|?*'
  return [...String(value || '')]
    .map((character) => (character.charCodeAt(0) < 32 || reserved.includes(character) ? '-' : character))
    .join('')
    .trim()
}

function normalizeFileName(fileName) {
  return String(fileName || '')
    .trim()
    .toLocaleLowerCase('zh-CN')
}

function uniqueArchiveFileName(fileName, usedNames) {
  const extensionMatch = /(\.[^.]+)$/.exec(fileName)
  const extension = extensionMatch?.[1] || ''
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName
  let candidate = fileName
  let suffix = 2
  while (usedNames.has(candidate.toLocaleLowerCase('zh-CN'))) {
    candidate = `${baseName}-${suffix}${extension}`
    suffix += 1
  }
  usedNames.add(candidate.toLocaleLowerCase('zh-CN'))
  return candidate
}

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
