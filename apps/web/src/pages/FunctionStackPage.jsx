import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  CircleAlert,
  BookOpenText,
  Check,
  ChevronRight,
  CircleDashed,
  Download,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { PageHeader } from '../components/ui'
import { FUNCTION_STACK_ITEMS } from '../features/functionStack/config'
import { ImageStudioPage } from '../features/imageStudio/ImageStudioPage'
import { api } from '../services/apiClient'

export function FunctionStackPage({
  tool,
  project,
  billing,
  tasks,
  image2ProviderStatus = null,
  onRefreshImageStudio,
  onOpenBilling,
  onOpenProject,
  onOpenScript,
  onProjectCreated,
}) {
  const item = FUNCTION_STACK_ITEMS.find((entry) => entry.id === tool) ?? FUNCTION_STACK_ITEMS[0]

  return (
    <div className={`page tool-studio-page ${item.id}`}>
      <PageHeader eyebrow={item.eyebrow} title={item.title} description={item.description}>
        {item.id === 'agent-studio' ? (
          <span className="tool-development-badge agent-live-badge">
            <i /> 自动编排已启用
          </span>
        ) : item.id === 'writing-studio' ? (
          <span className="tool-development-badge">
            <CircleDashed size={13} /> 外部模块 · 等待接入
          </span>
        ) : null}
      </PageHeader>
      {item.id === 'agent-studio' ? (
        <AgentStudio billing={billing} onOpenProject={onOpenProject} onProjectCreated={onProjectCreated} />
      ) : null}
      {item.id === 'image-studio' ? (
        <ImageStudioPage
          project={project}
          billing={billing}
          tasks={tasks}
          image2ProviderStatus={image2ProviderStatus}
          onRefresh={onRefreshImageStudio}
          onOpenBilling={onOpenBilling}
        />
      ) : null}
      {item.id === 'writing-studio' ? <WritingStudio onOpenScript={onOpenScript} /> : null}
    </div>
  )
}

const STAGE_LABELS = {
  script: '智能剧本',
  'asset-analysis': '资产分析',
  'asset-generation': '资产生成',
  'identity-baseline': '人脸基准',
  storyboard: '导演分镜',
  'video-generation': '视频生成',
  'film-compose': '按集合成',
  delivery: '成片交付',
}
const CONTENT_LABELS = { 'web-series': '网剧', advertisement: '广告', 'short-film': '短片' }
const STYLE_LABELS = {
  photorealistic: '仿真人',
  'cinematic-cg': '电影 CG',
  'chinese-3d': '国风 3D',
  'chinese-2d': '国风 2D',
  anime: '动漫',
  storybook: '绘本',
}
const STATUS_LABELS = {
  draft: '方案待确认',
  queued: '等待执行',
  running: '自动执行中',
  pausing: '当前任务结束后暂停',
  paused: '已暂停',
  failed: '需要处理',
  completed: '交付完成',
  cancelled: '已取消',
}
const ACTIVE_RUN_STATUSES = new Set(['queued', 'running', 'pausing'])

