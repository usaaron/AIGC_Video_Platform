export const IMAGE2_RESULT_CACHE_LIMIT = 60

const DATABASE_NAME = 'seqora-image2-results'
const DATABASE_VERSION = 1
const STORE_NAME = 'results'
const FALLBACK_KEY = 'seqora:image2-result-cache:v1'
const MAX_CACHED_BLOB_BYTES = 32 * 1024 * 1024

export async function loadCachedImageResults(projectId, options = {}) {
  if (!projectId) return []
  const storage = options.storage ?? browserStorage()
  const indexedDb = options.indexedDb ?? browserIndexedDb()

  if (indexedDb) {
    try {
      const database = await openDatabase(indexedDb)
      const records = await readAllRecords(database)
      database.close()
      if (records.length) {
        writeFallback(storage, records)
        return materialize(records.filter((record) => record.projectId === projectId))
      }
    } catch {
      // Fall through to metadata-only storage.
    }
  }

  return materialize(readFallback(storage).filter((record) => record.projectId === projectId))
}

export async function cacheImageResults(results, options = {}) {
  const records = results.map(normalizeRecord).filter(Boolean)
  if (!records.length) return
  const storage = options.storage ?? browserStorage()
  const indexedDb = options.indexedDb ?? browserIndexedDb()
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  if (!indexedDb) {
    writeFallback(storage, limitRecords([...readFallback(storage), ...records]))
    return
  }

  try {
    const database = await openDatabase(indexedDb)
    const existingRecords = await readAllRecords(database)
    const existingById = new Map(existingRecords.map((record) => [record.id, record]))
    const preparedRecords = []

    for (const record of records) {
      const existing = existingById.get(record.id)
      const existingBlob =
        existing?.url === record.url && existing.blob && typeof existing.blob.size === 'number'
          ? existing.blob
          : null
      const blob = existingBlob || (await fetchImageBlob(record.url, fetchImpl))
      preparedRecords.push({ ...record, ...(blob ? { blob } : {}) })
    }

    const incomingIds = new Set(preparedRecords.map((record) => record.id))
    const merged = limitRecords([
      ...existingRecords.filter((record) => !incomingIds.has(record.id)),
      ...preparedRecords,
    ])
    await replaceRecords(database, merged)
    database.close()
    writeFallback(storage, merged)
  } catch {
    writeFallback(storage, limitRecords([...readFallback(storage), ...records]))
  }
}

export async function removeCachedImageResult(taskId, options = {}) {
  const storage = options.storage ?? browserStorage()
  const indexedDb = options.indexedDb ?? browserIndexedDb()
  writeFallback(
    storage,
    readFallback(storage).filter((record) => record.id !== taskId),
  )
  if (!indexedDb) return

  try {
    const database = await openDatabase(indexedDb)
    await deleteRecord(database, taskId)
    database.close()
  } catch {
    // The localStorage fallback has already been updated.
  }
}

export function releaseCachedImageResults(results) {
  for (const result of results) {
    if (result.cachedUrl && result.cachedUrl !== result.url && result.cachedUrl.startsWith('blob:')) {
      globalThis.URL?.revokeObjectURL?.(result.cachedUrl)
    }
  }
}

function normalizeRecord(record) {
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.batchId !== 'string' ||
    typeof record.url !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    projectId: record.projectId,
    batchId: record.batchId,
    url: record.url,
    alt: typeof record.alt === 'string' ? record.alt : '序幕 image2 结果',
    fileName: typeof record.fileName === 'string' ? record.fileName : `${record.id}.png`,
    savedAt: Number(record.savedAt) || Date.now(),
    task: record.task && typeof record.task === 'object' ? record.task : null,
  }
}

function limitRecords(records) {
  const recordsById = new Map()
  for (const record of records.map(normalizeStoredRecord).filter(Boolean)) {
    const existing = recordsById.get(record.id)
    if (!existing || record.savedAt >= existing.savedAt) recordsById.set(record.id, record)
  }
  return [...recordsById.values()]
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, IMAGE2_RESULT_CACHE_LIMIT)
}

function normalizeStoredRecord(record) {
  const normalized = normalizeRecord(record)
  if (!normalized) return null
  return {
    ...normalized,
    ...(record.blob && typeof record.blob.size === 'number' ? { blob: record.blob } : {}),
  }
}

function materialize(records) {
  return limitRecords(records).map((record) => ({
    ...record,
    cachedUrl: record.blob && canCreateObjectUrl() ? globalThis.URL.createObjectURL(record.blob) : record.url,
  }))
}

async function fetchImageBlob(url, fetchImpl) {
  if (typeof fetchImpl !== 'function') return null
  try {
    const response = await fetchImpl(url, { credentials: 'include' })
    if (!response.ok) return null
    const blob = await response.blob()
    if (blob.size > MAX_CACHED_BLOB_BYTES || (blob.type && !blob.type.startsWith('image/'))) return null
    return blob
  } catch {
    return null
  }
}

function writeFallback(storage, records) {
  if (!storage) return
  try {
    storage.setItem(FALLBACK_KEY, JSON.stringify(limitRecords(records).map(stripTransientFields)))
  } catch {
    // Metadata fallback is best-effort and must not block result rendering.
  }
}

function stripTransientFields(record) {
  const metadata = { ...record }
  delete metadata.blob
  delete metadata.cachedUrl
  return metadata
}

function readFallback(storage) {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(FALLBACK_KEY) || '[]')
    return Array.isArray(parsed) ? limitRecords(parsed) : []
  } catch {
    return []
  }
}

function openDatabase(indexedDb) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开图片结果缓存'))
  })
}

function readAllRecords(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(limitRecords(request.result || []))
    request.onerror = () => reject(request.error || new Error('无法读取图片结果缓存'))
  })
}

function replaceRecords(database, records) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.clear()
    for (const record of records) store.put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('无法写入图片结果缓存'))
    transaction.onabort = () => reject(transaction.error || new Error('图片结果缓存写入已中止'))
  })
}

function deleteRecord(database, taskId) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(taskId)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('无法删除图片结果缓存'))
  })
}

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function browserIndexedDb() {
  try {
    return globalThis.indexedDB || null
  } catch {
    return null
  }
}

function canCreateObjectUrl() {
  return typeof globalThis.URL?.createObjectURL === 'function'
}
