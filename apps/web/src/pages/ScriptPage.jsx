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
import { NovelImportPanel } from '../features/novel/NovelImportPanel'
import { QuickStartModal } from '../features/quickStart/QuickStartModal'
import { AssetSuggestionsPanel, assetSuggestionKey } from '../features/script/AssetSuggestionsPanel'
import { LongFormStudioPlaceholder } from '../features/script/LongFormStudioPlaceholder'
import {
  DEFAULT_SCRIPT_MODEL,
  DEFAULT_SCRIPT_DIRECTION,
  FORCE_EPISODE_BREAK_MARKER,
  FORCE_SHOT_BREAK_MARKER,
  SCRIPT_OPERATION_CREDITS,
} from '@seqora/contracts'

const DEFAULT_TEXT_MODEL = 'gpt-5.6'
const TEXT_MODEL_OPTIONS = [
  { value: 'gpt-5.6', label: '序幕-SEQORA 5.6' },
  { value: 'gpt-5.5', label: '序幕-SEQORA 5.5' },
  { value: 'gpt-5.4', label: '序幕-SEQORA 5.4' },
  { value: 'deepseekV3', label: 'DeepSeek V3' },
]

const DIRECTION_FIELDS = [
  {
    key: 'style',
    label: '视觉风格',
    icon: Sparkles,
    options: [
      ['auto', 'AI 自动匹配'],
      ['photorealistic', '仿真人电影感'],
      ['cinematic-cg', '电影级 CG'],
      ['chinese-3d', '国漫三维'],
      ['chinese-2d', '国漫二维'],
      ['anime', '日系动画'],
      ['storybook', '绘本风格'],
    ],
  },
  {
    key: 'composition',
    label: '构图',
    icon: Image,
    options: [
      ['auto', 'AI 自动匹配'],
      ['rule-of-thirds', '三分法'],
      ['centered', '中心构图'],
      ['symmetry', '对称构图'],
      ['negative-space', '留白构图'],
      ['dynamic', '动态斜线'],
    ],
  },
  {
    key: 'lighting',
    label: '光影',
    icon: Lightbulb,
    options: [
      ['auto', 'AI 自动匹配'],
      ['natural-soft', '自然柔光'],
      ['high-contrast', '高反差硬光'],
      ['low-key', '低调暗光'],
      ['backlight', '逆光轮廓光'],
      ['neon', '霓虹彩光'],
    ],
  },
  {
    key: 'camera',
    label: '运镜',
    icon: Camera,
    options: [
      ['auto', 'AI 自动匹配'],
      ['restrained', '克制稳定'],
      ['immersive', '沉浸跟随'],
      ['dynamic', '动态动作'],
      ['documentary', '纪录片手持'],
      ['suspense', '悬疑压迫'],
    ],
  },
]

const FOCUS_OPTIONS = [
  ['balanced', '均衡'],
  ['scene', '场景'],
  ['character', '角色'],
  ['dialogue', '对白'],
]

const INSERT_BLOCKS = [
  {
    key: 'shot',
    label: '添加分镜',
    icon: Clapperboard,
    value: `\n\n${FORCE_SHOT_BREAK_MARKER}\n\n`,
    title: '在光标处插入强制分镜标记，重新拆分时从这里开始新的镜头',
  },
  {
    key: 'episode',
    label: '添加分集',
    icon: BookOpenText,
    value: `\n\n${FORCE_EPISODE_BREAK_MARKER}\n\n`,
    title: '在光标处插入强制分集标记，重新拆分时从这里开始新的一集',
  },
]

const SCRIPT_MODEL_OPTIONS = [
  ['seqora-5.6', '序幕 5.6'],
  ['seqora-op-5', '序幕-op-5'],
  ['kimi-3', 'kimi-3'],
  ['deepseek-v3', 'deepseek-v3'],
  ['qwen3.8', 'qwen3.8'],
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
    label: '小说上传与章节（建议大于1万字时使用）',
    description: '导入长文本，切分章节并生成概要',
    icon: Upload,
  },
  {
    id: 'long-form',
    label: '长剧本创作',
    description: '大纲、人物与世界设定',
    status: '待开发',
    icon: BookOpenText,
  },
]

