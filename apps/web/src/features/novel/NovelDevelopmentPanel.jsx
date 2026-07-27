import { useEffect, useState } from 'react'
import { BookMarked, Eye, LoaderCircle, RefreshCw, ScrollText, Sparkles, X } from 'lucide-react'
import { NOVEL_OPERATION_CREDITS } from '@seqora/contracts'
import { AssetEditor } from '../assets/AssetEditor'
import { AssetSuggestionsPanel, assetSuggestionKey } from '../script/AssetSuggestionsPanel'
import { restoreNovelDevelopmentCache, saveNovelDevelopmentCache } from './novelWorkflowCache'
import { formatStoryOverviewText } from './storyOverviewText'

const SUMMARY_BATCH_OPTIONS = [1, 4, 8, 12, 16, 24]
const SUMMARY_PREVIEW_COUNT = 4
const ENABLE_NOVEL_ASSET_SUGGESTIONS = false

export function NovelDevelopmentPanel({
  document,
  textModel = 'gpt-5.6',
  disabled,
  onGetSummaries,
  onGenerateSummaries,
  onGetStoryBible,
  onGenerateStoryBible,
  onSuggestAssets,
  aspectRatio,
  onUpload,
  onCreateAsset,
}) {
  const [summariesResult, setSummariesResult] = useState(null)
  const [storyBibleResult, setStoryBibleResult] = useState(null)
  const [summaryBatchSize, setSummaryBatchSize] = useState(4)
  const [summaryBrowserOpen, setSummaryBrowserOpen] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [assetSuggestionStatus, setAssetSuggestionStatus] = useState('idle')
  const [assetSuggestionResult, setAssetSuggestionResult] = useState(null)
  const [assetSuggestionError, setAssetSuggestionError] = useState('')
  const [creatingAssetKeys, setCreatingAssetKeys] = useState(() => new Set())
  const [createdAssetKeys, setCreatedAssetKeys] = useState(() => new Set())
  const [suggestedAssetEditor, setSuggestedAssetEditor] = useState(null)

  const isLoading = status === 'loading'
  const isGeneratingSummaries = status === 'generating-summaries'
  const isGeneratingStoryBible = status === 'generating-story-bible'
  const summaryCount = summariesResult?.summaries.length ?? 0
  const missingSummaryCount = summariesResult?.missingSummaryCount ?? document.chapterCount
  const summaryCompleted = summariesResult?.completed ?? false
  const nextSummaryBatchSize = Math.max(0, Math.min(summaryBatchSize, missingSummaryCount))
  const storyBible = storyBibleResult?.storyBible ?? null
  const storyOverviewStatus = summaryCompleted
    ? storyBible
      ? '已有故事概要，可按最新章节摘要刷新'
      : '章节摘要已完成，可以生成故事概要'
    : summaryCount
      ? `还缺 ${missingSummaryCount} 章摘要，完成全部章节摘要后才能生成故事概要`
      : '还没有章节概要，故事概要需要先读取章节概要作为事实源'
  const assetSuggestionEmptyText = !summaryCount
    ? '先生成至少一批章节概要，系统才有事实源可提取资产。'
    : storyBible
      ? '已具备章节概要和故事概要，点击按钮提取需要保持一致的角色、场景、道具和服装建议。'
      : '已有章节概要，可以先生成基础资产建议；生成故事概要后，角色、场景、道具和服装建议会更准确。'

  useEffect(() => {
    let cancelled = false
    const cached = restoreNovelDevelopmentCache(document.id)
    setSummariesResult(cached?.summariesResult ?? null)
    setStoryBibleResult(cached?.storyBibleResult ?? null)
    setStatus('loading')
    setError('')
    setSummaryBrowserOpen(false)
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    setCreatingAssetKeys(new Set())
    setCreatedAssetKeys(new Set())
    Promise.all([onGetSummaries(document.id), onGetStoryBible(document.id)])
      .then(([nextSummaries, nextStoryBible]) => {
        if (cancelled) return
        setSummariesResult(nextSummaries)
        setStoryBibleResult(nextStoryBible)
        saveNovelDevelopmentCache(document.id, {
          summariesResult: nextSummaries,
          storyBibleResult: nextStoryBible,
        })
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setStatus('idle')
      })
    return () => {
      cancelled = true
    }
  }, [document.id])

  const handleGenerateSummaries = async () => {
    setStatus('generating-summaries')
    setError('')
    try {
      const result = await onGenerateSummaries(document.id, {
        clientRequestId: crypto.randomUUID(),
        batchSize: summaryBatchSize,
        model: textModel,
      })
      const nextStoryBibleResult = storyBibleResult
        ? {
            ...storyBibleResult,
            summaryCount: result.summaries.length,
            missingSummaryCount: Math.max(0, result.document.chapterCount - result.summaries.length),
          }
        : storyBibleResult
      setSummariesResult(result)
      setStoryBibleResult(nextStoryBibleResult)
      saveNovelDevelopmentCache(document.id, {
        summariesResult: result,
        storyBibleResult: nextStoryBibleResult,
      })
      resetAssetSuggestions()
    } catch (summaryError) {
      setError(summaryError.message)
    } finally {
      setStatus('idle')
    }
  }

  const handleGenerateStoryBible = async (force = false) => {
    setStatus('generating-story-bible')
    setError('')
    try {
      const result = await onGenerateStoryBible(document.id, {
        clientRequestId: crypto.randomUUID(),
        force,
        model: textModel,
      })
      const nextStoryBibleResult = {
        storyBible: result.storyBible,
        summaryCount,
        chapterCount: document.chapterCount,
        missingSummaryCount: result.missingSummaryCount,
      }
      setStoryBibleResult(nextStoryBibleResult)
      saveNovelDevelopmentCache(document.id, {
        summariesResult,
        storyBibleResult: nextStoryBibleResult,
      })
      resetAssetSuggestions()
    } catch (storyError) {
      setError(storyError.message)
    } finally {
      setStatus('idle')
    }
  }

  const handleSuggestAssets = async () => {
    if (!onSuggestAssets) return
    setAssetSuggestionStatus('suggesting')
    setAssetSuggestionError('')
    try {
      const result = await onSuggestAssets(document.id, {
        clientRequestId: crypto.randomUUID(),
        maxAssets: 12,
        model: textModel,
      })
      setAssetSuggestionResult(result)
      setCreatedAssetKeys(new Set())
    } catch (suggestError) {
      setAssetSuggestionError(suggestError.message)
    } finally {
      setAssetSuggestionStatus('ready')
    }
  }

  const resetAssetSuggestions = () => {
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    setCreatingAssetKeys(new Set())
    setCreatedAssetKeys(new Set())
  }

  const openSuggestedAssetEditor = (asset) => {
    if (!onCreateAsset) return
    const key = assetSuggestionKey(asset)
    setAssetSuggestionError('')
    setSuggestedAssetEditor({
      kind: asset.kind,
      suggestion: asset,
      suggestionKey: key,
      editorKey: crypto.randomUUID(),
    })
  }

  return (
    <section className="novel-development-panel" aria-busy={isLoading || isGeneratingSummaries}>
      <div className="novel-development-head">
        <div>
          <span className="eyebrow">章节摘要 / 故事概要</span>
          <h3>把原著整理成后续改编事实源</h3>
        </div>
        {isLoading && <LoaderCircle size={17} className="spin" />}
      </div>

      <div className="novel-summary-progress">
        <div>
          <span>章节摘要进度</span>
          <strong>
            {summaryCount} / {document.chapterCount}
          </strong>
        </div>
        <div className="novel-progress-track" aria-hidden="true">
          <span style={{ width: `${Math.round((summaryCount / document.chapterCount) * 100)}%` }} />
        </div>
        <small>
          {summaryCompleted
            ? '已可生成全书故事概要'
            : `还缺 ${missingSummaryCount} 章摘要，系统会按批次继续处理`}
        </small>
      </div>

      <div className="novel-summary-action-card">
        <div className="novel-summary-action-copy">
          <span className="eyebrow">章节摘要批处理</span>
          <strong>{summaryCompleted ? '章节摘要已完成' : `本次生成 ${nextSummaryBatchSize} 章摘要`}</strong>
          <small>
            {summaryCompleted
              ? '后续可以基于这些章节概要生成故事概要。'
              : '章节摘要会分批进入事实源，长篇小说不需要一次性处理完整原文。'}
          </small>
        </div>
        <div className="novel-summary-action-controls">
          <label className="novel-summary-batch-field">
            <span>本次摘要章节数</span>
            <select
              value={summaryBatchSize}
              disabled={disabled || isLoading || isGeneratingSummaries || summaryCompleted}
              onChange={(event) => setSummaryBatchSize(Number(event.target.value))}
            >
              {SUMMARY_BATCH_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {Math.min(size, missingSummaryCount)} 章
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={disabled || isLoading || isGeneratingSummaries || summaryCompleted}
            onClick={() => void handleGenerateSummaries()}
          >
            {isGeneratingSummaries ? <LoaderCircle size={16} className="spin" /> : <ScrollText size={16} />}
            {isGeneratingSummaries
              ? '正在生成摘要'
              : `生成 ${nextSummaryBatchSize} 章摘要 · ${NOVEL_OPERATION_CREDITS.chapterSummaryBatch} 积分`}
          </button>
        </div>
      </div>

      {summariesResult?.summaries.length > 0 && (
        <>
          <div className="novel-summary-list">
            {summariesResult.summaries.slice(0, SUMMARY_PREVIEW_COUNT).map((summary) => (
              <article key={summary.id}>
                <strong>
                  {String(summary.order).padStart(2, '0')} · {summary.title}
                </strong>
                <p>{summary.summary}</p>
                <small>
                  人物 {summary.characters.length} · 地点 {summary.locations.length} · 伏笔{' '}
                  {summary.foreshadowing.length}
                </small>
              </article>
            ))}
          </div>
          {summariesResult.summaries.length > SUMMARY_PREVIEW_COUNT && (
            <button type="button" className="novel-result-more" onClick={() => setSummaryBrowserOpen(true)}>
              <Eye size={14} /> 查看全部 {summariesResult.summaries.length} 章概要
            </button>
          )}
        </>
      )}

      <div className={`novel-story-overview-gate${summaryCompleted ? ' ready' : ''}`}>
        <div>
          <span className="eyebrow">故事概要</span>
          <strong>{summaryCompleted ? '下一步：生成故事概要' : '等待章节概要完成'}</strong>
          <small>{storyOverviewStatus}</small>
        </div>
        <div className="novel-story-overview-actions">
          <button
            className="button primary"
            disabled={disabled || isLoading || isGeneratingStoryBible || !summaryCompleted}
            onClick={() => void handleGenerateStoryBible(false)}
          >
            {isGeneratingStoryBible ? <LoaderCircle size={16} className="spin" /> : <BookMarked size={16} />}
            {storyBible ? '查看/刷新故事概要' : `生成故事概要 · ${NOVEL_OPERATION_CREDITS.storyBible} 积分`}
          </button>
          {storyBible && (
            <button
              className="button secondary"
              disabled={disabled || isGeneratingStoryBible}
              onClick={() => void handleGenerateStoryBible(true)}
            >
              <RefreshCw size={16} /> 重新生成
            </button>
          )}
        </div>
      </div>

      {summaryBrowserOpen && summariesResult?.summaries.length > 0 && (
        <div className="novel-browser-backdrop" role="presentation">
          <section className="novel-browser-modal" role="dialog" aria-modal="true" aria-label="全部章节概要">
            <div className="novel-browser-head">
              <div>
                <span className="eyebrow">全部章节概要</span>
                <h3>{document.name}</h3>
                <p>
                  共 {summariesResult.summaries.length} 章概要 · 页面仅保留前 {SUMMARY_PREVIEW_COUNT}{' '}
                  个卡片，完整内容在这里浏览
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭章节概要"
                onClick={() => setSummaryBrowserOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="novel-browser-list novel-browser-list-summaries">
              {summariesResult.summaries.map((summary) => (
                <article key={summary.id}>
                  <div className="novel-browser-card-head">
                    <strong>
                      {String(summary.order).padStart(2, '0')} · {summary.title}
                    </strong>
                    <span>
                      人物 {summary.characters.length} · 地点 {summary.locations.length}
                    </span>
                  </div>
                  <p>{summary.summary}</p>
                  <div className="novel-summary-facts">
                    {summary.characters.length > 0 && (
                      <span>人物：{summary.characters.slice(0, 4).join('；')}</span>
                    )}
                    {summary.locations.length > 0 && (
                      <span>地点：{summary.locations.slice(0, 4).join('；')}</span>
                    )}
                    {summary.keyProps.length > 0 && (
                      <span>道具：{summary.keyProps.slice(0, 4).join('；')}</span>
                    )}
                    {summary.foreshadowing.length > 0 && (
                      <span>伏笔：{summary.foreshadowing.slice(0, 3).join('；')}</span>
                    )}
                  </div>
                  {summary.adaptationNotes && <small>改编注意：{summary.adaptationNotes}</small>}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {ENABLE_NOVEL_ASSET_SUGGESTIONS && suggestedAssetEditor && (
        <AssetEditor
          key={suggestedAssetEditor.editorKey}
          asset={suggestedAssetEditor}
          aspectRatio={aspectRatio}
          tasks={[]}
          onUpload={onUpload}
          onClose={() => setSuggestedAssetEditor(null)}
          onSave={async (input) => {
            const created = await onCreateAsset(input)
            setCreatedAssetKeys((current) => new Set(current).add(suggestedAssetEditor.suggestionKey))
            setSuggestedAssetEditor(null)
            return created
          }}
        />
      )}

      {storyBible && (
        <div className="novel-story-bible-card">
          <div>
            <span className="eyebrow">全书故事概要</span>
            <h4>{storyBible.title}</h4>
            <p>{storyBible.logline}</p>
          </div>
          <div className="novel-bible-meta">
            <span>人物 {storyBible.characters.length}</span>
            <span>地点 {storyBible.locations.length}</span>
            <span>道具 {storyBible.keyProps.length}</span>
            <span>世界观 {storyBible.worldRules.length}</span>
          </div>
          <div className="novel-bible-themes">
            {storyBible.themes.slice(0, 5).map((theme) => (
              <span key={theme}>
                <Sparkles size={12} /> {theme}
              </span>
            ))}
          </div>
          <p>{formatStoryOverviewText(storyBible.adaptationStrategy)}</p>
        </div>
      )}

      {ENABLE_NOVEL_ASSET_SUGGESTIONS && (
        <AssetSuggestionsPanel
          status={assetSuggestionStatus}
          result={assetSuggestionResult}
          error={assetSuggestionError}
          creatingKeys={creatingAssetKeys}
          createdKeys={createdAssetKeys}
          disabled={disabled || isLoading || !summaryCount || !onSuggestAssets || !onCreateAsset}
          onRefresh={() => void handleSuggestAssets()}
          onInspect={openSuggestedAssetEditor}
          copy={{
            eyebrow: '小说资产建议',
            title: '根据章节概要、故事概要和世界观提取资产',
            refresh: assetSuggestionResult ? '重新生成小说资产建议' : '根据小说事实源生成资产建议',
            loading: '正在从小说事实源提取核心资产',
            empty: assetSuggestionEmptyText,
          }}
        />
      )}

      {error && (
        <p className="operation-error novel-import-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
