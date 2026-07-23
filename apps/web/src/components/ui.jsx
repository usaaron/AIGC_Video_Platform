import { Check, Clock3, ExternalLink, LoaderCircle, Pause, Play, Trash2, XCircle } from 'lucide-react'

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

export function JobRow({ job, compact = false, busy = false, onPause, onResume, onDelete }) {
  const canCancelRunning = job.status === 'running' && job.metadata?.providerName === 'stringx-seedance'
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
            第三方生成中，暂不可暂停或删除；若第三方失败，平台会自动退回积分。
          </p>
        )}
        {canCancelRunning && (
          <p className="job-provider-note">弦序生成中可取消；取消成功后会移出队列并退回平台积分。</p>
        )}
        {job.status === 'failed' && <p className="job-error">{job.error || '生成失败，请重新提交'}</p>}
      </div>
      <div className="job-actions">
        {job.status === 'completed' && job.resultUrl && (
          <a className="job-result" href={job.resultUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> 查看结果
          </a>
        )}
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
                    ? '取消弦序任务并退回积分'
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
      <span className={`job-state ${job.status}`}>
        {jobStateLabel(job)}
        {job.metadata?.creditsRefundedAt && <small>已退款</small>}
      </span>
    </div>
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
