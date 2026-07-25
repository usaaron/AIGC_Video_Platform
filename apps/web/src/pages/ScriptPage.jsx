import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Clapperboard,
  Clock3,
  Crown,
  Image,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { NovelImportPanel } from '../features/novel/NovelImportPanel'
import { QuickStartModal } from '../features/quickStart/QuickStartModal'
import { AssetSuggestionsPanel, assetSuggestionKey } from '../features/script/AssetSuggestionsPanel'
import { formatOutlineDraft, formatScenesDraft, formatStructureDraft } from '../features/script/outlineDraft'
import { OutlineOptionsPanel } from '../features/script/OutlineOptionsPanel'
import { SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'

const DEFAULT_DIRECTION = {
  style: 'auto',
  composition: 'auto',
  lighting: 'auto',
  camera: 'auto',
  focus: 'balanced',
}

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
    key: 'scene',
    label: '场景卡',
    icon: Image,
    value: '场景：地点｜内/外｜时间｜天气\n画面：环境主体、空间层次、关键道具\n视觉：构图｜光影｜运镜\n',
  },
  {
    key: 'character',
    label: '角色卡',
    icon: UserRound,
    value: '角色：姓名｜身份｜当前目标\n外观：服装、状态、关键识别特征\n动作：起势、过程、结束｜情绪：\n',
  },
  {
    key: 'dialogue',
    label: '对白段',
    icon: MessageSquare,
    value: '对白：\n角色名（情绪/动作）：台词\n反应：对方的表情、视线或动作\n',
  },
]

const SCRIPT_SECTIONS = [
  {
    id: 'writing',
    label: '剧本编写',
    description: '输入、分段生成、保存和检查',
    icon: Clapperboard,
  },
  {
    id: 'novel',
    label: '小说上传与章节',
    description: '导入长篇文本，切分章节并生成概要',
    icon: Upload,
  },
  {
    id: 'outline',
    label: '大纲多方案',
    description: '生成候选大纲、剧情结构和分场剧本',
    icon: Sparkles,
  },
]

const REVIEW_LABELS = {
  plot: '剧情结构',
  character: '角色动机',
  dialogue: '对白表演',
  style: '风格统一',
  composition: '构图执行',
  lighting: '光影设计',
  camera: '运镜节奏',
}

function hasProfessionalVisualFields(value) {
  const scenes = value
    .split(/\n+/)
    .map((scene) => scene.trim())
    .filter(Boolean)
  const fields = ['风格', '构图', '光影', '运镜', '衔接']
  return (
    scenes.length > 0 &&
    scenes.every((scene) => fields.every((field) => new RegExp(`${field}[：:]`).test(scene)))
  )
}

