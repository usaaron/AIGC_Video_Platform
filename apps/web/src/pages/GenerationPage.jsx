import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DELIVERY_REQUIREMENT_IDS,
  DELIVERY_PROVIDER_COMPLETION_REQUIREMENT,
  deliveryContractRequiresProviderCompletion,
} from '@seqora/contracts'
import { ArrowRight, Check, Clapperboard, Clock3, Crown, Info, LoaderCircle, Play, Zap } from 'lucide-react'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { VideoPreviewModal } from '../components/VideoPreviewModal'
import { JobRow, PageHeader } from '../components/ui'
import { DeliveryDownload } from '../features/generation/DeliveryDownload'
import { inspectDeliveryDialog } from '../features/generation/deliveryInspection'
import {
  ProviderCompletionReceipt,
  ProviderCompletionRequirement,
} from '../features/generation/ProviderCompletionReceipt'

const filters = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['audio', '音频'],
]

export function GenerationPage({
  jobs,
  concurrency,
  member,
  billingScope = 'membership',
  onUpgrade,
  onPause,
  onResume,
  onDelete,
  onClear,
  onNext,
  onFreezeDelivery,
  onInspectDelivery,
  onInspectDeliveryGate,
  onDownloadDelivery,
}) {
  const [filter, setFilter] = useState('all')
  const [busyTaskId, setBusyTaskId] = useState(null)
  const [preview, setPreview] = useState(null)
  const [freezeDialog, setFreezeDialog] = useState(null)
  const [deliveryDialog, setDeliveryDialog] = useState(null)
  const queueJobs = jobs.filter((job) => typeof job.metadata?.queueHiddenAt !== 'string')
  const visibleJobs = filter === 'all' ? queueJobs : queueJobs.filter((job) => job.kind === filter)
  const active = queueJobs.filter((job) => ['queued', 'paused', 'running'].includes(job.status))
  const running = queueJobs.filter((job) => job.status === 'running' && job.provider !== 'local-compose')
  const hasTerminalJobs = queueJobs.some((job) => ['completed', 'failed', 'cancelled'].includes(job.status))

  const runTaskAction = async (taskId, action) => {
    if (busyTaskId) return
    setBusyTaskId(taskId)
    try {
      await action(taskId)
    } finally {
      setBusyTaskId(null)
    }
  }

  const inspectDelivery = (job) =>
    inspectDeliveryDialog({
      job,
      inspect: onInspectDelivery,
      inspectGate: onInspectDeliveryGate,
      setDialog: setDeliveryDialog,
    })

  const openFreezeDelivery = (job) => {
    if (!onFreezeDelivery || !canFreezeDeliveryContract(job)) return
    setFreezeDialog({
      job,
      draft: buildDeliveryContractDraft(job),
      status: 'editing',
      result: null,
      error: '',
    })
  }

  const submitFreezeDelivery = async () => {
    if (!onFreezeDelivery || !freezeDialog || busyTaskId) return
    const { job, draft } = freezeDialog
    setBusyTaskId(job.id)
    setFreezeDialog((current) => (current ? { ...current, status: 'loading', error: '' } : current))
    try {
      const result = await onFreezeDelivery(job, draft)
      setFreezeDialog((current) => (current ? { ...current, status: 'success', result, error: '' } : current))
    } catch (error) {
      setFreezeDialog((current) =>
        current
          ? { ...current, status: 'error', result: null, error: error?.message || '合同暂时无法冻结' }
          : current,
      )
    } finally {
      setBusyTaskId(null)
    }
  }

  return (
    <div className="page queue-page">
      <PageHeader
        eyebrow="第 4 步 · 生成队列"
        title="创作正在发生"
        description="任务由后端持续处理，刷新页面不会中断。"
      >
        <button className="button secondary" onClick={onClear} disabled={!hasTerminalJobs}>
          归档已结束
        </button>
        <button className="button primary" onClick={onNext}>
          预览成片 <Play size={15} fill="currentColor" />
        </button>
      </PageHeader>
      <div className="queue-stats">
        <div>
          <span className="stat-icon mint">
            <LoaderCircle size={19} />
          </span>
          <p>
            生成中<strong>{running.length}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon amber">
            <Clock3 size={19} />
          </span>
          <p>
            等待 / 暂停
            <strong>
              {queueJobs.filter((job) => job.status === 'queued').length} /{' '}
              {queueJobs.filter((job) => job.status === 'paused').length}
            </strong>
          </p>
        </div>
        <div>
          <span className="stat-icon blue">
            <Check size={19} />
          </span>
          <p>
            已完成<strong>{queueJobs.filter((job) => job.status === 'completed').length}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon coral">
            <Zap size={19} />
          </span>
          <p>
            并发占用
            <strong>
              {running.length} / {concurrency}
            </strong>
          </p>
        </div>
      </div>
      <section className="queue-policy" aria-label="队列处理规则">
        <Info size={17} />
        <div>
          <strong>队列处理规则</strong>
          <span>
            等待中的任务可以暂停、继续或删除并自动退款；运行中的任务点击暂停后会先确认，确认后停止生成且不退还已扣积分。
          </span>
        </div>
      </section>
      {!member && billingScope !== 'organization' && (
        <section className="upgrade-banner">
          <div className="upgrade-visual">
            <Crown size={24} />
          </div>
          <div>
            <span className="eyebrow">节省等待时间</span>
            <h2>开启 3 路并发生成</h2>
            <p>免费版任务会依次执行，会员可同时处理 3 项。</p>
          </div>
          <button className="button dark" onClick={onUpgrade}>
            查看会员方案 <ArrowRight size={16} />
          </button>
        </section>
      )}
      <section className="queue-panel">
        <div className="panel-head">
          <div>
            <h2>全部任务</h2>
            <span>{active.length ? `${active.length} 项尚未完成` : '所有任务已完成'}</span>
          </div>
          <div className="queue-filter">
            {filters.map(([id, label]) => (
              <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="jobs-list">
          {visibleJobs.length ? (
            visibleJobs.map((job) => (
              <JobRow
                job={toDisplayJob(job)}
                key={job.id}
                busy={busyTaskId === job.id}
                onPause={() => runTaskAction(job.id, onPause)}
                onResume={() => runTaskAction(job.id, onResume)}
                onDelete={() => runTaskAction(job.id, onDelete)}
                onPreviewResult={(targetJob) =>
                  setPreview({
                    url: targetJob.resultUrl,
                    alt: targetJob.label || '生成结果',
                    fileName: targetJob.label || '生成结果',
                    mediaType: targetJob.kind,
                  })
                }
                onInspectDelivery={
                  onInspectDelivery && hasFrozenDeliveryContract(job)
                    ? () => void inspectDelivery(job)
                    : undefined
                }
                onFreezeDelivery={
                  onFreezeDelivery && canFreezeDeliveryContract(job)
                    ? () => openFreezeDelivery(job)
                    : undefined
                }
              />
            ))
          ) : (
            <div className="empty-state">
              <Clapperboard size={28} />
              <h3>当前分类没有任务</h3>
              <p>从资产或分镜页面开始生成。</p>
            </div>
          )}
        </div>
      </section>
      {preview?.mediaType === 'video' && (
        <VideoPreviewModal video={preview} onClose={() => setPreview(null)} />
      )}
      {preview && preview.mediaType !== 'video' && (
        <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />
      )}
      {deliveryDialog &&
        createPortal(
          <DeliveryVerificationDialog
            dialog={deliveryDialog}
            onClose={() => setDeliveryDialog(null)}
            onDownload={onDownloadDelivery}
            onRefresh={() => void inspectDelivery(deliveryDialog.job)}
          />,
          document.body,
        )}
      {freezeDialog &&
        createPortal(
          <DeliveryContractFreezeDialog
            dialog={freezeDialog}
            onClose={() => setFreezeDialog(null)}
            onSubmit={() => void submitFreezeDelivery()}
            onTogglePhysicalReview={(enabled) => {
              setFreezeDialog((current) => {
                if (!current || current.status === 'loading' || current.status === 'success') return current
                const must = current.draft.must.filter(
                  (requirement) => requirement.id !== DELIVERY_REQUIREMENT_IDS.physicalReview,
                )
                return {
                  ...current,
                  draft: {
                    ...current.draft,
                    must: enabled
                      ? [
                          ...must,
                          {
                            id: DELIVERY_REQUIREMENT_IDS.physicalReview,
                            statement: '物理验收必须通过',
                            source: 'review',
                          },
                        ]
                      : must,
                  },
                }
              })
            }}
          />,
          document.body,
        )}
    </div>
  )
}

function toDisplayJob(job) {
  const type = { text: '文本', image: '图片', video: '视频', audio: '音频' }[job.kind]
  return { ...job, type, cost: job.estimatedCredits }
}

function hasFrozenDeliveryContract(job) {
  return typeof job?.metadata?.deliveryContract?.contractHash === 'string'
}

export function canFreezeDeliveryContract(job) {
  return Boolean(
    job?.kind === 'video' &&
    job.status === 'completed' &&
    typeof job.resultUrl === 'string' &&
    job.resultUrl.trim() &&
    typeof job.projectId === 'string' &&
    job.projectId.trim() &&
    typeof job.updatedAt === 'string' &&
    Number.isFinite(Date.parse(job.updatedAt)) &&
    !job.metadata?.deliveryContract,
  )
}

export function buildDeliveryContractDraft(job) {
  const shotId =
    typeof job?.metadata?.shotId === 'string' && job.metadata.shotId.trim()
      ? job.metadata.shotId.trim()
      : null
  const episodeId =
    typeof job?.metadata?.episodeId === 'string' && job.metadata.episodeId.trim()
      ? job.metadata.episodeId.trim()
      : typeof job?.metadata?.scriptEpisodeId === 'string' && job.metadata.scriptEpisodeId.trim()
        ? job.metadata.scriptEpisodeId.trim()
        : null
  const artifactType = job?.kind === 'image' ? 'image' : 'video'
  const hasPhysicsEvidence = Boolean(job?.metadata?.rigidPhysicsContract || job?.metadata?.rigidPhysicsAudit)
  return {
    version: 'seqora.delivery.v1',
    contractHash: null,
    frozenAt: null,
    intent: {
      mode: artifactType === 'image' ? 'asset' : 'shot',
      projectId: job.projectId,
      episodeId,
      shotIds: shotId ? [shotId] : [],
    },
    expectedArtifact: { type: artifactType, count: 1 },
    must: [
      {
        id: DELIVERY_REQUIREMENT_IDS.taskCompleted,
        statement: '任务必须已完成',
        source: 'system',
      },
      {
        id: DELIVERY_REQUIREMENT_IDS.mediaUrl,
        statement: artifactType === 'image' ? '必须存在可读取的图片媒体' : '必须存在可读取的视频媒体',
        source: 'provider',
      },
      ...(deliveryContractRequiresProviderCompletion(job ?? {})
        ? [{ ...DELIVERY_PROVIDER_COMPLETION_REQUIREMENT }]
        : []),
      ...(hasPhysicsEvidence
        ? [
            {
              id: DELIVERY_REQUIREMENT_IDS.physicalReview,
              statement: '物理验收必须通过',
              source: 'review',
            },
          ]
        : []),
    ],
  }
}

const DELIVERY_STATUS_LABELS = {
  satisfied: '交付要求已满足',
  partial: '部分要求已满足',
  failed: '存在失败要求',
  pending: '等待交付证据',
}

const DELIVERY_GATE_REASON_LABELS = {
  CONTRACT_NOT_FROZEN: '交付合同尚未冻结',
  CONTRACT_HASH_INVALID: '合同哈希校验失败',
  TASK_NOT_COMPLETED: '生成任务尚未完成',
  MEDIA_NOT_READABLE: '主交付媒体尚未通过可读取性验证',
  CONTENT_REVIEW_PENDING: '视频内容验收尚未通过',
  CONTENT_REVIEW_FAILED: '视频内容验收已标记问题',
  PHYSICAL_REVIEW_PENDING: '刚性物理验收尚未通过',
  PHYSICAL_REVIEW_FAILED: '刚性物理验收失败',
  CONTINUITY_PENDING: '连续性尾帧尚未通过存储验证',
  CONTINUITY_FAILED: '连续性证据失败',
  DELIVERY_REQUIREMENTS_INCOMPLETE: '合同要求尚未全部满足',
}

function requirementSummary(ids) {
  if (!Array.isArray(ids) || !ids.length) return '无'
  return ids.join('、')
}

export function DeliveryVerificationDialog({ dialog, onClose, onDownload, onRefresh }) {
  const { job, status, snapshot, gate, error } = dialog
  const verification = snapshot?.verification
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal delivery-verification-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-verification-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">交付事实与下载</span>
            <h2 id="delivery-verification-title">交付核验</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭交付核验" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="delivery-verification-task">{job?.label || '生成任务'}</p>
        {status === 'loading' && <p className="delivery-verification-loading">正在读取当前任务的交付证据…</p>}
        {status === 'error' && (
          <p className="delivery-verification-error" role="alert">
            {error}
          </p>
        )}
        {status === 'ready' && !verification && (
          <p className="delivery-verification-pending">当前任务尚未形成可验证的冻结合同。</p>
        )}
        {status === 'ready' && verification && (
          <div className={`delivery-verification-result ${verification.status}`}>
            <strong>{DELIVERY_STATUS_LABELS[verification.status] || verification.status}</strong>
            <p>{verification.rationale}</p>
            <dl>
              <div>
                <dt>已通过</dt>
                <dd>{requirementSummary(verification.satisfiedRequirementIds)}</dd>
              </div>
              <div>
                <dt>待补证据</dt>
                <dd>{requirementSummary(verification.pendingRequirementIds)}</dd>
              </div>
              <div>
                <dt>失败</dt>
                <dd>{requirementSummary(verification.failedRequirementIds)}</dd>
              </div>
            </dl>
            <small>
              合同哈希：{snapshot.contract?.contractHash?.slice(0, 12) || '不可用'} · 证据{' '}
              {snapshot.evidence?.length || 0} 条
            </small>
          </div>
        )}
        {status === 'ready' && (
          <ProviderCompletionReceipt
            snapshot={snapshot}
            enabled={deliveryContractRequiresProviderCompletion(job ?? {})}
          />
        )}
        {status === 'ready' && gate && (
          <section className={`delivery-gate-result ${gate.status}`} aria-label="正式交付门禁">
            <strong>
              {gate.allowed
                ? '正式交付门禁已放行'
                : gate.status === 'blocked'
                  ? '正式交付已被阻止'
                  : '正式交付仍待补证据'}
            </strong>
            <p>{gate.rationale}</p>
            {gate.reasonCodes?.length ? (
              <ul>
                {gate.reasonCodes.map((code) => (
                  <li key={code}>{DELIVERY_GATE_REASON_LABELS[code] || code}</li>
                ))}
              </ul>
            ) : null}
          </section>
        )}
        {status === 'ready' && onDownload && (
          <DeliveryDownload
            key={job.id}
            job={job}
            snapshot={snapshot}
            gate={gate}
            onDownload={onDownload}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  )
}

export function DeliveryContractFreezeDialog({ dialog, onClose, onSubmit, onTogglePhysicalReview }) {
  const { job, draft, status, result, error } = dialog
  const physicalReview = draft.must.some(
    (requirement) => requirement.id === DELIVERY_REQUIREMENT_IDS.physicalReview,
  )
  const frozenContract = result?.metadata?.deliveryContract
  const isBusy = status === 'loading'
  const isSuccess = status === 'success'
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal delivery-freeze-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-freeze-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (!isBusy && !isSuccess) onSubmit()
        }}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">正式业务入口</span>
            <h2 id="delivery-freeze-title">冻结交付合同</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭合同冻结" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="delivery-freeze-task">{job?.label || '生成任务'}</p>
        {status === 'editing' || isBusy || status === 'error' ? (
          <>
            <div className="delivery-freeze-summary">
              <div>
                <span>交付范围</span>
                <strong>{draft.intent.mode === 'shot' ? '当前镜头' : '当前任务结果'}</strong>
              </div>
              <div>
                <span>交付物</span>
                <strong>视频 × 1</strong>
              </div>
              <div>
                <span>合同项目</span>
                <strong>{draft.intent.projectId}</strong>
              </div>
            </div>
            <section className="delivery-freeze-requirements" aria-label="合同必备要求">
              <div>
                <strong>冻结前确认必备要求</strong>
                <small>服务器会在冻结时生成时间戳和合同哈希。</small>
              </div>
              <label>
                <input type="checkbox" checked readOnly />
                <span>任务必须已完成</span>
              </label>
              <label>
                <input type="checkbox" checked readOnly />
                <span>必须存在可读取的视频媒体</span>
              </label>
              <ProviderCompletionRequirement job={job} />
              {job?.metadata?.rigidPhysicsContract || job?.metadata?.rigidPhysicsAudit ? (
                <label>
                  <input
                    type="checkbox"
                    checked={physicalReview}
                    disabled={isBusy}
                    onChange={(event) => onTogglePhysicalReview(event.target.checked)}
                  />
                  <span>物理验收必须通过</span>
                </label>
              ) : null}
            </section>
            {status === 'error' && (
              <p className="delivery-freeze-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={onClose} disabled={isBusy}>
                取消
              </button>
              <button className="button primary" type="submit" disabled={isBusy}>
                {isBusy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                {isBusy ? '正在冻结…' : '确认冻结合同'}
              </button>
            </div>
          </>
        ) : (
          <div className="delivery-freeze-success" role="status">
            <Check size={22} />
            <strong>交付合同已冻结</strong>
            <p>合同内容已固定，后续只能读取核验结果，不能重复冻结。</p>
            <small>
              合同哈希：{frozenContract?.contractHash?.slice(0, 16) || '已由服务端生成'}
              {frozenContract?.frozenAt ? ` · ${frozenContract.frozenAt}` : ''}
            </small>
            <div className="modal-actions">
              <button className="button primary" type="button" onClick={onClose}>
                完成
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
