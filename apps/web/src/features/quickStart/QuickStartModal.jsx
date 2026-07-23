import {
  ArrowRight,
  CircleCheck,
  Coins,
  Hourglass,
  Layers3,
  LoaderCircle,
  MapPinned,
  Shirt,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { IconButton } from '../../components/ui'

const QUICK_START_KINDS = {
  character: { label: '主要人物', icon: UserRound },
  costume: { label: '核心服装', icon: Shirt },
  scene: { label: '核心场景', icon: MapPinned },
}

export function QuickStartModal({
  state,
  plan,
  result,
  error,
  credits,
  onClose,
  onRetry,
  onStart,
  onViewAssets,
}) {
  const busy = state === 'analyzing' || state === 'starting'
  const insufficient = plan && credits < plan.estimate.credits
  const hasAssets = plan?.assets.length > 0
  const proposalCounts = countProposals(plan?.assets || [])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal quick-start-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-start-title"
        aria-busy={busy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head quick-start-head">
          <div>
            <span className="eyebrow">当前剧本 · 最小资产闭环</span>
            <h2 id="quick-start-title">一键尝鲜</h2>
          </div>
          <IconButton label="关闭" type="button" disabled={state === 'starting'} onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>

        {state === 'analyzing' && <QuickStartLoading label="正在保存并分析主要人物、服装和场景" />}

        {state === 'error' && (
          <div className="quick-start-feedback error" role="alert">
            <Sparkles size={22} />
            <strong>剧本分析未完成</strong>
            <p>{error}</p>
          </div>
        )}

        {(state === 'ready' || state === 'starting') && plan && (
          <>
            <p className="quick-start-summary">{plan.summary}</p>
            <div className="quick-start-checkpoint" role="status">
              <CircleCheck size={17} />
              <span>
                分析完成：计划创建 {proposalCounts.character} 个人物、{proposalCounts.costume} 套服装、
                {proposalCounts.scene} 个场景；点击确认后才会扣积分并进入生成队列。
              </span>
            </div>
            <div className="quick-start-assets" aria-label="将创建的资产">
              {plan.assets.map((asset) => {
                const kind = QUICK_START_KINDS[asset.kind]
                const Icon = kind.icon
                return (
                  <div className="quick-start-asset-row" key={`${asset.kind}-${asset.name}`}>
                    <span className={`quick-start-asset-icon ${asset.kind}`}>
                      <Icon size={17} />
                    </span>
                    <div>
                      <strong>{asset.name}</strong>
                      <p>{asset.description}</p>
                    </div>
                    <span>{kind.label}</span>
                  </div>
                )
              })}
              {!hasAssets && <p className="quick-start-empty">核心资产已存在，无需重复创建。</p>}
            </div>
            <div className="quick-start-estimate">
              <div>
                <Layers3 size={16} />
                <span>生成任务</span>
                <strong>{plan.estimate.taskCount} 项</strong>
              </div>
              <div>
                <Coins size={16} />
                <span>预计积分</span>
                <strong>{plan.estimate.credits}</strong>
              </div>
              <div>
                <Hourglass size={16} />
                <span>预计等待</span>
                <strong>{formatDurationRange(plan.estimate)}</strong>
              </div>
            </div>
            <p className={`quick-start-balance ${insufficient ? 'insufficient' : ''}`}>
              当前 {credits} 积分 · {plan.estimate.concurrency} 路并发
              {plan.estimate.queueAhead ? ` · 前方 ${plan.estimate.queueAhead} 项任务` : ''}
              {insufficient ? ` · 还差 ${plan.estimate.credits - credits} 积分` : ''}
            </p>
            {error && (
              <p className="asset-save-error" role="alert">
                {error}
              </p>
            )}
            {state === 'starting' && <QuickStartLoading label="正在创建资产并加入生成队列" compact />}
          </>
        )}

        {state === 'complete' && result && (
          <div className="quick-start-feedback complete" role="status">
            <CircleCheck size={27} />
            <strong>
              {result.tasks.length ? `${result.createdAssets.length} 项资产已开始生成` : '最小资产闭环已就绪'}
            </strong>
            <p>
              {result.tasks.length
                ? `${result.tasks.length} 项任务已进入队列，共扣除 ${result.estimate.credits} 积分；资产页会自动刷新生成状态。`
                : '没有创建重复资产，也没有产生新的生成扣费。'}
            </p>
          </div>
        )}

        <div className="modal-actions quick-start-actions">
          {state === 'analyzing' ? (
            <button type="button" className="button secondary" onClick={onClose}>
              取消分析
            </button>
          ) : state === 'error' ? (
            <>
              <button type="button" className="button secondary" onClick={onClose}>
                关闭
              </button>
              <button type="button" className="button primary" onClick={onRetry}>
                <Sparkles size={15} /> 重新分析
              </button>
            </>
          ) : state === 'complete' || (state === 'ready' && !hasAssets) ? (
            <button type="button" className="button primary" onClick={onViewAssets}>
              查看项目资产 <ArrowRight size={15} />
            </button>
          ) : (
            <>
              <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || insufficient || !hasAssets}
                onClick={() => void onStart()}
              >
                {state === 'starting' ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                {state === 'starting' ? '正在创建' : `确认生成 · ${plan?.estimate.credits ?? 0} 积分`}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function QuickStartLoading({ label, compact = false }) {
  return (
    <div className={`quick-start-loading ${compact ? 'compact' : ''}`} role="status">
      <span className="quick-start-loader">
        <LoaderCircle size={compact ? 18 : 25} className="spin" />
      </span>
      <div>
        <strong>{label}</strong>
        <span className="quick-start-scan-lines" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  )
}

function formatDurationRange(estimate) {
  if (!estimate.taskCount) return '无需等待'
  const min = Math.max(1, Math.ceil(estimate.minSeconds / 60))
  const max = Math.max(min, Math.ceil(estimate.maxSeconds / 60))
  return min === max ? `约 ${min} 分钟` : `约 ${min}-${max} 分钟`
}

function countProposals(assets) {
  return assets.reduce((counts, asset) => ({ ...counts, [asset.kind]: counts[asset.kind] + 1 }), {
    character: 0,
    costume: 0,
    scene: 0,
  })
}
