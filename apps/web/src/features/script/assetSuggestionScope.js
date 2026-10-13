import { scriptSuggestionFingerprint } from './scriptTaskState'

function evidenceFingerprint(evidence) {
  if (!evidence) return ''
  // JSONB can return object keys in a different order; that is not a new source.
  return scriptSuggestionFingerprint(
    JSON.stringify(evidence, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
        : value,
    ),
  )
}

export function savedAssetEvidenceFingerprint(episodes = []) {
  const revisions = episodes
    .filter((episode) => episode.status === 'saved')
    .map((episode) => [episode.id, evidenceFingerprint(episode.continuityState?.scriptAssetEvidence)])
    .filter(([, fingerprint]) => fingerprint)
    .sort(([left], [right]) => left.localeCompare(right))
  return revisions.length ? scriptSuggestionFingerprint(JSON.stringify(revisions)) : ''
}

// The backend includes every saved episode. Selecting an episode or editing a
// draft must not change the automatic scan's source or identity.
export function savedAssetSuggestionScope({
  episodes = [],
  source = '',
  contentType,
  visualStyle,
  direction = {},
  assetRevision = 'none',
}) {
  const savedEpisodes = episodes
    .filter((episode) => episode.status === 'saved' && episode.content.trim())
    .map((episode) => ({
      id: episode.id,
      content: episode.content.trim(),
      evidence: evidenceFingerprint(episode.continuityState?.scriptAssetEvidence),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const autoSource = savedEpisodes.at(-1)?.content || source.trim()
  if (!autoSource) return { autoSource: '', autoScopeFingerprint: '' }
  const autoScopeFingerprint = scriptSuggestionFingerprint(
    JSON.stringify({
      episodes: savedEpisodes,
      source: savedEpisodes.length ? '' : autoSource,
      contentType,
      visualStyle: visualStyle || 'cinematic-cg',
      direction: Object.entries(direction).sort(([left], [right]) => left.localeCompare(right)),
      assetRevision,
    }),
  )
  return { autoSource, autoScopeFingerprint }
}
