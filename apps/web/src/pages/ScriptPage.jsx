import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  Clapperboard,
  CircleHelp,
  LoaderCircle,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react'
import { PageHeader } from '../components/ui'
import { BrandMark } from '../components/BrandMark'
import { AssetEditor } from '../features/assets/AssetEditor'
import { AssetAwareTextarea, AssetShortcutBar } from '../features/assets/AssetShortcutBar'
import { NovelImportPanel } from '../features/novel/NovelImportPanel'
import { AssetSuggestionsPanel, assetSuggestionKey } from '../features/script/AssetSuggestionsPanel'
import { LongFormStudioPlaceholder } from '../features/script/LongFormStudioPlaceholder'
import { DEFAULT_SCRIPT_MODEL, DEFAULT_SCRIPT_DIRECTION, SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'

const SCRIPT_MODEL_OPTIONS = [
  ['seqora-5.6', 'SEQORA 5.6'],
  ['gpt-5.6-terra', 'SEQORA 5.6 Terra'],
  ['kimi-k3', 'Kimi K3'],
  ['glm-5.2', 'GLM 5.2'],
  ['glm-5.2-fast', 'GLM 5.2 Fast'],
]

const SCRIPT_SECTIONS = [
  {
    id: 'writing',
    label: '短剧本编写（建议小于1万字时使用）',
    description: '输入、保存和检查',
    icon: Clapperboard,
  },
  {
    id: 'novel',
    label: '小说上传与章节',
    description: '长文本导入与章节改编',
    status: '开发中',
    icon: Upload,
  },
  {
    id: 'long-form',
    label: '长剧本创作',
    description: '大纲、人物与世界设定',
    status: '开发中',
    icon: BookOpenText,
  },
]

function looksLikeDevelopedScript(value) {
  const source = value.trim()
  return source.length >= 300 || /(?:场景|场次|剧情|角色)[：:]/.test(source)
}

export function ScriptPage({
  project,
  assets = [],
  billing,
  tasks = [],
  onSave,
  onGenerate,
  onGenerateSegment,
  onImportNovel,
  onPreviewNovelSplit,
  onListNovels,
  onGetNovel,
  onGetNovelSummaries,
  onGenerateNovelSummaries,
  onGetNovelStoryBible,
  onGenerateNovelStoryBible,
  onSuggestNovelAssets,
  onGenerateNovelChapterAdaptation,
  onSuggestAssets,
  onCreateAsset,
  onUpload,
  onCancelTask,
  onUpdateEpisodeDuration,
  onNext,
}) {
  const productionMode = project.contentType === 'short-drama' ? 'web-series' : 'short-video'
  const defaultEpisodeSeconds = project.episodeDurationSeconds || (productionMode === 'web-series' ? 60 : 30)
  const [script, setScript] = useState(project.script)
  const [direction] = useState(DEFAULT_SCRIPT_DIRECTION)
  const [scriptModel, setScriptModel] = useState(DEFAULT_SCRIPT_MODEL)
  const [revisionNote, setRevisionNote] = useState('')
  const [episodeDurationSeconds, setEpisodeDurationSeconds] = useState(defaultEpisodeSeconds)
  const [segmentGoal, setSegmentGoal] = useState('')
  const [segmentDurationSeconds, setSegmentDurationSeconds] = useState(defaultEpisodeSeconds)
  const [saved, setSaved] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generationPhase, setGenerationPhase] = useState('idle')
  const [generationSeconds, setGenerationSeconds] = useState(0)
  const [generationWarnings, setGenerationWarnings] = useState([])
  const [saving, setSaving] = useState(false)
  const [hasGeneratedScript, setHasGeneratedScript] = useState(() => looksLikeDevelopedScript(project.script))
  const [activeScriptSection, setActiveScriptSection] = useState('writing')
  const [longFormSource, setLongFormSource] = useState('short-script')
  const [longFormDraft, setLongFormDraft] = useState('')
  const [error, setError] = useState('')
  const [assetSuggestionStatus, setAssetSuggestionStatus] = useState('idle')
  const [assetSuggestionResult, setAssetSuggestionResult] = useState(null)
  const [assetSuggestionError, setAssetSuggestionError] = useState('')
  const [creatingAssetKeys, setCreatingAssetKeys] = useState(() => new Set())
  const [createdAssetKeys, setCreatedAssetKeys] = useState(() => new Set())
  const [suggestedAssetEditor, setSuggestedAssetEditor] = useState(null)
  const [stoppingTaskId, setStoppingTaskId] = useState(null)
  const fileInput = useRef(null)
  const textArea = useRef(null)
  const count = script.replace(/\s/g, '').length
  const paragraphCount = script.split(/\n+/).filter(Boolean).length
  const estimatedMinutes = script.trim() ? Math.max(1, Math.ceil(count / 120)) : 0
  const assetSuggestionFingerprint = scriptSuggestionFingerprint(script)
  const latestAssetSuggestionTask = [...tasks]
    .filter(
      (task) =>
        task.kind === 'text' &&
        task.metadata?.scriptOperation === 'suggest-assets' &&
        task.metadata?.sourceScriptFingerprint === assetSuggestionFingerprint,
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
  const activeScriptTasks = tasks.filter(
    (task) =>
      task.kind === 'text' &&
      String(task.metadata?.generationStage || '').startsWith('script-') &&
      task.metadata?.scriptOperation !== 'suggest-assets' &&
      ['queued', 'paused', 'running'].includes(task.status),
  )
  const activeScriptTask = activeScriptTasks[0]
  const activeGenerateTask = activeScriptTasks.find((task) => scriptTaskOperation(task) === 'generate')
  const activeRevisionTask = activeScriptTasks.find((task) => scriptTaskOperation(task) === 'revise')
  const activeSegmentTask = activeScriptTasks.find((task) => scriptTaskOperation(task) === 'segment')
  const busy = generating || saving || Boolean(activeScriptTask)

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
    setScript(project.script)
    setEpisodeDurationSeconds(defaultEpisodeSeconds)
    setSegmentDurationSeconds(defaultEpisodeSeconds)
    setRevisionNote('')
    setSaved(true)
    setError('')
    setHasGeneratedScript(looksLikeDevelopedScript(project.script))
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
  }, [project.id, project.script, defaultEpisodeSeconds])

  useEffect(() => {
    setLongFormSource('short-script')
    setLongFormDraft('')
  }, [project.id])

  useEffect(() => {
    if (!generating) return undefined
    const startedAt = Date.now()
    setGenerationSeconds(0)
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1_000))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [generating])

  useEffect(() => {
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    setCreatingAssetKeys(new Set())
    setCreatedAssetKeys(new Set())
  }, [project.id])

  useEffect(() => {
    if (!latestAssetSuggestionTask) return
    if (['queued', 'paused', 'running'].includes(latestAssetSuggestionTask.status)) {
      setAssetSuggestionStatus('suggesting')
      setAssetSuggestionError('')
      return
    }
    if (latestAssetSuggestionTask.status === 'completed') {
      const result = latestAssetSuggestionTask.metadata?.textResult
      if (isAssetSuggestionResult(result)) {
        setAssetSuggestionResult(result)
        setAssetSuggestionError('')
        setAssetSuggestionStatus('ready')
      } else {
        setAssetSuggestionResult(null)
        setAssetSuggestionError('资产建议任务已完成，但没有返回有效结果，请重新分析。')
        setAssetSuggestionStatus('ready')
      }
      return
    }
    if (latestAssetSuggestionTask.status === 'failed') {
      setAssetSuggestionResult(null)
      setAssetSuggestionError(latestAssetSuggestionTask.error || '资产建议生成失败，请重试。')
      setAssetSuggestionStatus('ready')
    }
  }, [latestAssetSuggestionTask])

  const update = (value) => {
    setScript(value)
    setSaved(false)
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
  }

  const commitEpisodeDuration = async () => {
    if (productionMode !== 'web-series') return
    const next = Math.min(300, Math.max(30, Math.round(Number(episodeDurationSeconds) || 60)))
    setEpisodeDurationSeconds(next)
    setSegmentDurationSeconds(next)
    if (next === project.episodeDurationSeconds || !onUpdateEpisodeDuration) return
    try {
      await onUpdateEpisodeDuration(next)
    } catch (durationError) {
      setError(durationError.message)
    }
  }

  const suggestAssetsForScript = async (value) => {
    const source = value.trim()
    if (!source) return
    setAssetSuggestionStatus('suggesting')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    try {
      const task = await onSuggestAssets(source, direction, scriptSuggestionFingerprint(source), scriptModel)
      if (!isQueuedTextTask(task)) {
        setAssetSuggestionResult(task)
        setAssetSuggestionStatus('ready')
      }
      setCreatedAssetKeys(new Set())
    } catch (suggestError) {
      setAssetSuggestionError(suggestError.message)
      setAssetSuggestionStatus('ready')
    }
  }

  const openSuggestedAssetEditor = (asset) => {
    const key = assetSuggestionKey(asset)
    setAssetSuggestionError('')
    setSuggestedAssetEditor({
      kind: asset.kind,
      suggestion: asset,
      suggestionKey: key,
      editorKey: crypto.randomUUID(),
    })
  }

  const useAdaptedNovelScript = async (adaptedScript) => {
    const nextScript = adaptedScript.trim()
    if (!nextScript) {
      setError('章节改编剧本为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      setScript(nextScript)
      await onSave(nextScript)
      setSaved(true)
      setHasGeneratedScript(looksLikeDevelopedScript(nextScript))
      setActiveScriptSection('writing')
      void suggestAssetsForScript(nextScript)
      requestAnimationFrame(() => textArea.current?.focus())
    } catch (saveError) {
      setSaved(false)
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      update(await file.text())
      setActiveScriptSection('writing')
    } catch (uploadError) {
      setError(uploadError.message)
    }
    event.target.value = ''
  }

  const readGenerationResult = (result) => {
    const generatedScript = typeof result === 'string' ? result : result?.script
    if (!generatedScript?.trim()) throw new Error('模型没有返回有效剧本')
    return {
      script: generatedScript,
      warnings: typeof result === 'string' ? [] : result?.warnings || [],
    }
  }

  const expand = async (intent = 'generate') => {
    if (intent === 'revise' && !revisionNote.trim()) {
      setError('请先填写希望修改或补充的内容')
      return
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.generate) {
      setError(`快速生成剧本需要 ${SCRIPT_OPERATION_CREDITS.generate} 积分，当前剩余 ${billing.credits} 积分`)
      return
    }
    setGenerating(true)
    setGenerationPhase('quick')
    setGenerationWarnings([])
    setError('')
    try {
      const result = await onGenerate(
        script,
        direction,
        productionMode,
        episodeDurationSeconds,
        scriptModel,
        intent === 'revise' ? revisionNote : '',
        setGenerationPhase,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings(['剧本已进入后台生成，可离开当前页面；完成或失败后会在右上角通知。'])
        return
      }
      const next = readGenerationResult(result)
      setScript(next.script)
      setHasGeneratedScript(true)
      setGenerationWarnings(next.warnings)
      setSaved(true)
      void suggestAssetsForScript(next.script)
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setGenerating(false)
      setGenerationPhase('idle')
    }
  }

  const generateSegment = async () => {
    if (!script.trim() && !project.synopsis.trim()) {
      setError('请先填写故事简介或已有剧本段落')
      return
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.generate) {
      setError(`生成下一段需要 ${SCRIPT_OPERATION_CREDITS.generate} 积分，当前剩余 ${billing.credits} 积分`)
      return
    }
    setGenerating(true)
    setGenerationPhase('segment')
    setGenerationWarnings([])
    setError('')
    try {
      const result = await onGenerateSegment(
        script,
        direction,
        {
          goal: segmentGoal,
          targetSeconds: segmentDurationSeconds,
          targetMinutes: Math.max(1, Math.ceil(segmentDurationSeconds / 60)),
        },
        productionMode,
        episodeDurationSeconds,
        scriptModel,
        revisionNote,
        setGenerationPhase,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings(['续写任务已进入后台，可继续浏览其他页面。'])
        setSegmentGoal('')
        return
      }
      const next = readGenerationResult(result)
      setScript(next.script)
      setHasGeneratedScript(true)
      setGenerationWarnings(next.warnings)
      setSaved(true)
      setSegmentGoal('')
      void suggestAssetsForScript(next.script)
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setGenerating(false)
      setGenerationPhase('idle')
    }
  }

  const save = async () => {
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return false
    }
    setSaving(true)
    setError('')
    try {
      await onSave(script)
      setSaved(true)
      return true
    } catch (saveError) {
      setError(saveError.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const continueToAssets = async () => {
    if (!saved && !(await save())) return
    onNext()
  }

  return (
    <div className="page editor-page script-page-redesign">
      <PageHeader
        eyebrow="剧本工作台"
        title={`《${project.name}》剧本`}
        description="从一句想法生成可进入分镜的场次剧本。"
      >
        <input ref={fileInput} className="hidden-input" type="file" accept=".txt,.md" onChange={upload} />
        <button className="button secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload size={16} /> 导入文本
        </button>
        <button
          className="button primary"
          disabled={saving || saved || !script.trim()}
          onClick={() => void save()}
        >
          {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
          {saving ? '保存中' : saved ? '已保存' : '保存剧本'}
        </button>
      </PageHeader>

      <section className="script-section-nav" aria-label="剧本工作区小项">
        {SCRIPT_SECTIONS.map(({ id, label, description, status, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={activeScriptSection === id ? 'active' : ''}
            aria-pressed={activeScriptSection === id}
            onClick={() => setActiveScriptSection(id)}
          >
            <Icon size={18} />
            <span>
              <strong>
                {label}
                {status && <em>{status}</em>}
              </strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </section>

      {activeScriptSection === 'novel' && (
        <section className="script-section-panel script-novel-section" aria-label="小说上传与章节">
          <NovelImportPanel
            project={project}
            disabled={busy}
            developmentOnly
            onImportNovel={onImportNovel}
            onPreviewNovelSplit={onPreviewNovelSplit}
            onListNovels={onListNovels}
            onGetNovel={onGetNovel}
            onGetNovelSummaries={onGetNovelSummaries}
            onGenerateNovelSummaries={onGenerateNovelSummaries}
            onGetNovelStoryBible={onGetNovelStoryBible}
            onGenerateNovelStoryBible={onGenerateNovelStoryBible}
            onSuggestNovelAssets={onSuggestNovelAssets}
            onGenerateChapterAdaptation={onGenerateNovelChapterAdaptation}
            onCreateAsset={onCreateAsset}
            onUpload={onUpload}
            aspectRatio={project.aspectRatio}
            onUseAdaptedScript={useAdaptedNovelScript}
          />
        </section>
      )}

      {activeScriptSection === 'long-form' && (
        <LongFormStudioPlaceholder
          source={longFormSource}
          value={longFormDraft}
          shortScript={script}
          onSourceChange={setLongFormSource}
          onChange={setLongFormDraft}
          onSyncShortScript={() => {
            setLongFormSource('short-script')
            setLongFormDraft(script)
          }}
        />
      )}

      {activeScriptSection === 'writing' && (
        <>
          <section className="script-direction-bar script-generation-console" aria-label="剧本生成设置">
            <header className="script-generation-head">
              <div className="script-direction-title">
                <span className="direction-symbol">
                  <Sparkles size={17} />
                </span>
                <div>
                  <span className="eyebrow">AI 编剧</span>
                  <strong>
                    {hasGeneratedScript ? '当前剧本可以重新生成或继续精修' : '从想法生成可直接拆分的场次剧本'}
                  </strong>
                </div>
              </div>
              <div className="script-generation-summary">
                <strong>{count.toLocaleString()} 字</strong>
                <span>
                  {productionMode === 'web-series'
                    ? `${formatEpisodeDuration(episodeDurationSeconds)} / 集`
                    : '15～30 秒短片'}
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
                    <strong>{productionMode === 'web-series' ? '网剧模式' : '短视频模式'}</strong>
                  </div>
                </div>
                <span className="script-format-note">
                  {productionMode === 'web-series'
                    ? '每集结尾自动保留钩子，分镜将承接同一集时长。'
                    : '以 15～30 秒为单位，快速确认故事骨架。'}
                </span>
                {productionMode === 'web-series' && (
                  <label className="script-episode-seconds">
                    <span>每集时长</span>
                    <span className="script-seconds-input">
                      <input
                        aria-label="每集时长（秒）"
                        type="number"
                        min="30"
                        max="300"
                        step="1"
                        value={episodeDurationSeconds}
                        onChange={(event) => setEpisodeDurationSeconds(Number(event.target.value) || 0)}
                        onBlur={() => void commitEpisodeDuration()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitEpisodeDuration()
                        }}
                      />
                      <em>秒</em>
                    </span>
                  </label>
                )}
                <span className="script-format-source">由新建影片的内容类型决定</span>
              </section>

              <section className="script-setting-block script-model-card" aria-label="生成模型">
                <div className="script-setting-label">
                  <strong>生成模型</strong>
                  <small>当前 Provider</small>
                </div>
                <label className="script-control-field">
                  <select value={scriptModel} onChange={(event) => setScriptModel(event.target.value)}>
                    {SCRIPT_MODEL_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
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
                <span className="script-primary-generation-note">剧情结构 · 光影 · 运镜 · 台词</span>
              </div>
            </div>
          </section>

          {generationWarnings.length > 0 && (
            <div className="script-generation-note" role="status">
              <Sparkles size={15} />
              <span>{generationWarnings.slice(0, 2).join('；')}</span>
            </div>
          )}

          {activeScriptTask && (
            <div className="script-background-task" role="status" aria-live="polite">
              <BrandMark spin />
              <div>
                <strong>{activeScriptTask.label}</strong>
                <span>
                  {activeScriptTask.status === 'running'
                    ? `序幕正在生成 · ${scriptTaskStage(activeScriptTask)}`
                    : activeScriptTask.status === 'paused'
                      ? '任务已暂停，可前往生成队列继续'
                      : '已提交模型，正在等待执行'}
                </span>
              </div>
              <small>后台运行中，可以离开本页</small>
            </div>
          )}

          <div className={`script-workspace ${hasGeneratedScript ? 'with-revision-tools' : 'full-width'}`}>
            <section className="script-document" aria-busy={generating}>
              <div className="script-document-toolbar">
                <span className="script-document-toolbar-label">当前剧本正文</span>
                <div className="script-document-status">
                  <span className={saved ? 'saved' : 'unsaved'}>
                    <BadgeCheck size={14} /> {saved ? '已同步' : '未保存'}
                  </span>
                </div>
              </div>
              <div className="script-textarea-wrap">
                <AssetAwareTextarea
                  inputRef={textArea}
                  assets={assets}
                  tasks={tasks}
                  value={script}
                  onChange={(event) => update(event.target.value)}
                  placeholder="写下故事/想法,或导入小说/文本,系统会根据项目已创建的资产/项目概览等信息自动切分章节并生成剧本内容。"
                />
                {generating && (
                  <div className="script-processing-overlay" role="status" aria-live="polite">
                    <LoaderCircle size={25} className="spin" />
                    <strong>
                      {generationPhase === 'segment'
                        ? productionMode === 'web-series'
                          ? '正在承接钩子续写下一集'
                          : '正在续写下一段'
                        : productionMode === 'web-series'
                          ? '正在编排网剧冲突与结尾钩子'
                          : '正在整理快速剧本'}
                    </strong>
                    <span>已等待 {generationSeconds} 秒 · 完成后自动保存并刷新，无需手动操作</span>
                  </div>
                )}
              </div>
              <div className="script-document-footer">
                <AssetShortcutBar
                  assets={assets}
                  tasks={tasks}
                  value={script}
                  onChange={update}
                  inputRef={textArea}
                  placement="top"
                />
                <span>{count} 字</span>
                <span>{paragraphCount} 段</span>
                <span>约 {estimatedMinutes} 分钟</span>
                <button disabled={saving || saved || !script.trim()} onClick={() => void save()}>
                  {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                  {saving ? '保存中' : saved ? '已保存' : '保存'}
                </button>
              </div>
            </section>

            {hasGeneratedScript && (
              <aside className="script-revision-panel" aria-label="剧本后续编辑">
                <header className="script-revision-panel-head">
                  <div>
                    <span className="eyebrow">后续编辑</span>
                    <h2>完善当前剧本</h2>
                  </div>
                  <ScriptHelp label="后续编辑说明">
                    改写会根据意见重写当前内容；追加只在末尾续写新场次，不会覆盖已有剧本。
                  </ScriptHelp>
                </header>

                <section className="script-revision-tool">
                  <div className="script-revision-tool-title">
                    <strong>按要求改写</strong>
                    <ScriptHelp label="剧本改写说明">
                      根据你的修改意见重写当前剧本，保留已有故事和资产设定。
                    </ScriptHelp>
                  </div>
                  <textarea
                    value={revisionNote}
                    rows={4}
                    maxLength={2_000}
                    placeholder="例如：保留人物关系，减少对白；加强结尾悬念"
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

                <section className="script-revision-tool script-append-tool">
                  <div className="script-revision-tool-title">
                    <strong>剧本追加</strong>
                    <ScriptHelp label="剧本追加说明">
                      读取末尾场次以及前两场连续性，只追加下一段或下一集；网剧模式会承接上一集钩子。
                    </ScriptHelp>
                  </div>
                  <textarea
                    value={segmentGoal}
                    rows={3}
                    maxLength={500}
                    placeholder="下一段要发生什么（可选）"
                    onChange={(event) => setSegmentGoal(event.target.value)}
                  />
                  <label className="script-append-duration">
                    <span>目标时长</span>
                    <select
                      value={segmentDurationSeconds}
                      onChange={(event) => setSegmentDurationSeconds(Number(event.target.value))}
                    >
                      {(productionMode === 'web-series' ? [30, 60, 90, 120, 180, 240, 300] : [15, 30]).map(
                        (seconds) => (
                          <option key={seconds} value={seconds}>
                            {formatEpisodeDuration(seconds)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
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
                        ? void stopScriptTask(
                            activeSegmentTask,
                            productionMode === 'web-series' ? '下一集追加' : '剧本追加',
                          )
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
                          : `${productionMode === 'web-series' ? '追加下一集' : '追加下一段'} · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
                  </button>
                </section>
              </aside>
            )}
          </div>

          <AssetSuggestionsPanel
            status={assetSuggestionStatus}
            result={assetSuggestionResult}
            error={assetSuggestionError}
            creatingKeys={creatingAssetKeys}
            createdKeys={createdAssetKeys}
            onRefresh={() => void suggestAssetsForScript(script)}
            onInspect={openSuggestedAssetEditor}
          />

          {error && (
            <p className="operation-error" role="alert">
              {error}
            </p>
          )}

          <section className="script-flow-actions">
            <div>
              <span className="eyebrow">下一步</span>
              <strong>从当前剧本建立核心资产</strong>
              <small>{saved ? '当前版本已保存' : '继续时会先保存当前版本'}</small>
            </div>
            <div>
              <button
                className="button primary"
                disabled={busy || !script.trim()}
                onClick={() => void continueToAssets()}
              >
                进入资产设计 <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </>
      )}

      {suggestedAssetEditor && (
        <AssetEditor
          key={suggestedAssetEditor.editorKey}
          asset={suggestedAssetEditor}
          aspectRatio={project.aspectRatio}
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
    </div>
  )
}

function ScriptHelp({ label, children }) {
  return (
    <span className="script-inline-help" tabIndex={0} aria-label={label}>
      <CircleHelp size={14} />
      <span role="tooltip">{children}</span>
    </span>
  )
}

function formatEpisodeDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  if (value >= 60) {
    const minutes = Math.floor(value / 60)
    const remainder = value % 60
    return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
  }
  return `${value} 秒`
}

function isQueuedTextTask(result) {
  return Boolean(result?.kind === 'text' && ['queued', 'running', 'paused'].includes(result.status))
}

function isAssetSuggestionResult(value) {
  return Boolean(
    value && typeof value === 'object' && typeof value.summary === 'string' && Array.isArray(value.assets),
  )
}

function scriptSuggestionFingerprint(value) {
  let hash = 2166136261
  for (const character of value.trim()) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return `${value.trim().length}:${(hash >>> 0).toString(16)}`
}

function scriptTaskOperation(task) {
  if (task?.metadata?.mode === 'segment') return 'segment'
  if (task?.metadata?.scriptOperation === 'enrich') return 'enrich'
  if (task?.metadata?.scriptOperation === 'generate' && String(task.metadata?.revisionNote || '').trim()) {
    return 'revise'
  }
  return 'generate'
}

function scriptTaskStage(task) {
  const elapsedSeconds = Math.max(0, (Date.now() - Date.parse(task.updatedAt || task.createdAt)) / 1_000)
  if (elapsedSeconds < 4) return '整理项目与资产上下文'
  if (elapsedSeconds < 10) return '调用编剧模型'
  return '撰写并校验剧本结构'
}
