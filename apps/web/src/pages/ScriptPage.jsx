import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Layers3,
  LoaderCircle,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { PageHeader } from '../components/ui'
import { BrandMark } from '../components/BrandMark'
import { AssetEditor } from '../features/assets/AssetEditor'
import { AssetAwareTextarea, AssetShortcutBar } from '../features/assets/AssetShortcutBar'
import {
  availableScriptModelOptions,
  initialScriptValue,
  looksLikeDevelopedScript,
  orderScriptEpisodes,
  SCRIPT_CONTENT_CONFIGS,
  scriptGenerationStatusMessage,
} from '../features/script/scriptPageConfig'
import {
  ScriptHelp,
  ScriptGenerationMessages,
  ScriptAssetSuggestions,
  ScriptFlowActions,
} from '../features/script/ScriptPageSupport'
import {
  assetSuggestionRevision,
  deriveScriptTaskState,
  formatEpisodeDuration,
  scriptSuggestionFingerprint,
  scriptTaskStage,
  textPreviewStageLabel,
} from '../features/script/scriptTaskState'
import { useScriptTaskPreview } from '../features/script/useScriptTaskPreview'
import { useAssetSuggestions } from '../features/script/useAssetSuggestions'
import { useScriptGeneration } from '../features/script/useScriptGeneration'
import { SeriesCreationWorkspace } from '../features/script/ScriptMasterWorkspace'
import { DEFAULT_SCRIPT_MODEL, DEFAULT_SCRIPT_DIRECTION, SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'

export function ScriptPage({
  project,
  scriptEpisodes = [],
  assets = [],
  billing,
  tasks = [],
  textProviderStatus = null,
  scriptModelCapabilities = [],
  onSave,
  onSaveEpisode,
  onDeleteEpisode,
  onClearEpisodes,
  onRefreshProduction,
  onOpenProduction,
  onGenerate,
  onGenerateSegment,
  onSuggestAssets,
  onSuggestAssetsFast,
  onCreateAsset,
  onCreateAndGenerateAsset,
  onImportAssets,
  onUpload,
  onCancelTask,
  onUpdateEpisodeDuration,
  onNext,
}) {
  const contentConfig = SCRIPT_CONTENT_CONFIGS[project.contentType] || SCRIPT_CONTENT_CONFIGS.animation
  const isSeries = project.contentType === 'short-drama'
  const [seriesView, setSeriesView] = useState('creation')
  const orderedEpisodes = useMemo(() => orderScriptEpisodes(scriptEpisodes), [scriptEpisodes])
  const initialDraftEpisode =
    orderedEpisodes.find((episode) => episode.status === 'draft') || orderedEpisodes[0]
  const productionMode = contentConfig.productionMode
  const usesDuration = contentConfig.usesDuration !== false
  const textGenerationUnavailable = textProviderStatus !== 'configured'
  const textGenerationStatusMessage = scriptGenerationStatusMessage(textProviderStatus)
  const defaultEpisodeSeconds = project.episodeDurationSeconds || contentConfig.defaultDuration
  const [activeEpisodeId, setActiveEpisodeId] = useState(initialDraftEpisode?.id || null)
  const [script, setScript] = useState(
    initialScriptValue(initialDraftEpisode, isSeries, orderedEpisodes.length > 0, project.script),
  )
  const [direction] = useState(DEFAULT_SCRIPT_DIRECTION)
  const [scriptModel, setScriptModel] = useState(DEFAULT_SCRIPT_MODEL)
  const [revisionNote, setRevisionNote] = useState('')
  const [episodeDurationSeconds, setEpisodeDurationSeconds] = useState(defaultEpisodeSeconds)
  const [segmentGoal, setSegmentGoal] = useState('')
  const [segmentDurationSeconds, setSegmentDurationSeconds] = useState(defaultEpisodeSeconds)
  const [saved, setSaved] = useState(initialDraftEpisode?.status !== 'draft')
  const [generating, setGenerating] = useState(false)
  const [generationPhase, setGenerationPhase] = useState('idle')
  const [generationSeconds, setGenerationSeconds] = useState(0)
  const [generationWarnings, setGenerationWarnings] = useState([])
  const [saving, setSaving] = useState(false)
  const [hasGeneratedScript, setHasGeneratedScript] = useState(
    () => orderedEpisodes.length > 0 || looksLikeDevelopedScript(project.script),
  )
  const [error, setError] = useState('')
  const [stoppingTaskId, setStoppingTaskId] = useState(null)
  const scriptModelOptions = useMemo(
    () => availableScriptModelOptions(scriptModelCapabilities),
    [scriptModelCapabilities],
  )
  const scriptModelCapabilityKey = scriptModelCapabilities
    .map((capability) => `${capability.id}:${capability.available ? '1' : '0'}`)
    .join('|')
  const selectedScriptModelUnavailable =
    scriptModelOptions.find((model) => model.id === scriptModel)?.available === false
  const fileInput = useRef(null)
  const textArea = useRef(null)
  const activeEpisode = orderedEpisodes.find((episode) => episode.id === activeEpisodeId) || null
  const latestEpisode = orderedEpisodes.at(-1) || null
  const activeEpisodeIndex = activeEpisode
    ? orderedEpisodes.findIndex((episode) => episode.id === activeEpisode.id)
    : -1
  const previousEpisode = activeEpisode ? orderedEpisodes[activeEpisodeIndex - 1] : latestEpisode
  const nextEpisode = activeEpisode ? orderedEpisodes[activeEpisodeIndex + 1] : null
  const episodeSnapshotKey = useMemo(
    () =>
      orderedEpisodes
        .map((episode) => `${episode.id}:${episode.status}:${episode.revision}:${episode.updatedAt}`)
        .join('|'),
    [orderedEpisodes],
  )
  const count = script.replace(/\s/g, '').length
  const paragraphCount = script.split(/\n+/).filter(Boolean).length
  const estimatedMinutes = script.trim() ? Math.max(1, Math.ceil(count / 120)) : 0
  const savedScripts = orderedEpisodes
    .filter((episode) => episode.status === 'saved')
    .map((episode) => episode.content)
  const assetScanSource = script.trim() || savedScripts.at(-1) || ''
  const assetSuggestionFingerprint = scriptSuggestionFingerprint([...savedScripts, script].join('\n\n'))
  const currentAssetRevision = useMemo(() => assetSuggestionRevision(assets), [assets])

  useEffect(() => {
    if (!scriptModelCapabilityKey || !selectedScriptModelUnavailable) return
    const firstAvailable = scriptModelOptions.find((model) => model.available)
    if (firstAvailable) setScriptModel(firstAvailable.id)
  }, [scriptModelCapabilityKey, selectedScriptModelUnavailable])
  const scriptTaskState = useMemo(
    () =>
      deriveScriptTaskState({
        tasks,
        projectId: project.id,
        orderedEpisodes,
        assetSuggestionFingerprint,
        currentAssetRevision,
      }),
    [tasks, project.id, orderedEpisodes, assetSuggestionFingerprint, currentAssetRevision],
  )
  const {
    latestFailedScriptTask,
    completedScriptText,
    completedScriptEpisodeId,
    latestAssetSuggestionTask,
    activeAssetSuggestionTask,
    activeTaskEpisode,
    activeTaskDraftText,
    activeTaskHasWriteback,
    activeScriptTask,
    activeGenerateTask,
    activeRevisionTask,
    activeSegmentTask,
    activeTextPreview,
    activePreviewSessionKey,
    activePreviewStage,
    activePreviewValidation,
    latestTextTiming,
  } = scriptTaskState
  const autoAssetSuggestionSource =
    activeTaskDraftText ||
    (completedScriptText && scriptSuggestionFingerprint(completedScriptText) === assetSuggestionFingerprint
      ? completedScriptText
      : '') ||
    (saved && looksLikeDevelopedScript(script) ? script : '')
  const assetSuggestions = useAssetSuggestions({
    projectId: project.id,
    script: assetScanSource,
    scopeFingerprint: assetSuggestionFingerprint,
    autoSource: autoAssetSuggestionSource || savedScripts.at(-1) || '',
    direction,
    latestTask: latestAssetSuggestionTask,
    activeTask: activeAssetSuggestionTask,
    onSuggestAssets,
    onSuggestAssetsFast,
    onCreateAsset,
    onCreateAndGenerateAsset,
    onImportAssets,
    onCancelTask,
    stoppingTaskId,
    setStoppingTaskId,
  })
  const {
    commitEpisodeDuration,
    expand,
    generateSegment,
    normalizeDuration: normalizeContentDuration,
    save,
    continueToAssets,
  } = useScriptGeneration({
    project,
    contentConfig,
    isSeries,
    productionMode,
    textProviderStatus,
    selectedScriptModelUnavailable,
    billing,
    script,
    direction,
    scriptModel,
    revisionNote,
    activeEpisode,
    orderedEpisodes,
    latestEpisode,
    saved,
    episodeDurationSeconds,
    segmentDurationSeconds,
    segmentGoal,
    onGenerate,
    onGenerateSegment,
    onSave,
    onSaveEpisode,
    onUpdateEpisodeDuration,
    onNext,
    suggestAssets: assetSuggestions.suggest,
    setActiveEpisodeId,
    setScript,
    setEpisodeDurationSeconds,
    setSegmentDurationSeconds,
    setRevisionNote,
    setSaved,
    setHasGeneratedScript,
    setGenerating,
    setGenerationPhase,
    setGenerationWarnings,
    setError,
    setSegmentGoal,
    setSaving,
  })
  // Once the matching episode draft is durable, the editor is usable immediately.
  // The worker still reconciles the task status in the background.
  const { clearPreviewAnimation, displayedTextPreview, previewContentRef } = useScriptTaskPreview({
    activePreviewSessionKey,
    activeTextPreview,
    completedScriptText,
    hasActiveScriptTask: Boolean(activeScriptTask),
  })
  const hasDisplayedTextPreview = Boolean(displayedTextPreview.trim())
  const activePreviewEpisodeNumber =
    activeTaskEpisode?.episodeNumber ||
    activeEpisode?.episodeNumber ||
    (isSeries ? orderedEpisodes.length + 1 : null)
  const scriptGenerationBusy = generating || Boolean(activeScriptTask)
  const busy = generating || saving || Boolean(activeScriptTask)
  const hasActiveScriptTask = Boolean(activeScriptTask)

  useEffect(() => {
    if (hasActiveScriptTask || activeTaskHasWriteback || !completedScriptText) return
    clearPreviewAnimation()
    setScript((current) => (current === completedScriptText ? current : completedScriptText))
    setHasGeneratedScript(true)
    if (isSeries && completedScriptEpisodeId) setActiveEpisodeId(completedScriptEpisodeId)
    setSaved(!isSeries)
  }, [activeTaskHasWriteback, completedScriptEpisodeId, completedScriptText, hasActiveScriptTask, isSeries])

  useEffect(() => {
    if (!activeTaskHasWriteback || !activeTaskEpisode || !activeTaskDraftText) return
    clearPreviewAnimation()
    setScript((current) => (current === activeTaskDraftText ? current : activeTaskDraftText))
    setHasGeneratedScript(true)
    if (isSeries) setActiveEpisodeId(activeTaskEpisode.id)
    setSaved(!isSeries)
    setGenerating(false)
    setGenerationPhase('idle')
  }, [activeTaskDraftText, activeTaskEpisode?.id, activeTaskHasWriteback, isSeries])

  const stopScriptTask = async (task, label) => {
    if (!task || !onCancelTask || stoppingTaskId) return
    if (!window.confirm(`当前${label}正在生成，停止后本次结果不会写回。确定停止吗？`)) return
    setStoppingTaskId(task.id)
    setError('')
    try {
      await onCancelTask(task.id)
      setGenerationWarnings([`已停止${label}。你可以切换模型后重新尝试。`])
    } catch (stopError) {
      setError(stopError.message)
    } finally {
      setStoppingTaskId(null)
    }
  }

  useEffect(() => {
    if (isSeries) {
      const draftEpisode =
        orderedEpisodes.find((episode) => episode.status === 'draft') ||
        orderedEpisodes.find((episode) => episode.id === activeEpisodeId) ||
        orderedEpisodes[0]
      setActiveEpisodeId(draftEpisode?.id || null)
      setScript(
        draftEpisode?.draftContent || draftEpisode?.content || (orderedEpisodes.length ? '' : project.script),
      )
      setSaved(draftEpisode?.status !== 'draft')
    } else {
      setActiveEpisodeId(null)
      setScript(project.script)
      setSaved(true)
    }
    setEpisodeDurationSeconds(defaultEpisodeSeconds)
    setSegmentDurationSeconds(defaultEpisodeSeconds)
    setRevisionNote('')
    setError('')
    setHasGeneratedScript(orderedEpisodes.length > 0 || looksLikeDevelopedScript(project.script))
  }, [project.id, project.script, defaultEpisodeSeconds, episodeSnapshotKey, isSeries])

  useEffect(() => {
    if (!generating) return undefined
    const startedAt = Date.now()
    setGenerationSeconds(0)
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1_000))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [generating])

  const update = (value) => {
    setScript(value)
    setSaved(false)
    assetSuggestions.reset()
  }

  const openEpisode = (episode) => {
    if (!saved && script.trim() && !window.confirm('当前修改尚未保存，切换后会丢失。继续吗？')) return
    assetSuggestions.reset()
    setActiveEpisodeId(episode.id)
    setScript(episode.draftContent || episode.content)
    setSaved(episode.status === 'saved')
    setHasGeneratedScript(true)
    setRevisionNote('')
    setError('')
  }

  const deleteLastEpisode = async (episode) => {
    if (!onDeleteEpisode || episode.id !== latestEpisode?.id) return
    if (!window.confirm(`确定删除${episode.title}吗？该集已生成的分镜也会一起删除。`)) return
    setSaving(true)
    setError('')
    try {
      await onDeleteEpisode(episode.id)
      assetSuggestions.reset()
      setActiveEpisodeId(null)
      setScript('')
      setSaved(true)
    } catch (deleteError) {
      setError(deleteError.message)
    } finally {
      setSaving(false)
    }
  }

  const clearAllEpisodes = async () => {
    if (!onClearEpisodes || !orderedEpisodes.length) return
    if (
      !window.confirm(`确定清空全部 ${orderedEpisodes.length} 集吗？所有关联分镜也会删除，此操作不可撤销。`)
    )
      return
    setSaving(true)
    setError('')
    try {
      await onClearEpisodes()
      assetSuggestions.reset()
      setActiveEpisodeId(null)
      setScript('')
      setSaved(true)
      setHasGeneratedScript(false)
    } catch (clearError) {
      setError(clearError.message)
    } finally {
      setSaving(false)
    }
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      update(await file.text())
    } catch (uploadError) {
      setError(uploadError.message)
    }
    event.target.value = ''
  }

  const skipAssetSuggestions = async () => {
    if (!(await assetSuggestions.cancelBeforeContinue())) return
    await continueToAssets()
  }

  return (
    <div
      className={`page editor-page script-page-redesign${isSeries && seriesView === 'creation' ? ' is-inline-creation' : ''}`}
    >
      <PageHeader
        eyebrow="AI 创作工作台"
        title={`《${project.name}》${contentConfig.pageTitle}`}
        description={contentConfig.pageDescription}
      >
        <div hidden={isSeries && seriesView === 'creation'} className="script-document-actions">
          <input ref={fileInput} className="hidden-input" type="file" accept=".txt,.md" onChange={upload} />
          <button className="button secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload size={16} /> 导入文本
          </button>
          <button
            className="button primary script-header-save"
            disabled={saving || saved || !script.trim()}
            onClick={() => void save()}
          >
            {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
            {saving
              ? '保存中'
              : saved
                ? '已保存'
                : isSeries
                  ? '保存当前剧集'
                  : `保存${contentConfig.documentName}`}
          </button>
        </div>
      </PageHeader>

      {isSeries && (
        <SeriesCreationWorkspace
          projectId={project.id}
          episodeCount={orderedEpisodes.length}
          view={seriesView}
          onViewChange={setSeriesView}
          busy={busy}
          onSynced={onRefreshProduction}
          onNavigate={onOpenProduction}
          onOpenCreation={async () => {
            if (saved || (await save())) setSeriesView('creation')
          }}
        />
      )}
      {isSeries && activeScriptTask && (
        <div className="script-generation-messages" role="status">
          <span>此前提交的剧集任务仍在运行，完成后会保留结果。</span>
          <button
            className="button secondary"
            disabled={Boolean(stoppingTaskId)}
            onClick={() => stopScriptTask(activeScriptTask, '剧集生成')}
          >
            {stoppingTaskId ? '正在停止' : '停止当前任务'}
          </button>
        </div>
      )}

      <div hidden={isSeries && seriesView !== 'production'}>
        {!isSeries && (
          <section className="script-direction-bar script-generation-console" aria-label="剧本生成设置">
            <header className="script-generation-head">
              <div className="script-direction-title">
                <span className="direction-symbol">
                  <Sparkles size={17} />
                </span>
                <div>
                  <span className="eyebrow">AI 编剧</span>
                  <strong>
                    {hasGeneratedScript ? contentConfig.generatedTitle : contentConfig.initialTitle}
                  </strong>
                </div>
              </div>
              <div className="script-generation-summary">
                <strong>{count.toLocaleString()} 字</strong>
                <span>
                  {usesDuration
                    ? `${formatEpisodeDuration(episodeDurationSeconds)} ${contentConfig.durationSuffix}`
                    : '单次 1 集'}
                </span>
              </div>
            </header>

            <div className="script-generation-controls">
              <section className="script-format-strip" aria-label="剧本节奏">
                <div className="script-format-identity">
                  <span className="direction-symbol">
                    <Clapperboard size={17} />
                  </span>
                  <div>
                    <span className="eyebrow">项目节奏已锁定</span>
                    <strong>{contentConfig.modeLabel}</strong>
                  </div>
                </div>
                <span className="script-format-note">{contentConfig.modeNote}</span>
                {usesDuration ? (
                  <label className="script-episode-seconds">
                    <span>{contentConfig.durationLabel}</span>
                    <span className="script-seconds-input">
                      <input
                        aria-label={`${contentConfig.durationLabel}（秒）`}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={episodeDurationSeconds}
                        onChange={(event) => setEpisodeDurationSeconds(event.target.value.replace(/\D/g, ''))}
                        onBlur={() => void commitEpisodeDuration()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitEpisodeDuration()
                        }}
                      />
                      <em>秒</em>
                    </span>
                  </label>
                ) : (
                  <span className="script-single-episode-budget">6～8 个场次</span>
                )}
              </section>

              <section className="script-setting-block script-model-card" aria-label="生成模型">
                <div className="script-setting-label">
                  <strong>生成模型</strong>
                  <small>当前 Provider</small>
                </div>
                <label className="script-control-field">
                  <select value={scriptModel} onChange={(event) => setScriptModel(event.target.value)}>
                    {scriptModelOptions.map((model) => (
                      <option key={model.id} value={model.id} disabled={!model.available}>
                        {model.label}
                        {model.available ? '' : '（当前不可用）'}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <div className="script-primary-generation">
                <button
                  type="button"
                  className={`button primary direction-generate-button ${
                    activeGenerateTask || (generating && generationPhase !== 'segment') ? 'is-generating' : ''
                  }`}
                  disabled={
                    saving ||
                    textGenerationUnavailable ||
                    selectedScriptModelUnavailable ||
                    (Boolean(activeScriptTask) && !activeGenerateTask) ||
                    (generating && !activeGenerateTask) ||
                    Boolean(stoppingTaskId)
                  }
                  onClick={() =>
                    activeGenerateTask
                      ? void stopScriptTask(activeGenerateTask, '智能生成')
                      : void expand('generate')
                  }
                >
                  {activeGenerateTask || (generating && generationPhase !== 'segment') ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {stoppingTaskId === activeGenerateTask?.id
                    ? '正在停止'
                    : activeGenerateTask
                      ? '智能生成中 · 点击停止'
                      : generating && generationPhase !== 'segment'
                        ? '正在智能生成'
                        : `智能生成 · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
                </button>
                <span className="script-primary-generation-note">{contentConfig.featureNote}</span>
              </div>
            </div>
          </section>
        )}

        <ScriptGenerationMessages
          textGenerationUnavailable={!isSeries && textGenerationUnavailable}
          textGenerationStatusMessage={textGenerationStatusMessage}
          latestFailedScriptTask={latestFailedScriptTask}
          generationWarnings={generationWarnings}
          latestTextTiming={latestTextTiming}
        />

        <div
          className={`script-workspace ${hasGeneratedScript && !isSeries ? 'with-revision-tools' : 'full-width'}`}
        >
          <section className="script-document" aria-busy={busy}>
            <div className="script-document-toolbar">
              <span className="script-document-toolbar-label">
                {isSeries ? activeEpisode?.title || '已有文本 · 制作稿' : `当前${contentConfig.documentName}`}
              </span>
              <div className="script-document-status">
                <span className={saved ? 'saved' : 'unsaved'}>
                  <BadgeCheck size={14} /> {saved ? '已同步' : '未保存'}
                </span>
              </div>
            </div>
            {isSeries && orderedEpisodes.length > 0 && (
              <nav className="script-episode-navigator" aria-label="剧集导航">
                <div className="script-episode-navigator-summary">
                  <span className="script-episode-navigator-icon">
                    <Layers3 size={17} />
                  </span>
                  <span>
                    <small>剧集</small>
                    <strong>{activeEpisode?.title || `已保存 ${orderedEpisodes.length} 集`}</strong>
                  </span>
                </div>
                <div className="script-episode-navigator-controls">
                  <button
                    type="button"
                    className="script-episode-nav-button"
                    title="上一集"
                    aria-label="打开上一集"
                    disabled={busy || !previousEpisode}
                    onClick={() => openEpisode(previousEpisode)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <select
                    value={activeEpisodeId || ''}
                    aria-label="选择要编辑的剧集"
                    disabled={busy}
                    onChange={(event) => {
                      const episode = orderedEpisodes.find((item) => item.id === event.target.value)
                      if (episode) openEpisode(episode)
                    }}
                  >
                    <option value="" disabled>
                      选择剧集
                    </option>
                    {orderedEpisodes.map((episode) => {
                      const source = episode.draftContent || episode.content
                      return (
                        <option key={episode.id} value={episode.id}>
                          第 {episode.episodeNumber} 集 · {source.replace(/\s/g, '').length} 字 ·{' '}
                          {episode.status === 'draft' ? '待保存' : '已保存'}
                        </option>
                      )
                    })}
                  </select>
                  <button
                    type="button"
                    className="script-episode-nav-button"
                    title="下一集"
                    aria-label="打开下一集"
                    disabled={busy || !nextEpisode}
                    onClick={() => openEpisode(nextEpisode)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  {activeEpisode?.id === latestEpisode?.id && (
                    <button
                      type="button"
                      className="script-episode-nav-button danger"
                      title="删除最后一集"
                      aria-label={`删除${activeEpisode.title}`}
                      disabled={busy}
                      onClick={() => void deleteLastEpisode(activeEpisode)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="script-episode-nav-button danger"
                    title="清空全部剧集"
                    aria-label="清空全部剧集"
                    disabled={busy}
                    onClick={() => void clearAllEpisodes()}
                  >
                    <Eraser size={15} />
                    <span className="script-episode-clear-label">清空</span>
                  </button>
                </div>
              </nav>
            )}
            <div className="script-textarea-wrap">
              {isSeries && orderedEpisodes.length > 0 && !activeEpisode ? (
                scriptGenerationBusy ? (
                  <div className="script-episode-generating-state" role="status" aria-live="polite">
                    <div className="script-episode-generating-mark">
                      <BrandMark spin />
                      <span />
                    </div>
                    <strong>正在生成第 {activePreviewEpisodeNumber} 集</strong>
                    <p>{scriptTaskStage(activeScriptTask) || contentConfig.progressText}</p>
                    <div className="script-generation-bars" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : (
                  <div className="script-episode-empty-state">
                    <span>
                      <Clapperboard size={24} />
                    </span>
                    <strong>上一集已保存</strong>
                    <p>从上方剧集导航查看制作稿；新增正文与分镜请打开网剧创作。</p>
                  </div>
                )
              ) : (
                <AssetAwareTextarea
                  inputRef={textArea}
                  assets={assets}
                  tasks={tasks}
                  value={script}
                  onChange={(event) => update(event.target.value)}
                  placeholder={contentConfig.placeholder}
                />
              )}
              {activeScriptTask && (
                <div className="script-generation-preview-layer">
                  <div className="script-background-task" role="status" aria-live="polite">
                    <BrandMark spin />
                    <div>
                      <strong>{activeScriptTask.label}</strong>
                      <span>
                        {activeScriptTask.status === 'running'
                          ? `序幕TV 正在生成 · ${
                              hasDisplayedTextPreview
                                ? '已收到片段，继续补全'
                                : scriptTaskStage(activeScriptTask)
                            }`
                          : activeScriptTask.status === 'paused'
                            ? '任务已暂停，可前往生成队列继续'
                            : '已提交模型，正在等待执行'}
                      </span>
                    </div>
                    <small>后台运行中，可以离开本页</small>
                  </div>
                  <section
                    className={`script-live-preview ${hasDisplayedTextPreview ? 'has-content' : 'is-waiting'}`}
                    aria-label="模型实时生成的剧本初稿"
                  >
                    <header>
                      <div>
                        <span className="eyebrow">
                          实时草稿 · {isSeries ? `第 ${activePreviewEpisodeNumber} 集` : '当前内容'}
                        </span>
                        <strong>
                          {hasDisplayedTextPreview
                            ? '已生成片段 · 校验同步进行'
                            : textPreviewStageLabel(activePreviewStage)}
                        </strong>
                      </div>
                      <small>
                        {hasDisplayedTextPreview
                          ? `${displayedTextPreview.replace(/\s/g, '').length} 字${
                              Number(activePreviewValidation?.recognizedScenes) > 0
                                ? ` · 已识别 ${activePreviewValidation.recognizedScenes} 场 · 已校验 ${activePreviewValidation.checkedScenes} 场`
                                : ''
                            }`
                          : '正在等待首段内容'}
                      </small>
                    </header>
                    {hasDisplayedTextPreview ? (
                      <pre ref={previewContentRef}>{displayedTextPreview}</pre>
                    ) : (
                      <div className="script-live-preview-skeleton" role="presentation">
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                    <footer>
                      {hasDisplayedTextPreview
                        ? '以下为已生成片段，模型仍在继续补全；完整校验通过后才会写入正文。'
                        : '等待模型返回首段内容；完整校验通过后才会写入正文。'}
                    </footer>
                  </section>
                </div>
              )}
              {generating && (
                <div className="script-processing-overlay" role="status" aria-live="polite">
                  <LoaderCircle size={25} className="spin" />
                  <strong>
                    {generationPhase === 'segment'
                      ? `正在${contentConfig.appendAction}`
                      : contentConfig.progressText}
                  </strong>
                  <span>已等待 {generationSeconds} 秒 · 完成后自动保存并刷新，无需手动操作</span>
                </div>
              )}
            </div>
            <div className="script-document-footer">
              {(!isSeries || activeEpisode || orderedEpisodes.length === 0) && (
                <AssetShortcutBar
                  assets={assets}
                  tasks={tasks}
                  value={script}
                  onChange={update}
                  inputRef={textArea}
                  placement="top"
                />
              )}
              <span>{count} 字</span>
              <span>{paragraphCount} 段</span>
              <span>
                {usesDuration ? `约 ${estimatedMinutes} 分钟` : `已保存 ${orderedEpisodes.length} 集`}
              </span>
              <button
                className="script-document-save"
                disabled={saving || saved || !script.trim()}
                onClick={() => void save()}
              >
                {saving ? <LoaderCircle size={17} className="spin" /> : <Save size={17} />}
                {saving ? '保存中' : saved ? '当前内容已保存' : isSeries ? '保存当前剧集' : '保存当前内容'}
              </button>
            </div>
          </section>

          {hasGeneratedScript && !isSeries && (
            <aside className="script-revision-panel" aria-label="剧本后续编辑">
              <header className="script-revision-panel-head">
                <div>
                  <span className="eyebrow">后续编辑</span>
                  <h2>{contentConfig.revisionTitle}</h2>
                </div>
                <ScriptHelp label="后续编辑说明">{contentConfig.revisionHelp}</ScriptHelp>
              </header>

              <section className="script-revision-tool">
                <div className="script-revision-tool-title">
                  <strong>按要求改写</strong>
                  <ScriptHelp label={`${contentConfig.documentName}改写说明`}>
                    根据修改意见重写当前内容，同时保留项目资产和已有核心设定。
                  </ScriptHelp>
                </div>
                <textarea
                  value={revisionNote}
                  rows={4}
                  maxLength={2_000}
                  placeholder={contentConfig.revisionPlaceholder}
                  onChange={(event) => setRevisionNote(event.target.value)}
                />
                <span className="script-revision-panel-count">{revisionNote.length} / 2000</span>
                <div className="script-revision-buttons">
                  <button
                    type="button"
                    className={`button primary ${
                      activeRevisionTask ||
                      (generating && generationPhase !== 'segment' && revisionNote.trim())
                        ? 'is-generating'
                        : ''
                    }`}
                    disabled={
                      saving ||
                      (!revisionNote.trim() && !activeRevisionTask) ||
                      (Boolean(activeScriptTask) && !activeRevisionTask) ||
                      (generating && !activeRevisionTask) ||
                      Boolean(stoppingTaskId)
                    }
                    onClick={() =>
                      activeRevisionTask
                        ? void stopScriptTask(activeRevisionTask, '剧本改写')
                        : void expand('revise')
                    }
                  >
                    {activeRevisionTask || (generating && generationPhase !== 'segment') ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Sparkles size={15} />
                    )}
                    {stoppingTaskId === activeRevisionTask?.id
                      ? '正在停止'
                      : activeRevisionTask
                        ? '改写中 · 点击停止'
                        : generating && generationPhase !== 'segment'
                          ? '正在改写'
                          : `按要求改写 · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
                  </button>
                </div>
              </section>

              {!isSeries && (
                <section className="script-revision-tool script-append-tool">
                  <div className="script-revision-tool-title">
                    <strong>{contentConfig.appendTitle}</strong>
                    <ScriptHelp label={`${contentConfig.appendTitle}说明`}>
                      {contentConfig.appendHelp}
                    </ScriptHelp>
                  </div>
                  <textarea
                    value={segmentGoal}
                    rows={3}
                    maxLength={500}
                    placeholder={contentConfig.appendPlaceholder}
                    onChange={(event) => setSegmentGoal(event.target.value)}
                  />
                  {usesDuration && (
                    <label className="script-append-duration">
                      <span>{contentConfig.appendDurationLabel}</span>
                      <span className="script-seconds-input">
                        <input
                          aria-label={`${contentConfig.appendDurationLabel}（秒）`}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={segmentDurationSeconds}
                          onChange={(event) =>
                            setSegmentDurationSeconds(event.target.value.replace(/\D/g, ''))
                          }
                          onBlur={() =>
                            setSegmentDurationSeconds(normalizeContentDuration(segmentDurationSeconds))
                          }
                        />
                        <em>秒</em>
                      </span>
                    </label>
                  )}
                  <button
                    type="button"
                    className={`button ${
                      activeSegmentTask || (generating && generationPhase === 'segment')
                        ? 'is-generating'
                        : ''
                    }`}
                    disabled={
                      saving ||
                      (Boolean(activeScriptTask) && !activeSegmentTask) ||
                      (generating && !activeSegmentTask) ||
                      Boolean(stoppingTaskId)
                    }
                    onClick={() =>
                      activeSegmentTask
                        ? void stopScriptTask(activeSegmentTask, contentConfig.appendTitle)
                        : void generateSegment()
                    }
                  >
                    {activeSegmentTask || generationPhase === 'segment' ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <ArrowRight size={15} />
                    )}
                    {stoppingTaskId === activeSegmentTask?.id
                      ? '正在停止'
                      : activeSegmentTask
                        ? '追加中 · 点击停止'
                        : generationPhase === 'segment'
                          ? '正在追加'
                          : `${contentConfig.appendAction} · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
                  </button>
                </section>
              )}
            </aside>
          )}
        </div>

        <ScriptAssetSuggestions
          assetSuggestions={assetSuggestions}
          isSeries={isSeries}
          skipAssetSuggestions={skipAssetSuggestions}
          stopping={Boolean(stoppingTaskId && stoppingTaskId === activeAssetSuggestionTask?.id)}
        />

        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}

        <ScriptFlowActions
          saved={saved}
          disabled={busy || (isSeries ? orderedEpisodes.length === 0 && !script.trim() : !script.trim())}
          onContinue={continueToAssets}
        />
      </div>

      {assetSuggestions.editor && (
        <AssetEditor
          key={assetSuggestions.editor.editorKey}
          asset={assetSuggestions.editor}
          aspectRatio={project.aspectRatio}
          tasks={[]}
          onUpload={onUpload}
          onClose={assetSuggestions.closeEditor}
          onSave={async (input) => {
            const created = await onCreateAsset(input)
            assetSuggestions.markEditorAssetCreated()
            return created
          }}
        />
      )}
    </div>
  )
}
