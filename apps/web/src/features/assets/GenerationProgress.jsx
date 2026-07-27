import { AlertCircle, CheckCircle2, CircleDot } from 'lucide-react'
import { BrandMark } from '../../components/BrandMark'

const PHASES = [
  { id: 'request', label: '发起申请', detail: '已加入生成队列' },
  { id: 'model', label: '调用模型', detail: '正在连接 Img2' },
  { id: 'produce', label: '生产中', detail: '模型正在绘制资产' },
]

export function GenerationProgress({ task, busy = false, compact = false }) {
  const phase = resolvePhase(task, busy)
  const failed = task?.status === 'failed' || task?.status === 'cancelled'
  const completed = task?.status === 'completed'

  if (failed) {
    return (
      <div
        className={`generation-progress ${compact ? 'compact' : ''} failed`}
        role="status"
        aria-live="polite"
      >
        <AlertCircle size={compact ? 14 : 20} />
        <div>
          <strong>{task.status === 'cancelled' ? '生成已取消' : '生成失败'}</strong>
          {!compact && <span>{task.error || '可返回资产卡片重新生成'}</span>}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`generation-progress ${compact ? 'compact' : ''} ${completed ? 'completed' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="generation-progress-head">
        {completed ? (
          <CheckCircle2 size={compact ? 14 : 20} />
        ) : (
          <BrandMark className="generation-progress-brand" size={compact ? 12 : 18} spin />
        )}
        <div>
          <strong>{completed ? '资产已生成' : PHASES[phase].label}</strong>
          {!compact && <span>{completed ? '可以预览并确认资产' : phaseDetail(task, busy, phase)}</span>}
        </div>
        {!completed && task?.status === 'running' && <b>{task.progress}%</b>}
      </div>
      {!compact && (
        <div className="generation-progress-steps" aria-hidden="true">
          {PHASES.map((item, index) => (
            <span
              key={item.id}
              className={index < phase || completed ? 'done' : index === phase ? 'active' : ''}
            >
              {index < phase || completed ? <CheckCircle2 size={12} /> : <CircleDot size={12} />}
              {item.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function resolvePhase(task, busy) {
  if (busy || !task || task.status === 'queued' || task.status === 'paused') return 0
  if (
    task.status === 'running' &&
    ['submitting', 'queued', 'pending'].includes(String(task.metadata?.providerState || ''))
  )
    return 1
  if (task.status === 'running') return 2
  return 2
}

function phaseDetail(task, busy, phase) {
  if (busy) return '正在提交资产参数'
  if (task?.status === 'paused') return '任务已暂停，可在生成队列恢复'
  if (task?.status === 'queued') return '等待可用并发资源'
  return PHASES[phase].detail
}
