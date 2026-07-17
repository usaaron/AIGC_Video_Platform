import { Check, Clock3, LoaderCircle } from 'lucide-react'

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

export function JobRow({ job, compact = false }) {
  const icon =
    job.status === 'completed' ? (
      <Check size={15} />
    ) : job.status === 'running' ? (
      <LoaderCircle size={15} className="spin" />
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
      </div>
      <span className={`job-state ${job.status}`}>
        {job.status === 'completed' ? '已完成' : job.status === 'running' ? `${job.progress}%` : '等待中'}
      </span>
    </div>
  )
}
