import { useMemo } from 'react'
import { savedAssetEvidenceFingerprint, savedAssetSuggestionScope } from './assetSuggestionScope'
import { looksLikeDevelopedScript } from './scriptPageConfig'
import { assetSuggestionRevision, scriptSuggestionFingerprint } from './scriptTaskState'

export function useScriptAssetScope({ orderedEpisodes, script, assets, project, direction }) {
  const isSeries = project.contentType === 'short-drama'
  const savedScripts = orderedEpisodes
    .filter((episode) => episode.status === 'saved')
    .map((episode) => episode.content)
  const assetScanSource = script.trim() || savedScripts.at(-1) || ''
  const evidenceFingerprint = useMemo(() => savedAssetEvidenceFingerprint(orderedEpisodes), [orderedEpisodes])
  const assetSuggestionFingerprint = scriptSuggestionFingerprint(
    [...savedScripts, script, ...(evidenceFingerprint ? [evidenceFingerprint] : [])].join('\n\n'),
  )
  const currentAssetRevision = useMemo(() => assetSuggestionRevision(assets), [assets])
  const automaticAssetScope = useMemo(
    () =>
      savedAssetSuggestionScope({
        episodes: isSeries ? orderedEpisodes : [],
        source: !isSeries && looksLikeDevelopedScript(project.script) ? project.script : '',
        contentType: project.contentType,
        visualStyle: project.visualStyle,
        direction,
        assetRevision: currentAssetRevision,
      }),
    [
      isSeries,
      orderedEpisodes,
      project.script,
      project.contentType,
      project.visualStyle,
      direction,
      currentAssetRevision,
    ],
  )
  return { assetScanSource, assetSuggestionFingerprint, currentAssetRevision, automaticAssetScope }
}
