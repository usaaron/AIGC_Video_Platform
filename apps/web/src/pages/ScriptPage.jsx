import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
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
import { AssetSuggestionsPanel, assetSuggestionKey } from '../features/script/AssetSuggestionsPanel'
import { suggestionToAssetInput } from '../features/script/assetSuggestionInput'
import {
  DEFAULT_SCRIPT_MODEL,
  DEFAULT_SCRIPT_DIRECTION,
  SCRIPT_MODEL_CATALOG,
  SCRIPT_OPERATION_CREDITS,
} from '@seqora/contracts'

const SCRIPT_CONTENT_CONFIGS = {
  'short-drama': {
    productionMode: 'web-series',
    pageTitle: '网剧剧本',
    pageDescription: '一次生成一集，快速得到可继续拆分镜的网剧制作稿。',
    initialTitle: '从想法快速生成一集网剧',
    generatedTitle: '当前单集可以重新生成或继续精修',
    modeLabel: '单集生成',
    modeNote: '每次固定生成 1 集、6～8 个有效场次；长篇内容请切换到长剧本生成。',
    usesDuration: false,
    durationLabel: '每集时长',
    durationSuffix: '/ 集',
    minimumDuration: 30,
    maximumDuration: 300,
    defaultDuration: 60,
    featureNote: '单次 1 集 · 6～8 场 · 冲突对白 · 结尾钩子',
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
    appendAction: '生成下一集',
  },
  advertisement: {
    productionMode: 'short-video',
    pageTitle: '广告脚本',
    pageDescription: '从传播想法生成带时间码、画面、文案、声音和品牌落版的广告制作稿。',
    initialTitle: '从传播想法生成可直接分镜的广告脚本',
    generatedTitle: '当前广告可以重新生成或继续优化',
    modeLabel: '广告创作模式',
    modeNote: '按目标秒数编排开场抓点、核心价值、可见证明与品牌落版。',
    usesDuration: true,
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
    usesDuration: true,
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
    label: '单集生成',
    description: '一次生成 1 集，快速进入资产与分镜',
    icon: Clapperboard,
  },
  {
    id: 'long-form',
    label: '长剧本生成',
    description: '进入外部研发的剧本大师',
    status: '外部模块',
    icon: BookOpenText,
  },
]

