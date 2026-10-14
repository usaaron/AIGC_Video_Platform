import { useMemo, useState } from 'react'
import { DEFAULT_SCRIPT_DIRECTION } from '@seqora/contracts'
import { AssetEditor } from './AssetEditor'
import { AssetSuggestionsPanel } from '../script/AssetSuggestionsPanel'
import { savedAssetSuggestionScope } from '../script/assetSuggestionScope'
import { assetSuggestionRevision } from '../script/scriptTaskState'
import { useAssetSuggestions } from '../script/useAssetSuggestions'
import './deliveredScriptAssets.css'

// The handoff carries saved text and evidence. Creating assets remains an
// explicit choice here, before any image generation or billing can begin.
export function DeliveredScriptAssets({
  project,
  scriptEpisodes,
  assets,
  onSuggestAssets,
  onSuggestAssetsFast,
  latestAssetSuggestionTask,
  activeAssetSuggestionTask,
  onCancelTask,
  onCreateAsset,
  onImportAssets,
  onUpload,
}) {
  const [stoppingTaskId, setStoppingTaskId] = useState(null)
  const [expanded, setExpanded] = useState(() => assets.length === 0)
  // A script handoff that already brought its asset manifest into the host
  // project is authoritative for this saved body. Do not immediately run the
  // legacy text scan again when the user opens the asset design step.
  const deliveredAssetsReady = useMemo(
    () =>
      assets.length > 0 &&
      (scriptEpisodes.some(
        (episode) =>
          episode.status === 'saved' &&
          (episode.continuityState?.scriptAssetDesignDelivery?.version ===
            'script_asset_design_delivery.v1' ||
            episode.continuityState?.scriptAssetEvidence?.version === 'script_asset_evidence.v1'),
      ) ||
        // The embedded Script Master handoff keeps the full model-authored
        // design in the generation prompt because the display description is
        // bounded for ordinary project assets. This marker lets the host
        // recognize a formal design even when the episode has no narrative
        // evidence (for example, a scene-free opening draft).
        assets.some(
          (asset) => asset.sourceMode === 'generate' && /(?:^|\n)资产设定说明：/u.test(asset.prompt || ''),
        )),
    [assets, scriptEpisodes],
  )
  const scope = useMemo(
    () =>
      savedAssetSuggestionScope({
        episodes: scriptEpisodes,
        contentType: project.contentType,
        visualStyle: project.visualStyle,
        direction: DEFAULT_SCRIPT_DIRECTION,
        assetRevision: assetSuggestionRevision(assets),
      }),
    [scriptEpisodes, project.contentType, project.visualStyle, assets],
  )
  const automaticScope = deliveredAssetsReady ? { autoSource: '', autoScopeFingerprint: '' } : scope
  const suggestions = useAssetSuggestions({
    projectId: project.id,
    script: automaticScope.autoSource,
    ...automaticScope,
    direction: DEFAULT_SCRIPT_DIRECTION,
    latestTask: latestAssetSuggestionTask,
    activeTask: activeAssetSuggestionTask,
    onSuggestAssets,
    onSuggestAssetsFast,
    onCreateAsset,
    onImportAssets,
    onCancelTask,
    stoppingTaskId,
    setStoppingTaskId,
  })
  if (!automaticScope.autoSource) return null
  return (
    <>
      <details
        className="delivered-script-assets"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>从已交付剧本补充资产</summary>
        <AssetSuggestionsPanel
          status={suggestions.status}
          result={suggestions.result}
          error={suggestions.error}
          creatingKeys={suggestions.creatingKeys}
          createdKeys={suggestions.createdKeys}
          onRefresh={suggestions.extractFast}
          onInspect={suggestions.openEditor}
          onDeleteSuggestion={suggestions.dismissSuggestion}
          onImportSelected={suggestions.importSelected}
          allowCostume={false}
          copy={{
            eyebrow: '已交付剧本',
            title: '确认剧本中的人物、场景和物品',
            refresh: '重新提取已交付剧本',
            empty: '正在准备资产建议。确认加入后，再为资产生成图片。',
            inspect: '查看并调整',
          }}
        />
      </details>
      {suggestions.editor && (
        <AssetEditor
          key={suggestions.editor.editorKey}
          asset={suggestions.editor}
          projectAssets={assets}
          projectVisualStyle={project.visualStyle}
          aspectRatio={project.aspectRatio}
          tasks={[]}
          onUpload={onUpload}
          onClose={suggestions.closeEditor}
          onSave={async (input) => {
            const created = await onCreateAsset(input)
            suggestions.markEditorAssetCreated()
            return created
          }}
        />
      )}
    </>
  )
}
