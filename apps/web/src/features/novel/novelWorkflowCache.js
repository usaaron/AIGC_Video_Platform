const CACHE_VERSION = 1
const ACTIVE_DOCUMENT_PREFIX = 'seqora:novel-active-document:'
const DEVELOPMENT_PREFIX = 'seqora:novel-development:'

export function restoreActiveNovelDocumentId(projectId, storage = browserStorage()) {
  if (!projectId || !storage) return null
  try {
    const raw = storage.getItem(activeDocumentKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.version === CACHE_VERSION && typeof parsed.documentId === 'string'
      ? parsed.documentId
      : null
  } catch {
    return null
  }
}

export function saveActiveNovelDocumentId(projectId, documentId, storage = browserStorage()) {
  if (!projectId || !documentId || !storage) return
  try {
    storage.setItem(
      activeDocumentKey(projectId),
      JSON.stringify({
        version: CACHE_VERSION,
        documentId,
        savedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // Cache writes are best-effort; server data remains authoritative.
  }
}

export function restoreNovelDevelopmentCache(documentId, storage = browserStorage()) {
  if (!documentId || !storage) return null
  try {
    const raw = storage.getItem(developmentKey(documentId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.version !== CACHE_VERSION) return null
    return {
      summariesResult: parsed.summariesResult ?? null,
      storyBibleResult: parsed.storyBibleResult ?? null,
    }
  } catch {
    return null
  }
}

export function saveNovelDevelopmentCache(
  documentId,
  { summariesResult, storyBibleResult },
  storage = browserStorage(),
) {
  if (!documentId || !storage) return
  try {
    const current = restoreNovelDevelopmentCache(documentId, storage) ?? {}
    storage.setItem(
      developmentKey(documentId),
      JSON.stringify({
        version: CACHE_VERSION,
        savedAt: new Date().toISOString(),
        summariesResult: summariesResult ?? current.summariesResult ?? null,
        storyBibleResult: storyBibleResult ?? current.storyBibleResult ?? null,
      }),
    )
  } catch {
    // Cache writes are best-effort; generation results must still be usable.
  }
}

function activeDocumentKey(projectId) {
  return `${ACTIVE_DOCUMENT_PREFIX}${projectId}`
}

function developmentKey(documentId) {
  return `${DEVELOPMENT_PREFIX}${documentId}`
}

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
