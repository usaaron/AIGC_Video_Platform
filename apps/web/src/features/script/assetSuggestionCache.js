import { DEFAULT_SCRIPT_DIRECTION } from '@seqora/contracts'

const CACHE_VERSION = 1
const CACHE_PREFIX = 'seqora:script-asset-suggestions:'
const DEFAULT_TEXT_MODEL = 'gpt-5.6'

export function restoreScriptAssetSuggestionsCache(projectId, script, storage = browserStorage()) {
  if (!projectId || !storage) return null
  try {
    const raw = storage.getItem(cacheKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.version !== CACHE_VERSION || !parsed.result) return null

    const direction = normalizeDirection(parsed.direction)
    const model = normalizeModel(parsed.model)
    const sourceScript = typeof parsed.sourceScript === 'string' ? parsed.sourceScript : script
    const signature = buildAssetSuggestionSignature(sourceScript, direction, model)
    if (parsed.signature !== signature) return null

    return {
      result: parsed.result,
      direction,
      model,
      sourceScript,
      createdKeys: new Set(asStringArray(parsed.createdKeys)),
    }
  } catch {
    return null
  }
}

export function saveScriptAssetSuggestionsCache(
  projectId,
  script,
  direction,
  model,
  result,
  createdKeys = [],
  storage = browserStorage(),
) {
  if (!projectId || !result || !storage) return
  try {
    const normalizedDirection = normalizeDirection(direction)
    const normalizedModel = normalizeModel(model)
    storage.setItem(
      cacheKey(projectId),
      JSON.stringify({
        version: CACHE_VERSION,
        savedAt: new Date().toISOString(),
        signature: buildAssetSuggestionSignature(script, normalizedDirection, normalizedModel),
        sourceScript: String(script || ''),
        direction: normalizedDirection,
        model: normalizedModel,
        result,
        createdKeys: asStringArray(createdKeys),
      }),
    )
  } catch {
    // Cache writes are best-effort; generation results must still be usable.
  }
}

export function buildAssetSuggestionSignature(script, direction, model) {
  const normalizedScript = String(script || '').trim()
  const normalizedDirection = normalizeDirection(direction)
  const directionSignature = [
    normalizedDirection.style,
    normalizedDirection.composition,
    normalizedDirection.lighting,
    normalizedDirection.camera,
    normalizedDirection.focus,
  ].join('|')
  return `${normalizeModel(model)}:${directionSignature}:${hashText(normalizedScript)}`
}

function cacheKey(projectId) {
  return `${CACHE_PREFIX}${projectId}`
}

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function normalizeDirection(direction) {
  return {
    ...DEFAULT_SCRIPT_DIRECTION,
    ...(direction && typeof direction === 'object' ? direction : {}),
  }
}

function normalizeModel(model) {
  return typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_TEXT_MODEL
}

function asStringArray(value) {
  return Array.from(value || []).filter((item) => typeof item === 'string' && item)
}

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`
}
