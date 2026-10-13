import {
  Check,
  Clock3,
  ExternalLink,
  Images,
  LoaderCircle,
  Pause,
  Play,
  Trash2,
  Video,
  XCircle,
} from 'lucide-react'

export function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />
}

export function IconButton({ label, children, className = '', ...props }) {
  return (
    <button className={`icon-button ${className}`} title={label} aria-label={label} {...props}>
      {children}
    </button>
  )
}

export function canCancelRunningTask(job) {
  if (job?.status !== 'running') return false
  const providerName = String(job.metadata?.providerName || job.provider || '').toLowerCase()
  return ['stringx-seedance', 'volc-ark-seedance', 'volcark-seedance'].includes(providerName)
}

/** Keep task actions identical wherever a generation task is surfaced. */
export function TaskControls({
  job,
  busy = false,
  compact = false,
  onPause,
  onResume,
  onDelete,
}) {
  if (!job) return null
  const canCancelRunning = canCancelRunningTask(job)
  const showDelete = !compact && onDelete && (job.status !== 'running' || canCancelRunning)
  const showPause = Boolean(onPause) && ['queued', 'running'].includes(job.status)
  const showResume = Boolean(onResume) && job.status === 'paused'
  if (!showPause && !showResume && !showDelete) return null
  const requestPause = () => {
    if (job.status === 'running') {
      const confirmed =
        typeof window === 'undefined' ||
        window.confirm('任务已经开始生成，确认停止生成吗？已扣积分不会返还。')
      if (!confirmed) return
    }
    onPause?.()
  }
  return (
    <div className={compact ? 'task-controls compact' : 'job-controls task-controls'}>
      {showPause && (
        <IconButton
          label={job.status === 'running' ? '停止生成（积分不返还）' : '暂停任务'}
          disabled={busy}
          onClick={requestPause}
        >
          <Pause size={14} />
        </IconButton>
      )}
      {showResume && (
        <IconButton label="继续任务" disabled={busy} onClick={onResume}>
          <Play size={14} fill="currentColor" />
        </IconButton>
      )}
      {showDelete && (
        <IconButton
          label={
            canCancelRunning
              ? '取消上游任务并退回积分'
              : job.status === 'queued'
                ? '删除任务并退回积分'
                : '移出队列'
          }
          className="danger"
          disabled={busy}
          onClick={onDelete}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
        </IconButton>
      )}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, children }) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}

