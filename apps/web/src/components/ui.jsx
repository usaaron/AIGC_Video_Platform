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
import './ui.css'

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

export function JobRow({ job, compact = false, busy = false, onPause, onResume, onDelete, onPreviewResult }) {
  const canCancelRunning = job.status === 'running' && job.metadata?.providerName === 'stringx-seedance'
  const canPreviewInApp = ['image', 'video'].includes(job.kind) && typeof onPreviewResult === 'function'
  const copyrightRejected =
    job.kind === 'video' &&
    job.status === 'failed' &&
    job.metadata?.providerFailureSource === 'upstream' &&
    job.metadata?.providerFailureCode === 'UPSTREAM_COPYRIGHT_REJECTED'
  const checkingVideo = !copyrightRejected && videoResultChecking(job)
  const estimatedVideo =
    job.kind === 'video' &&
    job.status === 'running' &&
    job.provider !== 'local-compose' &&
    job.metadata?.providerProgressIsEstimated === true
  const displayStatus = checkingVideo ? 'running' : job.status
  const icon =
    displayStatus === 'failed' ? (
      <XCircle size={15} />
    ) : job.status === 'completed' ? (
      <Check size={15} />
    ) : displayStatus === 'running' ? (
      <LoaderCircle size={15} className="spin" />
    ) : job.status === 'paused' ? (
      <Pause size={15} />
    ) : (
      <Clock3 size={15} />
    )
  const runningSeconds =
    job.status === 'running' || checkingVideo
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
      <div className={`job-icon ${displayStatus}`}>{icon}</div>
      <div className="job-main">
        <div>
          <strong>{job.label}</strong>
          <span>
            {job.type} · {job.cost} 积分
          </span>
        </div>
        {job.status === 'running' && !estimatedVideo && !checkingVideo && (
          <div className="job-progress">
            <span style={{ width: `${job.progress}%` }} />
          </div>
        )}
        {checkingVideo ? (
          <p className="job-provider-note">正在核对结果，系统会自动接回已完成视频。</p>
        ) : estimatedVideo ? (
          <p className="job-provider-note">
            已等待 {formatRunningTime(runningSeconds)} · 完成后自动出现在分镜，无需停留此页。
          </p>
        ) : job.status === 'running' && !canCancelRunning ? (
          <p className="job-provider-note">
            {job.provider === 'local-compose'
              ? compositionStageLabel(job)
              : '第三方生成中，暂不可暂停或删除；若第三方失败，平台会自动退回积分。'}
          </p>
        ) : null}
        {canCancelRunning && !estimatedVideo && !checkingVideo && (
          <p className={`job-provider-note ${runningSeconds >= 360 ? 'delayed' : ''}`}>
            {runningSeconds >= 360
              ? `上游仍在处理，已等待 ${formatRunningTime(runningSeconds)}；进度长时间不变时系统会自动取消旧任务并重试，无需一直等待。`
              : `上游生成中 · 已等待 ${formatRunningTime(runningSeconds)}；取消成功后会移出队列并退回平台积分。`}
          </p>
        )}
        {job.status === 'failed' &&
          !checkingVideo &&
          (copyrightRejected ? (
            <>
              <p className="job-error job-error-summary">
                上游判定生成内容可能涉及版权限制，本次视频未生成。
              </p>
              {job.error && (
                <details className="job-error-details">
                  <summary>查看错误详情</summary>
                  <p>{job.error}</p>
                </details>
              )}
            </>
          ) : (
            <p className="job-error">{job.error || '生成失败，请重新提交'}</p>
          ))}
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
        {!compact && onDelete && (
          <div className="job-controls">
            {job.status === 'paused' ? (
              <IconButton label="继续任务" disabled={busy} onClick={onResume}>
                <Play size={14} fill="currentColor" />
              </IconButton>
            ) : job.status === 'queued' && onPause ? (
              <IconButton label="暂停任务" disabled={busy} onClick={onPause}>
                <Pause size={14} />
              </IconButton>
            ) : null}
            {(job.status !== 'running' || canCancelRunning) && (
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
        )}
      </div>
      <span className={`job-state ${displayStatus}`}>
        {checkingVideo ? '核对中' : estimatedVideo ? '生成中' : jobStateLabel(job)}
        {job.metadata?.creditsRefundedAt && <small>已退款</small>}
      </span>
    </div>
  )
}

function formatRunningTime(seconds) {
  if (!Number.isFinite(seconds)) return '片刻'
  if (seconds < 60) return `${Math.max(0, seconds)} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function videoResultChecking(job) {
  if (job.kind !== 'video' || job.provider === 'local-compose') return false
  const metadata = job.metadata ?? {}
  if (job.status === 'failed') {
    return (
      metadata.providerReconciliationStatus === 'pending' &&
      ['poll_error', 'processing_timeout'].includes(metadata.providerReconciliationReason)
    )
  }
  return (
    job.status === 'running' &&
    metadata.providerFailureSource === 'status_poll' &&
    typeof metadata.providerPollErrors === 'number' &&
    metadata.providerPollErrors > 0 &&
    typeof metadata.providerPollRetryNotBefore === 'string' &&
    Number.isFinite(Date.parse(metadata.providerPollRetryNotBefore))
  )
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
