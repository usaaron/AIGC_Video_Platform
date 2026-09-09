export type StoredImageReference =
  { kind: 'media'; mediaId: string } | { kind: 'generation'; taskId: string; view: string }

export function parseStoredImageReference(value: unknown): StoredImageReference | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let url: URL
  try {
    url = new URL(value, 'http://local')
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  const media = /^\/api\/v1\/media\/([^/]+)$/.exec(url.pathname)
  if (media?.[1]) return { kind: 'media', mediaId: media[1] }
  const generated = /^\/api\/v1\/generation\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(url.pathname)
  return generated?.[1] && generated[2]
    ? { kind: 'generation', taskId: generated[1], view: generated[2] }
    : null
}