export function JobRow({
  job,
  compact = false,
  busy = false,
  onPause,
  onResume,
  onDelete,
  onPreviewResult,
  onFreezeDelivery,
  onInspectDelivery,
}) {
  const canCancelRunning = canCancelRunningTask(job)
  const canPreviewInApp = ['image', 'video'].includes(job.kind) && typeof onPreviewResult === 'function'
  const physics = physicsSummary(job)
  const icon =
    job.status === 'failed' ? (
      <XCircle size={15} />
    ) : job.status === 'completed' ? (
      <Check size={15} />
    ) : job.status === 'running' ? (
      <LoaderCircle size={15} className="spin" />
    ) : job.status === 'paused' ? (
      <Pause size={15} />
    ) : (
      <Clock3 size={15} />
    )
  const runningSeconds =
    job.status === 'running'
      ? Math.max(
          0,
          Math.floor(
            (Date.now() -
              Date.parse(job.metadata?.providerSubmittedAt || job.createdAt || job.updatedAt || '')) /
              1_000,
          ),
        )
      : 0

  return (
    <div className={`job-row ${compact ? 'compact' : ''}`}>
      <div className={`job-icon ${job.status}`}>{icon}</div>
      <div className="job-main">
        <div>
          <strong>{job.label}</strong>
          <span>
            {job.type} · {job.cost} 积分
          </span>
        </div>
        {job.status === 'running' && (
          <div className="job-progress">
            <span style={{ width: `${job.progress}%` }} />
          </div>
        )}
        {job.status === 'running' && !canCancelRunning && (
          <p className="job-provider-note">
            {job.provider === 'local-compose'
              ? compositionStageLabel(job)
              : '生成已开始，点击暂停按钮可确认停止；已扣积分不会返还。'}
          </p>
        )}
        {canCancelRunning && (
          <p className={`job-provider-note ${runningSeconds >= 360 ? 'delayed' : ''}`}>
            {runningSeconds >= 360
              ? `上游仍在处理，已等待 ${formatRunningTime(runningSeconds)}；进度长时间不变时系统会自动取消旧任务并重试，无需一直等待。`
              : `上游生成中 · 已等待 ${formatRunningTime(runningSeconds)}；取消成功后会移出队列并退回平台积分。`}
          </p>
        )}
        {physics && (
          <p className={`job-physics-note ${physics.status}`}>
            <strong>物理验收：{physics.label}</strong>
            {physics.reason && <span>阻塞原因：{physics.reason}</span>}
          </p>
        )}
        {onInspectDelivery && (
          <button className="job-delivery-link" type="button" onClick={onInspectDelivery}>
            查看交付核验
          </button>
        )}
        {onFreezeDelivery && (
          <button className="job-freeze-contract-link" type="button" onClick={onFreezeDelivery}>
            冻结交付合同
          </button>
        )}
        {job.status === 'failed' && <p className="job-error">{job.error || '生成失败，请重新提交'}</p>}
      </div>
      <div className="job-actions">
        {job.status === 'completed' &&
          job.resultUrl &&
          (canPreviewInApp ? (
            <button className="job-result" type="button" onClick={() => onPreviewResult(job)}>
              {job.kind === 'video' ? <Video size={13} /> : <Images size={13} />}
              {job.kind === 'video' ? '预览视频' : '查看结果'}
            </button>
          ) : (
            <a className="job-result" href={job.resultUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> 查看结果
            </a>
          ))}
        <TaskControls
          job={job}
          compact={compact}
          busy={busy}
          onPause={onPause}
          onResume={onResume}
          onDelete={onDelete}
        />
      </div>
      <span className={`job-state ${job.status}`}>
        {jobStateLabel(job)}
        {job.metadata?.creditsRefundedAt && <small>已退款</small>}
      </span>
    </div>
  )
}

function formatRunningTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 60) return `${Math.max(0, seconds || 0)} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function jobStateLabel(job) {
  if (job.status === 'failed') return '失败'
  if (job.status === 'cancelled') return '已取消'
  if (job.status === 'completed') return '已完成'
  if (job.status === 'running') return `${job.progress}%`
  if (job.status === 'paused') return '已暂停'
  return '等待中'
}

function compositionStageLabel(job) {
  const stage = job.metadata?.compositionStage
  const index = Number(job.metadata?.compositionSourceIndex)
  const count = Number(job.metadata?.compositionSourceCount)
  if (stage === 'downloading' && Number.isInteger(index) && index > 0) {
    return Number.isInteger(count) && count > 0
      ? `正在读取第 ${index}/${count} 个镜头视频，完成后将自动合成。`
      : `正在读取第 ${index} 个镜头视频，完成后将自动合成。`
  }
  if (stage === 'composing') return '镜头已就绪，FFmpeg 正在合成完整预览。'
  if (stage === 'uploading') return '完整预览已合成，正在上传并写回项目。'
  if (stage === 'preparing') return '正在准备镜头文件和合成任务。'
  return '完整预览合成中，平台会持续处理。'
}

const PHYSICS_STATUS_LABELS = {
  passed: '通过',
  failed: '失败',
  'needs-evidence': '缺少逐帧证据',
  'pending-evidence': '待逐帧证据',
  pending: '待逐帧证据',
  needs_evidence: '缺少逐帧证据',
}

function physicsSummary(job) {
  const metadata = job?.metadata
  const audit = metadata?.rigidPhysicsAudit
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return null
  const status = String(audit.status || 'pending-evidence')
  const label = PHYSICS_STATUS_LABELS[status] || status
  const firstViolation = Array.isArray(audit.violations) ? audit.violations[0] : null
  const reason = String(
    metadata.rigidPhysicsBlockingReason ||
      audit.blockingReason ||
      (firstViolation && (firstViolation.detail || firstViolation.code)) ||
      (status === 'pending-evidence' || status === 'pending' || status === 'needs-evidence' || status === 'needs_evidence'
        ? '等待底脚与连接点逐帧证据'
        : ''),
  ).trim()
  return { status, label, reason: status === 'passed' ? '' : reason }
}