export function ScriptPage({
  project,
  billing,
  onSave,
  onGenerateOutlines,
  onGenerateStructure,
  onGenerateScenes,
  onGenerate,
  onGenerateSegment,
  onEnrich,
  onReview,
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
  onPlanQuickStart,
  onExecuteQuickStart,
  onUpgrade,
  onNext,
}) {
  const [script, setScript] = useState(project.script)
  const [direction, setDirection] = useState(DEFAULT_DIRECTION)
  const [segmentGoal, setSegmentGoal] = useState('')
  const [segmentMinutes, setSegmentMinutes] = useState(5)
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
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [activeScriptSection, setActiveScriptSection] = useState('writing')
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
  const fileInput = useRef(null)
  const textArea = useRef(null)
  const count = script.replace(/\s/g, '').length
  const paragraphCount = script.split(/\n+/).filter(Boolean).length
  const characterCount = script.trim() ? Math.max(1, new Set(script.match(/角色：[^，。]+/g) || []).size) : 0
  const suggestedShots = script.trim() ? Math.min(12, Math.max(1, paragraphCount)) : 0
  const estimatedMinutes = script.trim() ? Math.max(1, Math.ceil(count / 120)) : 0
  const isMember = billing?.plan === 'member'
  const busy = generating || enriching || saving || reviewing || quickStartState === 'starting'

  useEffect(() => {
    setScript(project.script)
    setSaved(true)
    setReview(null)
    setError('')
    setNeedsVisualDetail(Boolean(project.script.trim()) && !hasProfessionalVisualFields(project.script))
  }, [project.id, project.script])

  useEffect(() => {
    setAssetSuggestionStatus('idle')
    setAssetSuggestionResult(null)
    setAssetSuggestionError('')
    setCreatingAssetKeys(new Set())
    setCreatedAssetKeys(new Set())
  }, [project.id])

  useEffect(() => {
    setQuickStartOpen(false)
    setQuickStartState('idle')
    setQuickStartPlan(null)
    setQuickStartResult(null)
    setQuickStartError('')
  }, [project.id])

  useEffect(() => {
    setGenerationWarnings([])
  }, [project.id])

  useEffect(() => {
    if (!generating) return undefined
    const startedAt = Date.now()
    setGenerationSeconds(0)
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1_000))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [generating, enriching])

  const update = (value) => {
    setScript(value)
    setSaved(false)
    setReview(null)
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
    } catch (suggestError) {
      setAssetSuggestionError(suggestError.message)
    } finally {
      setAssetSuggestionStatus('ready')
    }
  }

  const createSuggestedAsset = async (asset) => {
    const key = assetSuggestionKey(asset)
    setCreatingAssetKeys((current) => new Set(current).add(key))
    setAssetSuggestionError('')
    try {
      await onCreateAsset({
        kind: asset.kind,
        sourceMode: 'generate',
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt,
        negativePrompt: asset.negativePrompt,
        attributes: asset.attributes,
        references: [],
        imageUrl: null,
      })
      setCreatedAssetKeys((current) => new Set(current).add(key))
    } catch (createError) {
      setAssetSuggestionError(createError.message)
    } finally {
      setCreatingAssetKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const useOutline = (outline) => {
    const nextScript = formatOutlineDraft(outline)
    update(nextScript)
    setActiveScriptSection('writing')
    setNeedsVisualDetail(false)
    setGenerationWarnings([])
    setError('')
    void suggestAssetsForScript(nextScript)
    requestAnimationFrame(() => textArea.current?.focus())
  }

  const useStructure = (structure) => {
    const nextScript = formatStructureDraft(structure)
    update(nextScript)
    setActiveScriptSection('writing')
    setNeedsVisualDetail(false)
    setGenerationWarnings([])
    setError('')
    void suggestAssetsForScript(nextScript)
    requestAnimationFrame(() => textArea.current?.focus())
  }

  const useScenes = (sceneScript) => {
    const nextScript = formatScenesDraft(sceneScript)
    update(nextScript)
    setActiveScriptSection('writing')
    setNeedsVisualDetail(false)
    setGenerationWarnings([])
    setError('')
    void suggestAssetsForScript(nextScript)
    requestAnimationFrame(() => textArea.current?.focus())
  }

  const useAdaptedNovelScript = async (adaptedScript) => {
    const nextScript = adaptedScript.trim()
    if (!nextScript) {
      setError('章节改编剧本为空')
      return
    }
    setSaving(true)
    setError('')
    setReview(null)
    setGenerationWarnings([])
    try {
      setScript(nextScript)
      setNeedsVisualDetail(false)
      await onSave(nextScript)
      setSaved(true)
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

  const expand = async () => {
    if (billing.credits < SCRIPT_OPERATION_CREDITS.generate) {
      setError(`快速生成剧本需要 ${SCRIPT_OPERATION_CREDITS.generate} 积分，当前剩余 ${billing.credits} 积分`)
      return
    }
    setGenerating(true)
    setGenerationPhase('quick')
    setError('')
    setGenerationWarnings([])
    try {
      const result = await onGenerate(script, direction, setGenerationPhase)
      const generatedScript = typeof result === 'string' ? result : result.script
      setScript(generatedScript)
      setNeedsVisualDetail(true)
      setGenerationWarnings(typeof result === 'string' ? [] : result.warnings || [])
      setSaved(true)
      void suggestAssetsForScript(generatedScript)
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
    setError('')
    setGenerationWarnings([])
    try {
      const result = await onGenerateSegment(
        script,
        direction,
        { goal: segmentGoal, targetMinutes: segmentMinutes },
        setGenerationPhase,
      )
      const generatedScript = typeof result === 'string' ? result : result.script
      setScript(generatedScript)
      setNeedsVisualDetail(true)
      setGenerationWarnings(typeof result === 'string' ? [] : result.warnings || [])
      setSaved(true)
      setSegmentGoal('')
      void suggestAssetsForScript(generatedScript)
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setGenerating(false)
      setGenerationPhase('idle')
    }
  }

  const enrich = async () => {
    if (!script.trim()) {
      setError('请先生成或填写快速剧本')
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
    setError('')
    try {
      const result = await onEnrich(script, direction)
      const enrichedScript = typeof result === 'string' ? result : result.script
      setScript(enrichedScript)
      setNeedsVisualDetail(false)
      setGenerationWarnings(typeof result === 'string' ? [] : result.warnings || [])
      setSaved(true)
      void suggestAssetsForScript(enrichedScript)
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

  const analyze = async () => {
    if (!isMember) {
      onUpgrade()
      return
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.review) {
      setError(`专业审核需要 ${SCRIPT_OPERATION_CREDITS.review} 积分，当前剩余 ${billing.credits} 积分`)
      return
    }
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return
    }
    setReviewing(true)
    setError('')
    try {
      setReview(await onReview(script, direction))
    } catch (reviewError) {
      setError(reviewError.message)
    } finally {
      setReviewing(false)
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
      setQuickStartPlan(await onPlanQuickStart())
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
        description="写作、视觉方向和制作审核集中在同一个工作区。"
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
        <button
          className="button quick-start-trigger"
          disabled={busy || !script.trim()}
          onClick={() => void openQuickStart()}
        >
          <Sparkles size={16} /> 一键尝鲜
        </button>
      </PageHeader>

      <section className="script-section-nav" aria-label="剧本工作区小项">
        {SCRIPT_SECTIONS.map(({ id, label, description, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={activeScriptSection === id ? 'active' : ''}
            aria-pressed={activeScriptSection === id}
            onClick={() => setActiveScriptSection(id)}
          >
            <Icon size={18} />
            <span>
              <strong>{label}</strong>
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
            onUseAdaptedScript={useAdaptedNovelScript}
          />
        </section>
      )}

      {activeScriptSection === 'outline' && (
        <>
          <section className="script-outline-direction" aria-label="大纲生成方向">
            <div>
              <span className="eyebrow">生成方向</span>
              <strong>先选创作倾向，再生成候选大纲、剧情结构和分场剧本</strong>
            </div>
            <div className="script-outline-controls">
              {DIRECTION_FIELDS.map(({ key, label, icon: Icon, options }) => (
                <label key={key}>
                  <span>
                    <Icon size={13} /> {label}
                  </span>
                  <select
                    value={direction[key]}
                    onChange={(event) => {
                      setDirection((current) => ({ ...current, [key]: event.target.value }))
                      setReview(null)
                    }}
                  >
                    {options.map(([value, optionLabel]) => (
                      <option key={value} value={value}>
                        {optionLabel}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="direction-focus" role="group" aria-label="大纲生成重点">
              <span>生成重点</span>
              {FOCUS_OPTIONS.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={direction.focus === value ? 'active' : ''}
                  aria-pressed={direction.focus === value}
                  onClick={() => {
                    setDirection((current) => ({ ...current, focus: value }))
                    setReview(null)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <OutlineOptionsPanel
            projectId={project.id}
            ideaSeed={project.synopsis || ''}
            billing={billing}
            busy={busy}
            direction={direction}
            onGenerate={onGenerateOutlines}
            onGenerateStructure={onGenerateStructure}
            onGenerateScenes={onGenerateScenes}
            onUseOutline={useOutline}
            onUseStructure={useStructure}
            onUseScenes={useScenes}
          />
        </>
      )}

      {activeScriptSection === 'writing' && (
        <>
          <section className="script-direction-bar" aria-label="视觉制作方向">
            <div className="script-direction-title">
              <span className="direction-symbol">
                <Sparkles size={17} />
              </span>
              <div>
                <span className="eyebrow">视觉制作方向</span>
                <strong>先快速成稿，再按需补齐画面语言</strong>
              </div>
            </div>
            <div className="script-direction-controls">
              {DIRECTION_FIELDS.map(({ key, label, icon: Icon, options }) => (
                <label key={key}>
                  <span>
                    <Icon size={13} /> {label}
                  </span>
                  <select
                    value={direction[key]}
                    onChange={(event) => {
                      setDirection((current) => ({ ...current, [key]: event.target.value }))
                      setReview(null)
                    }}
                  >
                    {options.map(([value, optionLabel]) => (
                      <option key={value} value={value}>
                        {optionLabel}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="script-direction-footer">
              <div className="direction-focus" role="group" aria-label="扩写重点">
                <span>扩写重点</span>
                {FOCUS_OPTIONS.map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={direction.focus === value ? 'active' : ''}
                    aria-pressed={direction.focus === value}
                    onClick={() => {
                      setDirection((current) => ({ ...current, focus: value }))
                      setReview(null)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="button direction-generate-button"
                disabled={busy}
                onClick={() => void expand()}
              >
                {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                {generationPhase === 'syncing'
                  ? '正在同步结果'
                  : generationPhase === 'segment'
                    ? '正在生成下一段'
                    : generating
                      ? '正在快速生成'
                      : `快速生成剧本 · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
              </button>
              {needsVisualDetail && (
                <button
                  className="button direction-detail-button"
                  disabled={busy}
                  onClick={() => void enrich()}
                >
                  {enriching ? <LoaderCircle size={16} className="spin" /> : <Clapperboard size={16} />}
                  {enriching
                    ? '正在补齐视觉细节'
                    : `补齐专业视觉细节 · ${SCRIPT_OPERATION_CREDITS.enrich} 积分`}
                </button>
              )}
            </div>
            <div className="script-segment-generator">
              <div className="script-segment-title">
                <span className="eyebrow">长剧分段</span>
                <strong>只生成下一段，不一次性生成超长文本</strong>
              </div>
              <label>
                <span>本段目标</span>
                <textarea
                  value={segmentGoal}
                  rows={2}
                  placeholder="例如：承接上一段，写主角进入新地点并遇到第一个阻力"
                  onChange={(event) => setSegmentGoal(event.target.value)}
                />
              </label>
              <label>
                <span>预计时长</span>
                <select
                  value={segmentMinutes}
                  onChange={(event) => setSegmentMinutes(Number(event.target.value))}
                >
                  {[3, 5, 8, 10, 15].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} 分钟
                    </option>
                  ))}
                </select>
              </label>
              <button className="button primary" disabled={busy} onClick={() => void generateSegment()}>
                {generationPhase === 'segment' ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                {generationPhase === 'segment'
                  ? '正在生成下一段'
                  : `生成下一段 · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
              </button>
            </div>
          </section>

          {generationWarnings.length > 0 && (
            <div className="script-generation-note" role="status">
              <Sparkles size={15} />
              <span>
                快速剧本已生成，但还有可优化项：{generationWarnings.slice(0, 2).join('；')}
                。可继续编辑，或点击“补齐专业视觉细节”。
              </span>
            </div>
          )}

          <div className={`script-workspace ${inspectorOpen ? 'with-inspector' : 'without-inspector'}`}>
            <section className="script-document" aria-busy={generating || enriching}>
              <div className="script-document-toolbar">
                <div className="script-block-actions" role="group" aria-label="插入剧本结构">
                  {INSERT_BLOCKS.map(({ key, label, icon: Icon, value }) => (
                    <button className="format-button" key={key} onClick={() => insert(value)}>
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
                <div className="script-document-status">
                  <span className={saved ? 'saved' : 'unsaved'}>
                    <BadgeCheck size={14} /> {saved ? '已同步' : '未保存'}
                  </span>
                  <IconButton
                    label={inspectorOpen ? '收起剧本检查' : '打开剧本检查'}
                    type="button"
                    onClick={() => setInspectorOpen((current) => !current)}
                  >
                    {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                  </IconButton>
                </div>
              </div>
              <div className="script-textarea-wrap">
                <textarea
                  ref={textArea}
                  value={script}
                  onChange={(event) => update(event.target.value)}
                  placeholder="写下故事内容，或插入场景、角色和对白结构……"
                />
                {(generating || enriching) && (
                  <div className="script-processing-overlay" role="status" aria-live="polite">
                    <LoaderCircle size={25} className="spin" />
                    <strong>
                      {generationPhase === 'syncing'
                        ? '连接已结束，正在确认保存结果'
                        : enriching
                          ? '正在补齐专业视觉细节'
                          : generationPhase === 'segment'
                            ? '正在生成下一段剧本'
                            : '正在快速整理故事骨架'}
                    </strong>
                    <span>
                      {generationPhase === 'syncing'
                        ? '无需手动刷新，系统正在自动取回剧本'
                        : enriching
                          ? `已等待 ${generationSeconds} 秒 · 保留原有剧情，只补齐视觉字段`
                          : generationPhase === 'segment'
                            ? `已等待 ${generationSeconds} 秒 · 只追加下一段，不重写已有内容`
                            : `已等待 ${generationSeconds} 秒 · 只生成 4 到 6 个场景和基础对白`}
                    </span>
                  </div>
                )}
              </div>
              <div className="script-document-footer">
                <span>{count} 字</span>
                <span>{paragraphCount} 段</span>
                <span>约 {estimatedMinutes} 分钟</span>
                <button disabled={saving || saved || !script.trim()} onClick={() => void save()}>
                  {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                  {saving ? '保存中' : saved ? '已保存' : '保存'}
                </button>
              </div>
            </section>

            {inspectorOpen && (
              <aside className={`script-inspector ${reviewing ? 'is-reviewing' : ''}`} aria-busy={reviewing}>
                <div className="script-inspector-head">
                  <div>
                    <span className="eyebrow">制作检查</span>
                    <h2>{review ? `${review.score} 分` : '剧本概况'}</h2>
                  </div>
                  {reviewing && <LoaderCircle size={18} className="spin" />}
                </div>
                <div className="script-metrics">
                  <div>
                    <UserRound size={15} />
                    <span>主要角色</span>
                    <strong>{characterCount}</strong>
                  </div>
                  <div>
                    <Image size={15} />
                    <span>有效段落</span>
                    <strong>{paragraphCount}</strong>
                  </div>
                  <div>
                    <Clapperboard size={15} />
                    <span>建议镜头</span>
                    <strong>{suggestedShots}</strong>
                  </div>
                  <div>
                    <Clock3 size={15} />
                    <span>文本时长</span>
                    <strong>{estimatedMinutes}m</strong>
                  </div>
                </div>
                <button
                  className={`button analysis-review-button ${isMember ? 'primary member' : 'locked'}`}
                  onClick={() => void analyze()}
                  disabled={reviewing || generating || !script.trim()}
                >
                  {reviewing ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : isMember ? (
                    <ShieldCheck size={16} />
                  ) : (
                    <Crown size={16} />
                  )}
                  {reviewing
                    ? '正在审核'
                    : isMember
                      ? `专业审核剧本 · ${SCRIPT_OPERATION_CREDITS.review} 积分`
                      : '会员专业审核'}
                </button>
                {review ? (
                  <div className="review-result">
                    <p className="review-verdict">{review.verdict}</p>
                    <div className="review-priorities">
                      <strong>优先修改</strong>
                      {review.priorityActions.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                    <div className="review-dimensions">
                      {review.dimensions.map((dimension) => (
                        <article key={dimension.key}>
                          <div>
                            <strong>{REVIEW_LABELS[dimension.key] || dimension.key}</strong>
                            <b>{dimension.score}</b>
                          </div>
                          <p>{dimension.finding}</p>
                          <small>{dimension.suggestion}</small>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="script-review-empty">
                    {Object.values(REVIEW_LABELS).map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                )}
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
            onCreate={createSuggestedAsset}
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
