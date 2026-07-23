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
import { QuickStartModal } from '../features/quickStart/QuickStartModal'
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
  onGenerate,
  onEnrich,
  onReview,
  onPlanQuickStart,
  onExecuteQuickStart,
  onUpgrade,
  onNext,
}) {
  const [script, setScript] = useState(project.script)
  const [direction, setDirection] = useState(DEFAULT_DIRECTION)
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
  const [error, setError] = useState('')
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const [quickStartState, setQuickStartState] = useState('idle')
  const [quickStartPlan, setQuickStartPlan] = useState(null)
  const [quickStartResult, setQuickStartResult] = useState(null)
  const [quickStartError, setQuickStartError] = useState('')
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
          <button className="button direction-generate-button" disabled={busy} onClick={() => void expand()}>
            {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            {generationPhase === 'syncing'
              ? '正在同步结果'
              : generating
                ? '正在快速生成'
                : `快速生成剧本 · ${SCRIPT_OPERATION_CREDITS.generate} 积分`}
          </button>
          {needsVisualDetail && (
            <button className="button direction-detail-button" disabled={busy} onClick={() => void enrich()}>
              {enriching ? <LoaderCircle size={16} className="spin" /> : <Clapperboard size={16} />}
              {enriching ? '正在补齐视觉细节' : `补齐专业视觉细节 · ${SCRIPT_OPERATION_CREDITS.enrich} 积分`}
            </button>
          )}
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
                      : '正在快速整理故事骨架'}
                </strong>
                <span>
                  {generationPhase === 'syncing'
                    ? '无需手动刷新，系统正在自动取回剧本'
                    : enriching
                      ? `已等待 ${generationSeconds} 秒 · 保留原有剧情，只补齐视觉字段`
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