function hasProfessionalVisualFields(value) {
  const scenes = value
    .split(/\n+/)
    .map((scene) => scene.trim())
    .filter(Boolean)
    .filter(
      (scene) => !scene.includes(FORCE_EPISODE_BREAK_MARKER) && !scene.includes(FORCE_SHOT_BREAK_MARKER),
    )
  const fields = ['风格', '构图', '光影', '运镜', '衔接']
  return (
    scenes.length > 0 &&
    scenes.every((scene) => fields.every((field) => new RegExp(`${field}[：:]`).test(scene)))
  )
}

function looksLikeDevelopedScript(value) {
  const source = value.trim()
  return source.length >= 300 || /(?:场景|场次|剧情|角色)[：:]/.test(source)
}

export function ScriptPage({
  project,
  billing,
  tasks = [],
  onSave,
  onGenerate,
  onGenerateSegment,
  onEnrich,
  onImportNovel,
  onPreviewNovelSplit,
  onListNovels,
  onGetNovel,
  onGetNovelSummaries,
  onGenerateNovelSummaries,
  onGetNovelStoryBible,
  onGenerateNovelStoryBible,
  onGenerateNovelChapterAdaptation,
  onSuggestNovelAssets,
  onSuggestAssets,
  onEnrich,
  onCreateAsset,
  onUpload,
  onPlanQuickStart,
  onExecuteQuickStart,
  onCancelTask,
  onNext,
}) {
  const [script, setScript] = useState(project.script)
  const [direction] = useState(DEFAULT_SCRIPT_DIRECTION)
  const [scriptModel, setScriptModel] = useState(DEFAULT_SCRIPT_MODEL)
  const [revisionNote, setRevisionNote] = useState('')
  const [productionMode, setProductionMode] = useState('short-video')
  const [episodeMinutes, setEpisodeMinutes] = useState(1)
  const [segmentGoal, setSegmentGoal] = useState('')
  const [segmentMinutes, setSegmentMinutes] = useState(1)
  const [saved, setSaved] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [generationPhase, setGenerationPhase] = useState('idle')
  const [generationSeconds, setGenerationSeconds] = useState(0)
  const [needsVisualDetail, setNeedsVisualDetail] = useState(
    () => Boolean(project.script.trim()) && !hasProfessionalVisualFields(project.script),
  )
  const [generationWarnings, setGenerationWarnings] = useState([])
  const [saving, setSaving] = useState(false)
  const [hasGeneratedScript, setHasGeneratedScript] = useState(() => looksLikeDevelopedScript(project.script))
  const [activeScriptSection, setActiveScriptSection] = useState('writing')
  const [longFormSource, setLongFormSource] = useState('short-script')
  const [longFormDraft, setLongFormDraft] = useState('')
  const [error, setError] = useState('')
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const [quickStartState, setQuickStartState] = useState('idle')
  const [quickStartPlan, setQuickStartPlan] = useState(null)
  const [quickStartResult, setQuickStartResult] = useState(null)
  const [quickStartError, setQuickStartError] = useState('')
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
  const activeScriptTasks = tasks.filter(
    (task) =>
      task.kind === 'text' &&
      String(task.metadata?.generationStage || '').startsWith('script-') &&
      ['queued', 'paused', 'running'].includes(task.status),
  )
  const activeScriptTask = activeScriptTasks[0]
  const activeGenerateTask = activeScriptTasks.find((task) => scriptTaskOperation(task) === 'generate')
  const activeRevisionTask = activeScriptTasks.find((task) => scriptTaskOperation(task) === 'revise')
  const activeEnrichTask = activeScriptTasks.find((task) => scriptTaskOperation(task) === 'enrich')
  const activeSegmentTask = activeScriptTasks.find((task) => scriptTaskOperation(task) === 'segment')
  const busy =
    generating || enriching || saving || quickStartState === 'starting' || Boolean(activeScriptTask)

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
    setRevisionNote('')
    setSaved(true)
    setError('')
    setHasGeneratedScript(looksLikeDevelopedScript(project.script))
    setNeedsVisualDetail(Boolean(project.script.trim()) && !hasProfessionalVisualFields(project.script))
  }, [project.id, project.script])

  useEffect(() => {
    setLongFormSource('short-script')
    setLongFormDraft('')
  }, [project.id])

  useEffect(() => {
    if (!generating && !enriching) return undefined
    const startedAt = Date.now()
    setGenerationSeconds(0)
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1_000))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [generating, enriching])

  useEffect(() => {
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    setCreatingAssetKeys(new Set())
    setCreatedAssetKeys(cachedAssetSuggestions?.createdKeys || new Set())
  }, [project.id, project.script])

  useEffect(() => {
    setQuickStartOpen(false)
    setQuickStartState('idle')
    setQuickStartPlan(null)
    setQuickStartResult(null)
    setQuickStartError('')
  }, [project.id])

  const update = (value) => {
    setScript(value)
    setSaved(false)
    setAssetSuggestionStatus('idle')
    setAssetSuggestionError('')
  }

  const suggestAssetsForScript = async (value) => {
    const source = value.trim()
    if (!source) return
    setAssetSuggestionStatus('suggesting')
    setAssetSuggestionError('')
    try {
      setAssetSuggestionResult(await onSuggestAssets(source, direction))
      setCreatedAssetKeys(new Set())
      saveScriptAssetSuggestionsCache(project.id, source, direction, textModel, result, [])
    } catch (suggestError) {
      setAssetSuggestionError(suggestError.message)
    } finally {
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

  const insert = (value) => {
    const element = textArea.current
    const start = element?.selectionStart ?? script.length
    const end = element?.selectionEnd ?? script.length
    const prefix =
      script && start === 0 ? '' : script && !script.endsWith('\n') && start === script.length ? '\n\n' : ''
    const next = `${script.slice(0, start)}${prefix}${value}${script.slice(end)}`
    update(next)
    requestAnimationFrame(() => {
      element?.focus()
      const cursor = start + prefix.length + value.length
      element?.setSelectionRange(cursor, cursor)
    })
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
        episodeMinutes,
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
      setNeedsVisualDetail(true)
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
        { goal: segmentGoal, targetMinutes: segmentMinutes },
        productionMode,
        episodeMinutes,
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
      setNeedsVisualDetail(true)
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

  const enrich = async () => {
    if (!script.trim()) {
      setError('请先生成或填写剧本')
      return
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.enrich) {
      setError(
        `补齐专业视觉细节需要 ${SCRIPT_OPERATION_CREDITS.enrich} 积分，当前剩余 ${billing.credits} 积分`,
      )
      return
    }
    setEnriching(true)
    setGenerationPhase('enriching')
    setGenerationWarnings([])
    setError('')
    try {
      const result = await onEnrich(
        script,
        direction,
        productionMode,
        episodeMinutes,
        scriptModel,
        revisionNote,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings(['镜头语言补齐已进入后台，完成后会自动更新剧本。'])
        return
      }
      const next = readGenerationResult(result)
      setScript(next.script)
      setHasGeneratedScript(true)
      setNeedsVisualDetail(false)
      setGenerationWarnings(next.warnings)
      setSaved(true)
      void suggestAssetsForScript(next.script)
    } catch (enrichError) {
      setError(enrichError.message)
    } finally {
      setEnriching(false)
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

  const openQuickStart = async () => {
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return
    }
    setQuickStartOpen(true)
    setQuickStartState('analyzing')
    setQuickStartPlan(null)
    setQuickStartResult(null)
    setQuickStartError('')
    try {
      if (!saved && !(await save())) throw new Error('剧本保存失败')
      setQuickStartPlan(await onPlanQuickStart(textModel))
      setQuickStartState('ready')
    } catch (quickError) {
      setQuickStartError(quickError.message)
      setQuickStartState('error')
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
          disabled={busy || saved || !script.trim()}
          onClick={() => void save()}
        >
          {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
          {saving ? '保存中' : saved ? '已保存' : '保存剧本'}
        </button>
        <button
          className="button quick-start-trigger"
          disabled={busy || !script.trim()}
          onClick={() => void openQuickStart()}
        >
          <Sparkles size={16} /> 一键尝鲜
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
            textModel={textModel}
            disabled={busy}
            onImportNovel={onImportNovel}
            onPreviewNovelSplit={onPreviewNovelSplit}
            onListNovels={onListNovels}
            onGetNovel={onGetNovel}
            onGetNovelSummaries={onGetNovelSummaries}
            onGenerateNovelSummaries={onGenerateNovelSummaries}
            onGetNovelStoryBible={onGetNovelStoryBible}
            onGenerateNovelStoryBible={onGenerateNovelStoryBible}
            onSuggestNovelAssets={onSuggestNovelAssets}
            aspectRatio={project.aspectRatio}
            onGenerateChapterAdaptation={onGenerateNovelChapterAdaptation}
            onCreateAsset={onCreateAsset}
            onUpload={onUpload}
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
                  {productionMode === 'web-series' ? `${episodeMinutes} 分钟 / 集` : '15～30 秒短视频'}
                </span>
              </div>
            </header>

            <div className="script-generation-controls">
              <section className="script-setting-block script-mode-card" aria-label="制作模式">
                <div className="script-setting-label">
                  <strong>制作模式</strong>
                  <small>决定场次节奏</small>
                </div>
                <div className="script-mode-switch" role="group" aria-label="剧本制作模式">
                  <button
                    type="button"
                    className={productionMode === 'short-video' ? 'active' : ''}
                    aria-pressed={productionMode === 'short-video'}
                    onClick={() => {
                      setProductionMode('short-video')
                      setSegmentMinutes(1)
                    }}
                  >
                    <span>短视频</span>
                    <span className="script-mode-help" tabIndex={0} aria-label="短视频模式说明">
                      <CircleHelp size={13} />
                      <span role="tooltip">适合 15 到 30 秒内容，快速确认故事骨架。</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={productionMode === 'web-series' ? 'active' : ''}
                    aria-pressed={productionMode === 'web-series'}
                    onClick={() => {
                      setProductionMode('web-series')
                      setSegmentMinutes(episodeMinutes)
                    }}
                  >
                    <span>网剧模式</span>
                    <span className="script-mode-help" tabIndex={0} aria-label="网剧模式说明">
                      <CircleHelp size={13} />
                      <span role="tooltip">每集 1 到 5 分钟，最后一场保留悬念钩子。</span>
                    </span>
                  </button>
                </div>
                {productionMode === 'web-series' && (
                  <label className="script-episode-duration">
                    <span>每集</span>
                    <select
                      value={episodeMinutes}
                      onChange={(event) => {
                        const minutes = Number(event.target.value)
                        setEpisodeMinutes(minutes)
                        setSegmentMinutes(minutes)
                      }}
                    >
                      {[1, 2, 3, 4, 5].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} 分钟
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
                    quickStartState === 'starting' ||
                    (Boolean(activeScriptTask) && !activeGenerateTask) ||
                    (generating && !activeGenerateTask) ||
                    Boolean(stoppingTaskId)
                  }
                  onClick={() =>
                    activeGenerateTask
                      ? void stopScriptTask(
                          activeGenerateTask,
                          hasGeneratedScript ? '剧本重生成' : '剧本生成',
                        )
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
                      ? hasGeneratedScript
                        ? '重新生成中 · 点击停止'
                        : '生成中 · 点击停止'
                      : generating && generationPhase !== 'segment'
                        ? hasGeneratedScript
                          ? '正在重新生成'
                          : '正在生成剧本'
                        : `${hasGeneratedScript ? '重新生成' : '生成剧本'} · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
                </button>
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
            <section className="script-document" aria-busy={generating || enriching}>
              <div className="script-document-toolbar">
                <div className="script-block-actions" role="group" aria-label="插入剧本结构">
                  {INSERT_BLOCKS.map(({ key, label, icon: Icon, value, title }) => (
                    <button
                      type="button"
                      className="format-button"
                      key={key}
                      title={title}
                      onClick={() => insert(value)}
                    >
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
                <div className="script-document-status">
                  <span className={saved ? 'saved' : 'unsaved'}>
                    <BadgeCheck size={14} /> {saved ? '已同步' : '未保存'}
                  </span>
                </div>
              </div>
              <div className="script-textarea-wrap">
                <textarea
                  ref={textArea}
                  value={script}
                  onChange={(event) => update(event.target.value)}
                  placeholder="写下故事/想法,或导入小说/文本,系统会根据项目已创建的资产/项目概览等信息自动切分章节并生成剧本内容。"
                />
                {(generating || enriching) && (
                  <div className="script-processing-overlay" role="status" aria-live="polite">
                    <LoaderCircle size={25} className="spin" />
                    <strong>
                      {enriching
                        ? '正在按场次补齐剧情、动作、表演、风格、构图、光影、运镜与衔接'
                        : generationPhase === 'segment'
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
                <span>{count} 字</span>
                <span>{paragraphCount} 段</span>
                <span>约 {estimatedMinutes} 分钟</span>
                <button disabled={busy || saved || !script.trim()} onClick={() => void save()}>
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
                    <strong>改写 / 补充</strong>
                    <ScriptHelp label="改写与补充说明">
                      “按要求改写”处理剧情意见；“补齐制作字段”按场次补充动作、表演、构图、光影、运镜和衔接。
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
                        quickStartState === 'starting' ||
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
                    <button
                      type="button"
                      className={`button direction-detail-button ${needsVisualDetail ? 'recommended' : ''} ${
                        activeEnrichTask || enriching ? 'is-generating' : ''
                      }`}
                      disabled={
                        saving ||
                        quickStartState === 'starting' ||
                        !script.trim() ||
                        (Boolean(activeScriptTask) && !activeEnrichTask) ||
                        (enriching && !activeEnrichTask) ||
                        Boolean(stoppingTaskId)
                      }
                      onClick={() =>
                        activeEnrichTask
                          ? void stopScriptTask(activeEnrichTask, '制作字段补齐')
                          : void enrich()
                      }
                    >
                      {activeEnrichTask || enriching ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <Clapperboard size={15} />
                      )}
                      {stoppingTaskId === activeEnrichTask?.id
                        ? '正在停止'
                        : activeEnrichTask
                          ? '补齐中 · 点击停止'
                          : enriching
                            ? '正在补齐'
                            : `补齐制作字段 · ${SCRIPT_OPERATION_CREDITS.enrich} 积分`}
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
                      value={segmentMinutes}
                      onChange={(event) => setSegmentMinutes(Number(event.target.value))}
                    >
                      {(productionMode === 'web-series' ? [1, 2, 3, 4, 5] : [1, 3, 5, 8, 10, 15]).map(
                        (minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} 分钟
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
                      quickStartState === 'starting' ||
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

          {enrichWarnings.length > 0 && (
            <div className="script-enrich-warnings" role="status">
              {enrichWarnings.slice(0, 3).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}

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
            setCreatedAssetKeys((current) => {
              const next = new Set(current).add(suggestedAssetEditor.suggestionKey)
              saveScriptAssetSuggestionsCache(
                project.id,
                script,
                direction,
                textModel,
                assetSuggestionResult,
                next,
              )
              return next
            })
            setSuggestedAssetEditor(null)
            return created
          }}
        />
      )}

      {quickStartOpen && (
        <QuickStartModal
          state={quickStartState}
          plan={quickStartPlan}
          result={quickStartResult}
          error={quickStartError}
          credits={billing.credits}
          onClose={() => quickStartState !== 'starting' && setQuickStartOpen(false)}
          onRetry={() => void openQuickStart()}
          onStart={async () => {
            setQuickStartState('starting')
            setQuickStartError('')
            try {
              const result = await onExecuteQuickStart({
                clientRequestId: crypto.randomUUID(),
                sourceScriptHash: quickStartPlan.sourceScriptHash,
                assets: quickStartPlan.assets,
              })
              setQuickStartResult(result)
              setQuickStartState('complete')
            } catch (quickError) {
              setQuickStartError(quickError.message)
              setQuickStartState('ready')
            }
          }}
          onViewAssets={() => {
            setQuickStartOpen(false)
            onNext()
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

function isQueuedTextTask(result) {
  return Boolean(result?.kind === 'text' && ['queued', 'running', 'paused'].includes(result.status))
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
