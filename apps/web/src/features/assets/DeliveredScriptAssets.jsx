import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SCRIPT_DIRECTION } from '@seqora/contracts'
import { AssetEditor } from './AssetEditor'
import { AssetSuggestionsPanel, assetSuggestionKey } from '../script/AssetSuggestionsPanel'
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
  onSuggestAssetsFast,
  onCreateAsset,
  onImportAssets,
  onUpload,
}) {
  const [stoppingTaskId, setStoppingTaskId] = useState(null)
  const [expanded, setExpanded] = useState(() => assets.length === 0)
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
  const suggestions = useAssetSuggestions({
    projectId: project.id,
    script: scope.autoSource,
    ...scope,
    direction: DEFAULT_SCRIPT_DIRECTION,
    onSuggestAssetsFast,
    onCreateAsset,
    onImportAssets,
    stoppingTaskId,
    setStoppingTaskId,
  })
  const knownKeys = useMemo(
    () => new Set([...assets.map(assetSuggestionKey), ...suggestions.createdKeys]),
    [assets, suggestions.createdKeys],
  )
  const pending =
    suggestions.result?.assets.filter((asset) => !knownKeys.has(assetSuggestionKey(asset))) || []
  const pendingFingerprint = pending.map(assetSuggestionKey).sort().join('|')
  useEffect(() => {
    if (pendingFingerprint) setExpanded(true)
  }, [pendingFingerprint])
  if (!scope.autoSource) return null
  return (
    <>
      <details
        className="delivered-script-assets"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          剧本资产{' '}
          <span>
            {pending.length
              ? `${pending.length} 项待加入`
              : suggestions.status === 'extracting'
                ? '正在整理资料…'
                : '人物 · 场景 · 物品'}
          </span>
        </summary>
        <p className="delivered-script-assets-help">
          已自动读取交付剧本。确认加入后即可设计形象，已有资产继续复用。
        </p>
        <AssetSuggestionsPanel
          status={suggestions.status}
          result={suggestions.result}
          error={suggestions.error}
          creatingKeys={suggestions.creatingKeys}
          createdKeys={knownKeys}
          onRefresh={suggestions.extractFast}
          onInspect={suggestions.openEditor}
          onDeleteSuggestion={suggestions.dismissSuggestion}
          onImportSelected={suggestions.importSelected}
          allowCostume={false}
          showPrompt={false}
          showExport={false}
          copy={{
            eyebrow: '来自已交付剧本',
            title: pending.length ? '确认这些资料，开始资产设计' : '人物、场景和物品资料',
            importSelected: '确认加入资产',
            refresh: '刷新剧本资料',
            extracting: '正在读取剧本中的人物、场景和物品。',
            empty: '正在读取已交付资料，完成后会自动显示。',
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