function looksLikeDevelopedScript(value) {
  const source = value.trim()
  return source.length >= 300 || /(?:场景|场次|剧情|角色)[：:]/.test(source)
}

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
  onOpenLongForm,
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
  const orderedEpisodes = [...scriptEpisodes].sort((left, right) => left.episodeNumber - right.episodeNumber)
  const initialDraftEpisode = orderedEpisodes.find((episode) => episode.status === 'draft')
  const productionMode = contentConfig.productionMode
  const usesDuration = contentConfig.usesDuration !== false
  // Fail closed when the health check did not confirm a usable text provider.
  const textGenerationUnavailable = textProviderStatus !== 'configured'
  const textGenerationStatusMessage =
    textProviderStatus === 'unavailable'
      ? '当前预发环境未配置可用的文本模型，已暂停无效提交；配置完成后刷新页面即可生成。'
      : '暂时无法确认文本模型状态，已暂停无效提交；请刷新页面后重试。'
  const defaultEpisodeSeconds = project.episodeDurationSeconds || contentConfig.defaultDuration
  const [activeEpisodeId, setActiveEpisodeId] = useState(initialDraftEpisode?.id || null)
  const [script, setScript] = useState(
    initialDraftEpisode?.draftContent ||
      initialDraftEpisode?.content ||
      (isSeries && orderedEpisodes.length ? '' : project.script),
  )
  const [direction] = useState(DEFAULT_SCRIPT_DIRECTION)
  const [scriptModel, setScriptModel] = useState(DEFAULT_SCRIPT_MODEL)
  const [revisionNote, setRevisionNote] = useState('')
  const [episodeDurationSeconds, setEpisodeDurationSeconds] = useState(defaultEpisodeSeconds)
  const [segmentGoal, setSegmentGoal] = useState('')
  const [segmentDurationSeconds, setSegmentDurationSeconds] = useState(defaultEpisodeSeconds)
  const [saved, setSaved] = useState(!initialDraftEpisode)
  const [generating, setGenerating] = useState(false)
  const [generationPhase, setGenerationPhase] = useState('idle')
  const [generationSeconds, setGenerationSeconds] = useState(0)
  const [generationWarnings, setGenerationWarnings] = useState([])
  const [saving, setSaving] = useState(false)
  const [hasGeneratedScript, setHasGeneratedScript] = useState(
    () => orderedEpisodes.length > 0 || looksLikeDevelopedScript(project.script),
  )
  const [error, setError] = useState('')
  const [assetSuggestionStatus, setAssetSuggestionStatus] = useState('idle')
  const [assetSuggestionResult, setAssetSuggestionResult] = useState(null)
  const [assetSuggestionError, setAssetSuggestionError] = useState('')
  const [creatingAssetKeys, setCreatingAssetKeys] = useState(() => new Set())
  const [createdAssetKeys, setCreatedAssetKeys] = useState(() => new Set())
  const [suggestedAssetEditor, setSuggestedAssetEditor] = useState(null)
  const [stoppingTaskId, setStoppingTaskId] = useState(null)
  const scriptModelAvailability = new Map(
    scriptModelCapabilities.map((capability) => [capability.id, capability.available]),
  )
  const scriptModelOptions = SCRIPT_MODEL_CATALOG.map((model) => ({
    ...model,
    // During a rolling API/Web deployment, preserve the old conservative GLM fallback until the
    // health response includes per-model capabilities.
    available: scriptModelAvailability.get(model.id) ?? model.id !== 'glm-5.2',
  }))
  const scriptModelCapabilityKey = scriptModelCapabilities
    .map((capability) => `${capability.id}:${capability.available ? '1' : '0'}`)
    .join('|')
  const selectedScriptModelUnavailable =
    scriptModelOptions.find((model) => model.id === scriptModel)?.available === false
  const fileInput = useRef(null)
  const textArea = useRef(null)
  const previewContentRef = useRef(null)
  const activeEpisode = orderedEpisodes.find((episode) => episode.id === activeEpisodeId) || null
  const latestEpisode = orderedEpisodes.at(-1) || null
  const activeEpisodeIndex = activeEpisode
    ? orderedEpisodes.findIndex((episode) => episode.id === activeEpisode.id)
    : -1
  const previousEpisode = activeEpisode ? orderedEpisodes[activeEpisodeIndex - 1] : latestEpisode
  const nextEpisode = activeEpisode ? orderedEpisodes[activeEpisodeIndex + 1] : null
  const episodeSnapshotKey = orderedEpisodes
    .map((episode) => `${episode.id}:${episode.status}:${episode.revision}:${episode.updatedAt}`)
    .join('|')
  const count = script.replace(/\s/g, '').length
  const paragraphCount = script.split(/\n+/).filter(Boolean).length
  const estimatedMinutes = script.trim() ? Math.max(1, Math.ceil(count / 120)) : 0
  const assetSuggestionFingerprint = scriptSuggestionFingerprint(script)
  const currentAssetRevision = assetSuggestionRevision(assets)

  useEffect(() => {
    if (!scriptModelCapabilityKey || !selectedScriptModelUnavailable) return
    const firstAvailable = scriptModelOptions.find((model) => model.available)
    if (firstAvailable) setScriptModel(firstAvailable.id)
  }, [scriptModelCapabilityKey, selectedScriptModelUnavailable])
  const projectTasks = tasks.filter((task) => task.projectId === project.id)
  const scriptTasks = projectTasks
    .filter(
      (task) =>
        task.kind === 'text' &&
        String(task.metadata?.generationStage || '').startsWith('script-') &&
        task.metadata?.scriptOperation !== 'suggest-assets',
    )
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))
  const latestScriptTask = scriptTasks[0]
  const latestFailedScriptTask = latestScriptTask?.status === 'failed' ? latestScriptTask : null
  const latestCompletedScriptTask = latestScriptTask?.status === 'completed' ? latestScriptTask : null
  const completedScriptText = scriptResultText(latestCompletedScriptTask)
  const completedScriptEpisodeId =
    latestCompletedScriptTask?.metadata?.episodeId ||
    latestCompletedScriptTask?.metadata?.textResult?.episode?.id ||
    ''
  const latestAssetSuggestionTask = [...projectTasks]
    .filter(
      (task) =>
        task.kind === 'text' &&
        task.metadata?.scriptOperation === 'suggest-assets' &&
        task.metadata?.sourceScriptFingerprint === assetSuggestionFingerprint &&
        (task.metadata?.assetRevision === currentAssetRevision ||
          (currentAssetRevision === 'none' && !task.metadata?.assetRevision)),
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
  const activeAssetSuggestionTask = ['queued', 'paused', 'running'].includes(
    latestAssetSuggestionTask?.status,
  )
    ? latestAssetSuggestionTask
    : null
  const visibleAssetSuggestionStatus =
    activeAssetSuggestionTask && assetSuggestionStatus === 'idle' ? 'suggesting' : assetSuggestionStatus
  const activeScriptTasks = projectTasks
    .filter(
      (task) =>
        task.kind === 'text' &&
        String(task.metadata?.generationStage || '').startsWith('script-') &&
        task.metadata?.scriptOperation !== 'suggest-assets' &&
        ['queued', 'paused', 'running'].includes(task.status),
    )
    .sort(
      (left, right) =>
        scriptTaskStatusPriority(right) - scriptTaskStatusPriority(left) ||
        taskTimestamp(right) - taskTimestamp(left),
    )
  const activeScriptTaskCandidate = activeScriptTasks[0]
  const activeTaskEpisodeId =
    activeScriptTaskCandidate?.metadata?.mode === 'segment'
      ? ''
      : String(activeScriptTaskCandidate?.metadata?.episodeId || '')
  const activeTaskStartedAt = Date.parse(
    String(
      activeScriptTaskCandidate?.metadata?.localTaskStartedAt || activeScriptTaskCandidate?.createdAt || '',
    ),
  )
  const activeTaskEpisodeById = activeTaskEpisodeId
    ? orderedEpisodes.find((episode) => episode.id === activeTaskEpisodeId)
    : null
  const activeTaskEpisodeByMarker = activeScriptTaskCandidate
    ? orderedEpisodes.find(
        (episode) =>
          episode.continuityState?.generationClientRequestId === activeScriptTaskCandidate.clientRequestId,
      )
    : null
  const activeTaskLegacyEpisode =
    activeScriptTaskCandidate && !activeTaskEpisodeId
      ? [...orderedEpisodes]
          .filter(
            (episode) =>
              episode.status === 'draft' &&
              Boolean((episode.draftContent || '').trim()) &&
              (!Number.isFinite(activeTaskStartedAt) || Date.parse(episode.updatedAt) >= activeTaskStartedAt),
          )
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
      : null
  const activeTaskEpisode =
    activeTaskEpisodeByMarker || activeTaskEpisodeById || activeTaskLegacyEpisode || null
  const activeTaskDraftText = String(activeTaskEpisode?.draftContent || '').trim()
  const activeTaskWritebackMarker = String(
    activeTaskEpisode?.continuityState?.generationClientRequestId || '',
  )
  const activeTaskHasWriteback = Boolean(
    activeScriptTaskCandidate &&
    activeTaskDraftText &&
    (activeTaskWritebackMarker === activeScriptTaskCandidate.clientRequestId ||
      (!activeTaskWritebackMarker &&
        (!Number.isFinite(activeTaskStartedAt) ||
          Date.parse(activeTaskEpisode?.updatedAt || '') >= activeTaskStartedAt))),
  )
  // Once the matching episode draft is durable, the editor is usable immediately.
  // The worker still reconciles the task status in the background.
  const activeScriptTask = activeTaskHasWriteback ? null : activeScriptTaskCandidate
  const activeGenerateTask = activeScriptTask
    ? activeScriptTasks.find((task) => scriptTaskOperation(task) === 'generate')
    : null
  const activeRevisionTask = activeScriptTask
    ? activeScriptTasks.find((task) => scriptTaskOperation(task) === 'revise')
    : null
  const activeSegmentTask = activeScriptTask
    ? activeScriptTasks.find((task) => scriptTaskOperation(task) === 'segment')
    : null
  const activeTextPreview = String(activeScriptTask?.metadata?.textPreview || '')
  const activePreviewSessionKey = activeScriptTask
    ? `${project.id}:${activeScriptTask.id}`
    : `${project.id}:idle`
  const [previewState, setPreviewState] = useState(() => ({
    key: activePreviewSessionKey,
    text: activeTextPreview,
  }))
  const previewTextRef = useRef({ key: activePreviewSessionKey, text: activeTextPreview })
  const previewTimerRef = useRef(null)
  const displayedTextPreview = previewState.key === activePreviewSessionKey ? previewState.text : ''
  const hasDisplayedTextPreview = Boolean(displayedTextPreview.trim())
  const activePreviewStage = String(activeScriptTask?.metadata?.textPreviewStage || 'first-draft')
  const activePreviewValidation = activeScriptTask?.metadata?.textPreviewValidation || null
  const activePreviewEpisodeNumber =
    activeTaskEpisode?.episodeNumber ||
    activeEpisode?.episodeNumber ||
    (isSeries ? orderedEpisodes.length + 1 : null)
  const latestScriptTimingTask = [...projectTasks]
    .filter(
      (task) =>
        task.kind === 'text' &&
        task.metadata?.scriptOperation !== 'suggest-assets' &&
        task.metadata?.textTiming &&
        typeof task.metadata.textTiming === 'object',
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
  const latestTextTiming = latestScriptTimingTask?.metadata?.textTiming || null
  const scriptGenerationBusy = generating || Boolean(activeScriptTask)
  const busy = generating || saving || Boolean(activeScriptTask)
  const hasActiveScriptTask = Boolean(activeScriptTask)

  const clearPreviewAnimation = () => {
    if (previewTimerRef.current === null) return
    window.clearInterval(previewTimerRef.current)
    previewTimerRef.current = null
  }

  useEffect(() => {
    if (!hasActiveScriptTask) {
      clearPreviewAnimation()
      if (completedScriptText) {
        previewTextRef.current = { key: activePreviewSessionKey, text: completedScriptText }
        setPreviewState({ key: activePreviewSessionKey, text: completedScriptText })
      } else {
        previewTextRef.current = { key: activePreviewSessionKey, text: '' }
        setPreviewState({ key: activePreviewSessionKey, text: '' })
      }
      return undefined
    }

    clearPreviewAnimation()
    const current = previewTextRef.current
    const base =
      current.key === activePreviewSessionKey && activeTextPreview.startsWith(current.text)
        ? current.text
        : current.key === activePreviewSessionKey
          ? commonPrefix(current.text, activeTextPreview)
          : ''
    previewTextRef.current = { key: activePreviewSessionKey, text: base }
    setPreviewState({ key: activePreviewSessionKey, text: base })
    if (!activeTextPreview.trim() || base === activeTextPreview) return undefined

    // Keep the preview calm while still catching up quickly when the API returns a larger chunk.
    const timer = window.setInterval(() => {
      const currentText = previewTextRef.current
      if (currentText.key !== activePreviewSessionKey) {
        window.clearInterval(timer)
        if (previewTimerRef.current === timer) previewTimerRef.current = null
        return
      }
      if (currentText.text === activeTextPreview) {
        window.clearInterval(timer)
        if (previewTimerRef.current === timer) previewTimerRef.current = null
        return
      }
      const remaining = activeTextPreview.length - currentText.text.length
      const step = remaining > 1_200 ? 6 : remaining > 400 ? 3 : 1
      const nextText = activeTextPreview.slice(
        0,
        Math.min(activeTextPreview.length, currentText.text.length + step),
      )
      previewTextRef.current = { key: activePreviewSessionKey, text: nextText }
      setPreviewState({ key: activePreviewSessionKey, text: nextText })
    }, 8)
    previewTimerRef.current = timer

    return () => {
      window.clearInterval(timer)
      if (previewTimerRef.current === timer) previewTimerRef.current = null
    }
  }, [activePreviewSessionKey, activeTextPreview, completedScriptText, hasActiveScriptTask])

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

  useEffect(() => {
    const previewElement = previewContentRef.current
    if (previewElement) previewElement.scrollTop = previewElement.scrollHeight
  }, [displayedTextPreview])

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
      const draftEpisode = orderedEpisodes.find((episode) => episode.status === 'draft')
      setActiveEpisodeId(draftEpisode?.id || null)
      setScript(
        draftEpisode?.draftContent || draftEpisode?.content || (orderedEpisodes.length ? '' : project.script),
      )
      setSaved(!draftEpisode)
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
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
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
      return
    }
    if (latestAssetSuggestionTask.status === 'cancelled') {
      setAssetSuggestionResult(null)
      setAssetSuggestionError('')
      setAssetSuggestionStatus((current) => (current === 'extracting' ? current : 'idle'))
    }
  }, [latestAssetSuggestionTask])

  const update = (value) => {
    setScript(value)
    setSaved(false)
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
  }

  const openEpisode = (episode) => {
    if (!saved && script.trim() && !window.confirm('当前修改尚未保存，切换后会丢失。继续吗？')) return
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
      const task = await onSuggestAssets(source, direction, scriptSuggestionFingerprint(source))
      if (!isQueuedTextTask(task)) {
        const cachedResult = task?.metadata?.textResult
        setAssetSuggestionResult(cachedResult && typeof cachedResult === 'object' ? cachedResult : task)
        setAssetSuggestionStatus('ready')
      }
      setCreatedAssetKeys(new Set())
    } catch (suggestError) {
      setAssetSuggestionError(suggestError.message)
      setAssetSuggestionStatus('ready')
    }
  }

  const stopAssetSuggestions = async () => {
    if (!activeAssetSuggestionTask || !onCancelTask || stoppingTaskId) return
    setStoppingTaskId(activeAssetSuggestionTask.id)
    setAssetSuggestionError('')
    try {
      await onCancelTask(activeAssetSuggestionTask.id, '已停止资产分析，其他剧本任务可继续运行')
      setAssetSuggestionStatus('idle')
      setAssetSuggestionResult(null)
    } catch (stopError) {
      setAssetSuggestionError(stopError.message)
    } finally {
      setStoppingTaskId(null)
    }
  }

  const extractAssetsFast = async () => {
    const source = script.trim()
    if (!source || !onSuggestAssetsFast || stoppingTaskId) return
    setAssetSuggestionStatus('extracting')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    try {
      if (activeAssetSuggestionTask && onCancelTask) {
        setStoppingTaskId(activeAssetSuggestionTask.id)
        await onCancelTask(activeAssetSuggestionTask.id, '已切换为剧本快速提取')
      }
      const result = await onSuggestAssetsFast(source, direction)
      if (!isAssetSuggestionResult(result)) throw new Error('快速提取没有返回有效资产，请重试')
      setAssetSuggestionResult(result)
      setAssetSuggestionStatus('ready')
      setCreatedAssetKeys(new Set())
    } catch (extractError) {
      setAssetSuggestionError(extractError.message)
      setAssetSuggestionStatus('ready')
    } finally {
      setStoppingTaskId(null)
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

  const readGenerationResult = (result) => {
    const generatedScript = typeof result === 'string' ? result : result?.script
    if (!generatedScript?.trim()) throw new Error('模型没有返回有效剧本')
    return {
      script: generatedScript,
      warnings: typeof result === 'string' ? [] : result?.warnings || [],
    }
  }

  const expand = async (intent = 'generate') => {
    if (textGenerationUnavailable) {
      setError(
        textProviderStatus === 'unavailable'
          ? '当前文本模型暂不可用，请先配置文本 Provider 后再生成剧本。'
          : '暂时无法确认文本模型状态，请刷新页面后再生成剧本。',
      )
      return
    }
    if (selectedScriptModelUnavailable) {
      setError('当前生成模型未在服务器配置，请选择其他可用模型。')
      return
    }
    if (intent === 'revise' && !revisionNote.trim()) {
      setError('请先填写希望修改或补充的内容')
      return
    }
    let targetEpisode = activeEpisode
    let sourceScript = script
    if (isSeries && intent === 'revise' && !targetEpisode) {
      targetEpisode = [...orderedEpisodes].sort(
        (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )[0]
      if (!targetEpisode) {
        setError('请先生成或填写第 1 集')
        return
      }
      sourceScript = targetEpisode.draftContent || targetEpisode.content
      setActiveEpisodeId(targetEpisode.id)
      setScript(sourceScript)
      setSaved(targetEpisode.status === 'saved')
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
        sourceScript,
        direction,
        productionMode,
        targetDurationSeconds,
        scriptModel,
        intent === 'revise' ? revisionNote : '',
        setGenerationPhase,
        targetEpisode?.id,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings([
          `${contentConfig.documentName}已进入后台生成，可离开当前页面；完成或失败后会在右上角通知。`,
        ])
        return
      }
      const next = readGenerationResult(result)
      setScript(next.script)
      if (isSeries && result?.episode?.id) setActiveEpisodeId(result.episode.id)
      setHasGeneratedScript(true)
      setGenerationWarnings(next.warnings)
      setSaved(!isSeries)
      if (!isSeries) void suggestAssetsForScript(next.script)
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setGenerating(false)
      setGenerationPhase('idle')
    }
  }

  const generateSegment = async () => {
    if (textGenerationUnavailable) {
      setError(
        textProviderStatus === 'unavailable'
          ? '当前文本模型暂不可用，请先配置文本 Provider 后再追加剧本。'
          : '暂时无法确认文本模型状态，请刷新页面后再追加剧本。',
      )
      return
    }
    if (selectedScriptModelUnavailable) {
      setError('当前生成模型未在服务器配置，请选择其他可用模型。')
      return
    }
    const continuationEpisode = isSeries ? latestEpisode : null
    const continuationSource = isSeries
      ? continuationEpisode?.content || continuationEpisode?.draftContent || ''
      : script
    if (!continuationSource.trim() && !project.synopsis.trim()) {
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
        continuationSource,
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
        continuationEpisode?.id,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings(['续写任务已进入后台，可继续浏览其他页面。'])
        setSegmentGoal('')
        return
      }
      const next = readGenerationResult(result)
      setScript(next.script)
      if (isSeries && result?.episode?.id) setActiveEpisodeId(result.episode.id)
      setHasGeneratedScript(true)
      setGenerationWarnings(next.warnings)
      setSaved(!isSeries)
      setSegmentGoal('')
      if (!isSeries) void suggestAssetsForScript(next.script)
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
      if (isSeries) {
        await onSaveEpisode(activeEpisodeId, script)
        setActiveEpisodeId(null)
        setScript('')
        setRevisionNote('')
        setHasGeneratedScript(true)
      } else {
        await onSave(script)
      }
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

  const skipAssetSuggestions = async () => {
    if (activeAssetSuggestionTask && onCancelTask) {
      try {
        setStoppingTaskId(activeAssetSuggestionTask.id)
        await onCancelTask(activeAssetSuggestionTask.id, '已跳过资产建议')
      } catch (skipError) {
        setAssetSuggestionError(skipError.message)
        return
      } finally {
        setStoppingTaskId(null)
      }
    }
    await continueToAssets()
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
      </PageHeader>

      <section className="script-section-nav" aria-label="剧本工作区小项">
        {SCRIPT_SECTIONS.map(({ id, label, description, status, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={id === 'writing' ? 'active' : ''}
            aria-current={id === 'writing' ? 'page' : undefined}
            onClick={() => {
              if (id === 'long-form') onOpenLongForm?.()
            }}
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
                    : isSeries && orderedEpisodes.length > 0 && !activeEpisode
                      ? void generateSegment()
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
                      ? usesDuration
                        ? '正在智能生成'
                        : '正在生成本集'
                      : `${isSeries && orderedEpisodes.length > 0 && !activeEpisode ? `继续生成第 ${orderedEpisodes.length + 1} 集` : usesDuration ? '智能生成' : activeEpisode ? '重新生成本集' : '生成第 1 集'} · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
              </button>
              <span className="script-primary-generation-note">{contentConfig.featureNote}</span>
            </div>
          </div>
        </section>

        {textGenerationUnavailable && (
          <div className="script-generation-note" role="alert">
            <CircleHelp size={15} />
            <span>{textGenerationStatusMessage}</span>
          </div>
        )}

        {latestFailedScriptTask && (
          <div className="script-generation-note script-generation-note-error" role="alert">
            <CircleHelp size={15} />
            <span>
              <strong>本次剧本任务已停止</strong>
              <span>{latestFailedScriptTask.error || '生成未完成，请检查当前草稿后重试。'}</span>
              <small>已生成的剧集草稿不会被删除；请先保存当前剧集，再继续生成下一集。</small>
            </span>
          </div>
        )}

        {generationWarnings.length > 0 && (
          <div className="script-generation-note" role="status">
            <Sparkles size={15} />
            <span>{generationWarnings.slice(0, 2).join('；')}</span>
          </div>
        )}

        {latestTextTiming && <TextTimingSummary timing={latestTextTiming} />}

        <div className={`script-workspace ${hasGeneratedScript ? 'with-revision-tools' : 'full-width'}`}>
          <section className="script-document" aria-busy={busy}>
            <div className="script-document-toolbar">
              <span className="script-document-toolbar-label">
                {isSeries
                  ? activeEpisode?.title || (orderedEpisodes.length ? '等待继续生成' : '第 1 集草稿')
                  : `当前${contentConfig.documentName}`}
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
                    <option value="">继续生成第 {orderedEpisodes.length + 1} 集</option>
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
                    <p>可继续生成第 {orderedEpisodes.length + 1} 集，或从上方剧集导航打开已有内容。</p>
                    <button
                      className="button primary script-continue-episode"
                      type="button"
                      disabled={busy}
                      onClick={() => void generateSegment()}
                    >
                      <Sparkles size={17} /> 继续生成第 {orderedEpisodes.length + 1} 集
                    </button>
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
              <span>{usesDuration ? `约 ${estimatedMinutes} 分钟` : '单集制作单元 · 6～8 场'}</span>
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

        <AssetSuggestionsPanel
          status={visibleAssetSuggestionStatus}
          result={assetSuggestionResult}
          error={assetSuggestionError}
          creatingKeys={creatingAssetKeys}
          createdKeys={createdAssetKeys}
          onRefresh={() => void suggestAssetsForScript(script)}
          onCancel={() => void stopAssetSuggestions()}
          onFastExtract={() => void extractAssetsFast()}
          onSkip={() => void skipAssetSuggestions()}
          stopping={Boolean(stoppingTaskId && stoppingTaskId === activeAssetSuggestionTask?.id)}
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
              disabled={busy || (isSeries ? orderedEpisodes.length === 0 && !script.trim() : !script.trim())}
              onClick={() => void continueToAssets()}
            >
              进入资产设计 <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </>

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

function TextTimingSummary({ timing }) {
  const firstTokenWaitMs = numberOrNull(timing.firstTokenWaitMs)
  const responseHeadersMs = numberOrNull(timing.responseHeadersMs)
  const providerMs = numberOrNull(timing.providerMs ?? timing.generationMs)
  const appProcessingMs = numberOrNull(timing.appProcessingMs)
  const queueWaitMs = numberOrNull(timing.queueWaitMs)
  const totalMs = numberOrNull(timing.totalMs)
  const extraModelCalls = Math.max(0, Number(timing.extraModelCalls) || 0)
  return (
    <section className="script-timing-summary" aria-label="最近一次剧本生成耗时">
      <div>
        <span className="eyebrow">最近一次生成</span>
        <strong>总耗时 {formatMilliseconds(totalMs)}</strong>
      </div>
      <dl>
        <div>
          <dt>排队</dt>
          <dd>{formatMilliseconds(queueWaitMs)}</dd>
        </div>
        <div>
          <dt>连接响应</dt>
          <dd>{formatMilliseconds(responseHeadersMs)}</dd>
        </div>
        <div>
          <dt>响应后首字</dt>
          <dd>{formatMilliseconds(firstTokenWaitMs)}</dd>
        </div>
        <div>
          <dt>模型总耗时</dt>
          <dd>{formatMilliseconds(providerMs)}</dd>
        </div>
        <div>
          <dt>校验与写回</dt>
          <dd>{formatMilliseconds(appProcessingMs)}</dd>
        </div>
      </dl>
      {extraModelCalls > 0 && <small>本次触发 {extraModelCalls} 次额外修复模型调用</small>}
    </section>
  )
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function formatMilliseconds(value) {
  if (value === null) return '未记录'
  if (value < 1_000) return `${Math.round(value)}ms`
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s`
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

function taskTimestamp(task) {
  const value = Date.parse(task?.updatedAt || task?.createdAt || '')
  return Number.isFinite(value) ? value : 0
}

function scriptTaskStatusPriority(status) {
  if (status === 'running') return 3
  if (status === 'queued') return 2
  if (status === 'paused') return 1
  return 0
}

function scriptResultText(task) {
  const result = task?.metadata?.textResult
  if (typeof result === 'string') return result.trim()
  if (!result || typeof result !== 'object') return ''
  if (typeof result.script === 'string') return result.script.trim()
  if (typeof result.segment === 'string') return result.segment.trim()
  return ''
}

function commonPrefix(left, right) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return left.slice(0, index)
}

function scriptSuggestionFingerprint(value) {
  let hash = 2166136261
  for (const character of value.trim()) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return `${value.trim().length}:${(hash >>> 0).toString(16)}`
}

function assetSuggestionRevision(assets) {
  const revision = (Array.isArray(assets) ? assets : [])
    .map((asset) => `${asset.id}:${asset.updatedAt}`)
    .sort()
    .join('|')
  return revision || 'none'
}

function scriptTaskOperation(task) {
  if (task?.metadata?.mode === 'segment') return 'segment'
  if (task?.metadata?.scriptOperation === 'enrich') return 'revise'
  if (task?.metadata?.scriptOperation === 'generate' && String(task.metadata?.revisionNote || '').trim()) {
    return 'revise'
  }
  return 'generate'
}

function scriptTaskStage(task) {
  if (!task) return ''
  if (task?.metadata?.textPreviewStage) {
    return textPreviewStageLabel(task.metadata.textPreviewStage)
  }
  const elapsedSeconds = Math.max(0, (Date.now() - Date.parse(task.updatedAt || task.createdAt)) / 1_000)
  if (elapsedSeconds < 4) return '整理项目与资产上下文'
  if (elapsedSeconds < 10) return '调用编剧模型'
  return '撰写并校验剧本结构'
}

function textPreviewStageLabel(stage) {
  if (stage === 'scene-completion') return '保留首轮内容，正在补齐缺少场次'
  if (stage === 'structure-repair') return '正在修复场次结构'
  if (stage === 'language-repair') return '正在统一中文与格式'
  return '正在边生成边校验'
}
