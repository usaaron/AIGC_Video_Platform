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
  if (contentType.includes('jpeg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
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

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
