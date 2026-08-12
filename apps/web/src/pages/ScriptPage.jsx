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
import { suggestionToAssetInput } from '../features/script/assetSuggestionInput'
import { LongFormStudioPlaceholder } from '../features/script/LongFormStudioPlaceholder'
import { DEFAULT_SCRIPT_MODEL, DEFAULT_SCRIPT_DIRECTION, SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'

const SCRIPT_MODEL_OPTIONS = [
  ['seqora-5.6', '序幕TV 5.6'],
  ['gpt-5.6-terra', '序幕TV 5.6 Terra'],
  ['kimi-k3', 'Kimi K3'],
  ['glm-5.2', 'GLM 5.2'],
  ['glm-5.2-fast', 'GLM 5.2 Fast'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
]

const SCRIPT_CONTENT_CONFIGS = {
  'short-drama': {
    productionMode: 'web-series',
    pageTitle: '网剧剧本',
    pageDescription: '从一句想法生成按集、按场次衔接的网剧制作稿。',
    initialTitle: '从想法生成可直接拆分的网剧场次',
    generatedTitle: '当前网剧可以重新生成或继续精修',
    modeLabel: '网剧创作模式',
    modeNote: '按每集目标时长编排冲突、快切场次和结尾钩子。',
    durationLabel: '每集时长',
    durationSuffix: '/ 集',
    minimumDuration: 30,
    maximumDuration: 300,
    defaultDuration: 60,
    featureNote: '冲突节奏 · 光影运镜 · 多类台词 · 结尾钩子',
    documentName: '网剧剧本',
    placeholder: '写下本集故事、冲突或已有剧本，系统会结合项目资产扩写成可制作的网剧场次。',
    progressText: '正在编排网剧冲突、表演节拍与结尾钩子',
    revisionTitle: '完善当前网剧',
    revisionHelp: '改写会按意见重写当前一集；续写只在末尾生成下一集，不会覆盖已有剧本。',
    revisionPlaceholder: '例如：保留人物关系，加强中段阻力和结尾反击前的钩子',
    appendTitle: '续写下一集',
    appendHelp: '承接当前结尾的人物、动作和物件状态，生成下一集并保留新的结尾钩子。',
    appendPlaceholder: '下一集要发生什么（可选）',
    appendDurationLabel: '下一集时长',
    appendAction: '追加下一集',
  },
  advertisement: {
    productionMode: 'short-video',
    pageTitle: '广告脚本',
    pageDescription: '从传播想法生成带时间码、画面、文案、声音和品牌落版的广告制作稿。',
    initialTitle: '从传播想法生成可直接分镜的广告脚本',
    generatedTitle: '当前广告可以重新生成或继续优化',
    modeLabel: '广告创作模式',
    modeNote: '按目标秒数编排开场抓点、核心价值、可见证明与品牌落版。',
    durationLabel: '广告时长',
    durationSuffix: '成片',
    minimumDuration: 5,
    maximumDuration: 180,
    defaultDuration: 30,
    featureNote: '传播结构 · 产品画面 · 旁白文案 · 品牌落版',
    documentName: '广告脚本',
    placeholder: '写下品牌、产品、受众、核心卖点或一句广告想法，系统会扩写成可执行广告脚本。',
    progressText: '正在编排广告抓点、核心价值与品牌落版',
    revisionTitle: '优化当前广告',
    revisionHelp: '改写会按意见优化整支广告；延长只在末尾补充新段落，不会覆盖已有内容。',
    revisionPlaceholder: '例如：品牌更早出现，只保留一个核心卖点，结尾文案更克制',
    appendTitle: '延长广告脚本',
    appendHelp: '在现有广告末尾补充使用场景或可见证明，并重新完成品牌落版。',
    appendPlaceholder: '希望补充什么场景或信息（可选）',
    appendDurationLabel: '追加时长',
    appendAction: '延长广告',
  },
  animation: {
    productionMode: 'short-video',
    pageTitle: '短片剧本',
    pageDescription: '从一句想法生成有建立、阻力、转折和收束的独立短片制作稿。',
    initialTitle: '从想法生成可直接分镜的完整短片',
    generatedTitle: '当前短片可以重新生成或继续精修',
    modeLabel: '短片创作模式',
    modeNote: '按目标秒数完成角色目标、可见阻力、因果转折与情绪落点。',
    durationLabel: '短片时长',
    durationSuffix: '成片',
    minimumDuration: 10,
    maximumDuration: 300,
    defaultDuration: 30,
    featureNote: '叙事闭环 · 角色行动 · 对白声音 · 镜头衔接',
    documentName: '短片剧本',
    placeholder: '写下人物、处境、冲突或一句短片想法，系统会扩写成有完整结尾的独立短片。',
    progressText: '正在编排短片行动、转折与结尾情绪',
    revisionTitle: '完善当前短片',
    revisionHelp: '改写会按意见优化整支短片；续写只在末尾增加新场次，不会覆盖已有内容。',
    revisionPlaceholder: '例如：减少旁白，让转折由人物行动触发，结尾更有余韵',
    appendTitle: '续写短片',
    appendHelp: '承接当前人物和物件状态继续推进新场次，可按目标要求自然收尾。',
    appendPlaceholder: '接下来要发生什么（可选）',
    appendDurationLabel: '续写时长',
    appendAction: '续写短片',
  },
}

const SCRIPT_SECTIONS = [
  {
    id: 'writing',
    label: '脚本创作（建议小于1万字时使用）',
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
  onCreateAndGenerateAsset,
  onImportAssets,
  onUpload,
  onCancelTask,
  onUpdateEpisodeDuration,
  onNext,
}) {
  const contentConfig = SCRIPT_CONTENT_CONFIGS[project.contentType] || SCRIPT_CONTENT_CONFIGS.animation
  const productionMode = contentConfig.productionMode
  const defaultEpisodeSeconds = project.episodeDurationSeconds || contentConfig.defaultDuration
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

  const normalizeContentDuration = (value) =>
    Math.min(
      contentConfig.maximumDuration,
      Math.max(contentConfig.minimumDuration, Math.round(Number(value) || contentConfig.defaultDuration)),
    )

  const commitEpisodeDuration = async () => {
    const next = normalizeContentDuration(episodeDurationSeconds)
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

  const createAndGenerateSuggestedAsset = async (asset) => {
    if (!onCreateAndGenerateAsset) return
    const key = assetSuggestionKey(asset)
    setCreatingAssetKeys((current) => new Set(current).add(key))
    setAssetSuggestionError('')
    try {
      await onCreateAndGenerateAsset(suggestionToAssetInput(asset))
      setCreatedAssetKeys((current) => new Set(current).add(key))
    } catch (generationError) {
      setAssetSuggestionError(generationError.message)
    } finally {
      setCreatingAssetKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const importSuggestedAssets = async (suggestions) => {
    if (!onImportAssets && !onCreateAsset) return
    setAssetSuggestionError('')
    try {
      const inputs = suggestions.map(suggestionToAssetInput)
      if (onImportAssets) await onImportAssets(inputs)
      else {
        for (const input of inputs) await onCreateAsset(input)
      }
      setCreatedAssetKeys((current) => {
        const next = new Set(current)
        suggestions.forEach((suggestion) => next.add(assetSuggestionKey(suggestion)))
        return next
      })
    } catch (importError) {
      setAssetSuggestionError(importError.message)
    }
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
      setError(
        `智能生成${contentConfig.documentName}需要 ${SCRIPT_OPERATION_CREDITS.generate} 积分，当前剩余 ${billing.credits} 积分`,
      )
      return
    }
    setGenerating(true)
    setGenerationPhase('quick')
    setGenerationWarnings([])
    setError('')
    try {
      const targetDurationSeconds = normalizeContentDuration(episodeDurationSeconds)
      setEpisodeDurationSeconds(targetDurationSeconds)
      const result = await onGenerate(
        script,
        direction,
        productionMode,
        targetDurationSeconds,
        scriptModel,
        intent === 'revise' ? revisionNote : '',
        setGenerationPhase,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings([
          `${contentConfig.documentName}已进入后台生成，可离开当前页面；完成或失败后会在右上角通知。`,
        ])
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
      setError(
        `${contentConfig.appendAction}需要 ${SCRIPT_OPERATION_CREDITS.generate} 积分，当前剩余 ${billing.credits} 积分`,
      )
      return
    }
    setGenerating(true)
    setGenerationPhase('segment')
    setGenerationWarnings([])
    setError('')
    try {
      const targetSegmentSeconds = normalizeContentDuration(segmentDurationSeconds)
      setSegmentDurationSeconds(targetSegmentSeconds)
      const result = await onGenerateSegment(
        script,
        direction,
        {
          goal: segmentGoal,
          targetSeconds: targetSegmentSeconds,
          targetMinutes: Math.max(1, Math.ceil(targetSegmentSeconds / 60)),
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
        eyebrow="AI 创作工作台"
        title={`《${project.name}》${contentConfig.pageTitle}`}
        description={contentConfig.pageDescription}
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
          {saving ? '保存中' : saved ? '已保存' : `保存${contentConfig.documentName}`}
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
            onImportAssets={onImportAssets}
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
                    {hasGeneratedScript ? contentConfig.generatedTitle : contentConfig.initialTitle}
                  </strong>
                </div>
              </div>
              <div className="script-generation-summary">
                <strong>{count.toLocaleString()} 字</strong>
                <span>{`${formatEpisodeDuration(episodeDurationSeconds)} ${contentConfig.durationSuffix}`}</span>
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
                <span className="script-primary-generation-note">{contentConfig.featureNote}</span>
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
                    ? `序幕TV 正在生成 · ${scriptTaskStage(activeScriptTask)}`
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
                <span className="script-document-toolbar-label">当前{contentConfig.documentName}</span>
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
                  placeholder={contentConfig.placeholder}
                />
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
                  <label className="script-append-duration">
                    <span>{contentConfig.appendDurationLabel}</span>
                    <span className="script-seconds-input">
                      <input
                        aria-label={`${contentConfig.appendDurationLabel}（秒）`}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={segmentDurationSeconds}
                        onChange={(event) => setSegmentDurationSeconds(event.target.value.replace(/\D/g, ''))}
                        onBlur={() =>
                          setSegmentDurationSeconds(normalizeContentDuration(segmentDurationSeconds))
                        }
                      />
                      <em>秒</em>
                    </span>
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
            onCreateAndGenerate={createAndGenerateSuggestedAsset}
            onImportSelected={importSuggestedAssets}
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
