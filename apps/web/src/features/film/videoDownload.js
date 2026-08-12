export function videoDownloadUrl(url, fileName) {
  const safeName = safeVideoFileName(fileName)
  const separator = String(url).includes('?') ? '&' : '?'
  return `${url}${separator}download=1&filename=${encodeURIComponent(safeName)}`
}

export function safeVideoFileName(value) {
  const normalized = String(value || '序幕TV成片')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return /\.mp4$/i.test(normalized) ? normalized : `${normalized || '序幕TV成片'}.mp4`
}