function AgentStudio({ billing, onOpenProject, onProjectCreated }) {
  const [runs, setRuns] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const runsSnapshotRef = useRef('')
  const selected =
    selectedId === 'new' ? null : (runs.find((run) => run.id === selectedId) ?? runs[0] ?? null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const next = await api.agentRuns()
        if (!active) return
        const nextSnapshot = agentRunsSnapshotKey(next)
        if (nextSnapshot !== runsSnapshotRef.current) {
          runsSnapshotRef.current = nextSnapshot
          setRuns(next)
        }
        setSelectedId((current) => current ?? next[0]?.id ?? null)
      } catch (loadError) {
        if (active) setError(loadError.message)
      }
    }
    void load()
    const shouldPoll = selected && ACTIVE_RUN_STATUSES.has(selected.status)
    if (!shouldPoll)
      return () => {
        active = false
      }
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 2_500)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [selected?.status])

  const submit = async (overrides = {}) => {
    const prompt = input.trim() || (selected?.status === 'draft' ? '确认制作参数' : '')
    if (!prompt) return
    setBusy(true)
    setError('')
    try {
      const run = await api.planAgent({
        prompt,
        ...(selected?.status === 'draft' ? { runId: selected.id } : {}),
        overrides,
      })
      upsertRun(setRuns, run)
      setSelectedId(run.id)
      setInput('')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  const control = async (operation) => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const run = await operation(selected)
      upsertRun(setRuns, run)
      await onProjectCreated?.(run.projectId)
    } catch (controlError) {
      setError(controlError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="tool-studio-frame agent-studio-frame agent-studio-live"
      aria-label="一句成片 Agent 工作台"
    >
      <header className="tool-frame-header">
        <div className="tool-frame-identity">
          <BrandMark size={18} spin />
          <div>
            <strong>序幕TV Director</strong>
            <span>一句需求，按集交付</span>
          </div>
        </div>
        <div className={`tool-frame-status agent-run-status ${selected?.status || 'idle'}`}>
          <i /> {selected ? STATUS_LABELS[selected.status] : '等待创作要求'}
        </div>
      </header>
      <div className="agent-studio-layout">
        <aside className="agent-run-rail">
          <div className="agent-run-rail-heading">
            <span className="tool-section-label">制作任务</span>
            <button
              type="button"
              onClick={() => {
                setSelectedId('new')
                setInput('')
                setError('')
              }}
              title="新建任务"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="agent-run-list">
            {runs.slice(0, 8).map((run) => (
              <button
                type="button"
                className={run.id === selected?.id ? 'active' : ''}
                key={run.id}
                onClick={() => setSelectedId(run.id)}
              >
                <span className={`agent-run-dot ${run.status}`} />
                <div>
                  <strong>{run.plan.projectName}</strong>
                  <small>
                    {STATUS_LABELS[run.status]} · {formatTime(run.updatedAt)}
                  </small>
                </div>
              </button>
            ))}
            {!runs.length ? <div className="agent-run-empty">首个任务会保存在这里</div> : null}
          </div>
          {selected?.plan.estimate ? (
            <div className="agent-run-estimate">
              <span>本次预计</span>
              <strong>
                {selected.plan.durationSeconds} 秒 · {selected.plan.aspectRatio}
              </strong>
              <small>
                {selected.plan.estimate.estimatedShots} 镜 / {selected.plan.estimate.totalCredits} 积分
              </small>
            </div>
          ) : null}
        </aside>
        <div className="agent-conversation">
          <div className="agent-conversation-date">
            <span>{selected ? `任务 ${selected.id.slice(0, 8).toUpperCase()}` : '新建制作任务'}</span>
            <i />
            <span>今天</span>
          </div>
          {!selected ? (
            <AgentWelcome />
          ) : (
            <AgentRunView
              run={selected}
              billing={billing}
              busy={busy}
              control={control}
              onOpenProject={onOpenProject}
            />
          )}
          {error ? (
            <div className="agent-error">
              <CircleAlert size={15} /> {error}
            </div>
          ) : null}
          <div className="agent-composer">
            {busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
            <textarea
              aria-label="创作要求"
              placeholder={
                selected?.status === 'draft'
                  ? '继续补充故事或制作要求...'
                  : '描述想制作的内容，例如：做一支30秒竖屏电影CG风的万柏林区宣传片...'
              }
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void submit()
              }}
              disabled={busy || (selected && selected.status !== 'draft')}
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !input.trim() || Boolean(selected && selected.status !== 'draft')}
              aria-label="发送创作要求"
              title="发送"
            >
              <ArrowUp size={17} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function agentRunsSnapshotKey(runs) {
  return (Array.isArray(runs) ? runs : [])
    .map((run) =>
      [
        run?.id,
        run?.status,
        run?.updatedAt,
        run?.projectId,
        run?.originalPrompt,
        run?.plan?.projectName,
        run?.plan?.contentType,
        run?.plan?.durationSeconds,
        run?.plan?.episodeDurationSeconds,
        run?.plan?.aspectRatio,
        run?.plan?.visualStyle,
        run?.plan?.storyBrief,
        run?.plan?.missingFields?.join(','),
        run?.plan?.estimate?.estimatedShots,
        run?.plan?.estimate?.totalCredits,
        run?.stages
          ?.map((stage) => [stage?.key, stage?.status, stage?.progress, stage?.error].join(':'))
          .join(','),
        run?.deliveries
          ?.map((delivery) => [delivery?.taskId, delivery?.episodeNumber, delivery?.url].join(':'))
          .join(','),
      ].join('|'),
    )
    .join('||')
}

function AgentWelcome() {
  return (
    <div className="agent-welcome">
      <BrandMark size={32} spin />
      <span>ONE-LINE PRODUCTION</span>
      <h2>说出故事，其余交给制作链路。</h2>
      <p>我会先找出缺失信息，只让你确认一次。确认后自动完成剧本、资产、分镜、视频与按集合成。</p>
      <div>
        {['30秒竖屏城市宣传片', '1分钟电影CG网剧', '15秒横屏产品广告'].map((text) => (
          <span key={text}>{text}</span>
        ))}
      </div>
    </div>
  )
}

function AgentRunView({ run, billing, busy, control, onOpenProject }) {
  if (run.status === 'draft')
    return (
      <AgentPlanReview
        key={`${run.id}-${run.updatedAt}`}
        run={run}
        billing={billing}
        busy={busy}
        control={control}
      />
    )
  return (
    <div className="agent-live-run">
      <div className="agent-live-summary">
        <div>
          <span>{CONTENT_LABELS[run.plan.contentType]}</span>
          <strong>{run.plan.projectName}</strong>
          <small>
            {run.plan.durationSeconds} 秒 · {run.plan.aspectRatio} · {STYLE_LABELS[run.plan.visualStyle]}
          </small>
        </div>
        <div className="agent-run-actions">
          {ACTIVE_RUN_STATUSES.has(run.status) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void control((item) => api.pauseAgentRun(item.id))}
            >
              <Pause size={14} /> 暂停
            </button>
          ) : null}
          {run.status === 'paused' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void control((item) => api.resumeAgentRun(item.id))}
            >
              <Play size={14} /> 继续
            </button>
          ) : null}
          {run.status === 'failed' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void control((item) => api.retryAgentRun(item.id))}
            >
              <RefreshCw size={14} /> 重试当前阶段
            </button>
          ) : null}
          {run.projectId ? (
            <button type="button" onClick={() => void onOpenProject?.(run.projectId)}>
              打开项目 <ChevronRight size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="agent-stage-grid">
        {run.stages.map((stage, index) => (
          <div className={`agent-stage-row ${stage.status}`} key={stage.key}>
            <span>
              {stage.status === 'completed' || stage.status === 'skipped' ? (
                <Check size={14} />
              ) : stage.status === 'failed' ? (
                <CircleAlert size={14} />
              ) : stage.status === 'running' || stage.status === 'waiting' ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <span>{String(index + 1).padStart(2, '0')}</span>
              )}
            </span>
            <div>
              <strong>{STAGE_LABELS[stage.key]}</strong>
              <small>{stageStatusText(stage)}</small>
              {stage.error ? <p>{stage.error}</p> : null}
            </div>
            {stage.status === 'failed' && canSkipStage(run, stage) ? (
              <button
                type="button"
                onClick={() => void control((item) => api.skipAgentStage(item.id, stage.key))}
              >
                降级跳过
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {run.deliveries.length ? (
        <div className="agent-deliveries">
          <header>
            <div>
              <span>DELIVERIES</span>
              <strong>按集成片</strong>
            </div>
            <small>{run.deliveries.length} 集已完成</small>
          </header>
          {run.deliveries.map((delivery) => (
            <div key={delivery.taskId}>
              <span>{String(delivery.episodeNumber).padStart(2, '0')}</span>
              <div>
                <strong>{delivery.title}</strong>
                <small>{delivery.durationSeconds} 秒 · 1080p 合成</small>
              </div>
              <a href={delivery.url} target="_blank" rel="noreferrer">
                <Play size={14} /> 预览
              </a>
              <a href={`${delivery.url}?download=1`}>
                <Download size={14} /> 下载
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AgentPlanReview({ run, billing, busy, control }) {
  const [values, setValues] = useState({
    contentType: run.plan.contentType || 'web-series',
    durationSeconds: run.plan.durationSeconds || 60,
    episodeDurationSeconds: run.plan.episodeDurationSeconds || 60,
    aspectRatio: run.plan.aspectRatio || '9:16',
    visualStyle: run.plan.visualStyle || 'cinematic-cg',
  })
  const normalizedValues = {
    ...values,
    durationSeconds: Number(values.durationSeconds),
    episodeDurationSeconds: Number(values.episodeDurationSeconds),
  }
  const dirty =
    normalizedValues.contentType !== run.plan.contentType ||
    normalizedValues.durationSeconds !== run.plan.durationSeconds ||
    normalizedValues.aspectRatio !== run.plan.aspectRatio ||
    normalizedValues.visualStyle !== run.plan.visualStyle ||
    (normalizedValues.contentType === 'web-series' &&
      normalizedValues.episodeDurationSeconds !== run.plan.episodeDurationSeconds)
  const incomplete = run.plan.missingFields.length > 0
  return (
    <div className="agent-plan-review">
      <div className="agent-message user">
        <span>你</span>
        <p>{run.originalPrompt}</p>
      </div>
      <article className="agent-message system">
        <span>
          <BrandMark size={14} />
        </span>
        <div>
          <strong>{incomplete ? '还需要确认几项制作信息' : '制作方案已就绪'}</strong>
          <p>
            {incomplete
              ? '这些设置会决定剧本结构、镜头数量和最终费用。补齐后只需确认一次。'
              : run.plan.storyBrief}
          </p>
        </div>
      </article>
      <div className="agent-plan-form">
        <AgentChoice
          label="内容类型"
          value={values.contentType}
          options={CONTENT_LABELS}
          onChange={(value) => setValues({ ...values, contentType: value })}
        />
        <label>
          <span>总时长</span>
          <div className="agent-number-field">
            <input
              type="text"
              inputMode="numeric"
              value={values.durationSeconds}
              onChange={(event) =>
                setValues({ ...values, durationSeconds: event.target.value.replace(/\D/g, '').slice(0, 3) })
              }
            />
            <small>秒</small>
          </div>
        </label>
        {values.contentType === 'web-series' ? (
          <label>
            <span>每集时长</span>
            <div className="agent-number-field">
              <input
                type="text"
                inputMode="numeric"
                value={values.episodeDurationSeconds}
                onChange={(event) =>
                  setValues({
                    ...values,
                    episodeDurationSeconds: event.target.value.replace(/\D/g, '').slice(0, 3),
                  })
                }
              />
              <small>秒</small>
            </div>
          </label>
        ) : null}
        <AgentChoice
          label="画幅"
          value={values.aspectRatio}
          options={{ '9:16': '竖屏 9:16', '16:9': '横屏 16:9', '1:1': '方形 1:1' }}
          onChange={(value) => setValues({ ...values, aspectRatio: value })}
        />
        <AgentChoice
          label="视觉风格"
          value={values.visualStyle}
          options={STYLE_LABELS}
          onChange={(value) => setValues({ ...values, visualStyle: value })}
        />
      </div>
      {incomplete || dirty ? (
        <button
          className="agent-plan-confirm"
          type="button"
          disabled={busy || !normalizedValues.durationSeconds}
          onClick={() =>
            void control(() =>
              api.planAgent({
                prompt: '确认制作参数',
                runId: run.id,
                overrides: { ...normalizedValues, storyBrief: run.plan.storyBrief },
              }),
            )
          }
        >
          <WandSparkles size={15} /> {incomplete ? '生成完整方案' : '更新方案与报价'}
        </button>
      ) : (
        <AgentQuote run={run} billing={billing} busy={busy} control={control} />
      )}
    </div>
  )
}

function AgentChoice({ label, value, options, onChange }) {
  return (
    <div className="agent-choice">
      <span>{label}</span>
      <div>
        {Object.entries(options).map(([key, text]) => (
          <button
            type="button"
            className={value === key ? 'active' : ''}
            key={key}
            onClick={() => onChange(key)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function AgentQuote({ run, billing, busy, control }) {
  const estimate = run.plan.estimate
  const enough = !billing || billing.credits >= estimate.totalCredits
  return (
    <div className="agent-quote">
      <header>
        <div>
          <span>PRODUCTION BRIEF</span>
          <strong>一次确认，自动执行</strong>
        </div>
        <small>费用随实际资产与镜头数结算</small>
      </header>
      <dl>
        <div>
          <dt>总时长</dt>
          <dd>
            {run.plan.durationSeconds} 秒 / {run.plan.episodeCount} 集
          </dd>
        </div>
        <div>
          <dt>内容</dt>
          <dd>
            {CONTENT_LABELS[run.plan.contentType]} · {run.plan.aspectRatio}
          </dd>
        </div>
        <div>
          <dt>风格</dt>
          <dd>{STYLE_LABELS[run.plan.visualStyle]}</dd>
        </div>
        <div>
          <dt>预计产量</dt>
          <dd>
            {estimate.estimatedAssets} 资产 · {estimate.estimatedShots} 镜
          </dd>
        </div>
        <div>
          <dt>预计耗时</dt>
          <dd>
            {estimate.minMinutes}-{estimate.maxMinutes} 分钟
          </dd>
        </div>
        <div className="total">
          <dt>预计积分</dt>
          <dd>{estimate.totalCredits}</dd>
        </div>
      </dl>
      {!enough ? (
        <p className="agent-credit-warning">
          当前 {billing.credits} 积分，预计还需 {estimate.totalCredits - billing.credits} 积分。
        </p>
      ) : null}
      <button
        className="agent-plan-confirm"
        type="button"
        disabled={busy || !enough}
        onClick={() => void control((item) => api.confirmAgentRun(item.id))}
      >
        <Play size={15} /> 确认并开始制作
      </button>
    </div>
  )
}

function stageStatusText(stage) {
  if (stage.status === 'completed') return '已完成'
  if (stage.status === 'skipped') return '无需执行'
  if (stage.status === 'failed') return `失败 · 已尝试 ${stage.attempt + 1} 次`
  if (stage.status === 'paused') return '已暂停'
  if (stage.status === 'running' || stage.status === 'waiting')
    return stage.taskIds.length ? `${stage.taskIds.length} 个后台任务` : '正在准备'
  return '等待前序阶段'
}
function canSkipStage(run, stage) {
  return (
    run.plan.visualStyle !== 'photorealistic' &&
    (stage.key === 'asset-analysis' || stage.key === 'asset-generation')
  )
}
function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
function upsertRun(setter, run) {
  setter((current) => [run, ...current.filter((item) => item.id !== run.id)])
}

function WritingStudio({ onOpenScript }) {
  return (
    <section className="tool-studio-frame writing-studio-frame" aria-label="剧本大师接入说明">
      <header className="tool-frame-header">
        <div className="tool-frame-identity">
          <span className="tool-frame-mark">
            <BookOpenText size={18} />
          </span>
          <div>
            <strong>剧本大师</strong>
            <span>长篇故事与批量分集由外部团队研发</span>
          </div>
        </div>
        <div className="tool-frame-status">等待接口接入</div>
      </header>
      <div className="writing-studio-handoff">
        <span className="eyebrow">LONG-FORM HANDOFF</span>
        <h2>长剧本能力尚未接入当前版本</h2>
        <p>
          当前工作台只负责单集剧本生成。长篇世界观、人物关系、批量分集和数十万字正文由剧本大师团队独立研发，接口完成后再接入这里。
        </p>
        <div className="writing-studio-boundaries">
          <div>
            <strong>当前可用</strong>
            <span>单次生成 1 集、6～8 个可制作场次，并继续进入资产与分镜。</span>
          </div>
          <div>
            <strong>等待接入</strong>
            <span>长篇总纲、人物档案、分集规划，以及按集按场次的批量交付。</span>
          </div>
        </div>
        <p className="writing-studio-safe-note">
          此页面不会创建生成任务，也不会显示虚假的“生成中”或“自动保存”状态。
        </p>
        <button type="button" className="button primary" onClick={onOpenScript}>
          <ArrowLeft size={15} /> 返回单集剧本
        </button>
      </div>
    </section>
  )
}
