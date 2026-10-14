import { AlertCircle, CheckCircle2, LoaderCircle, ScanFace } from 'lucide-react'
import { TaskControls } from '../../components/ui'

export function CharacterStagePanel({
  eyebrow,
  title,
  description,
  task,
  reference,
  previewMode = 'cover',
  emptyText,
  onPreview,
  showTaskState = true,
  onPauseTask,
  onResumeTask,
  onDeleteTask,
  busyTaskId = null,
  children,
}) {
  return (
    <div className="character-stage-panel">
      <div className="character-stage-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className={`character-stage-preview ${previewMode === 'contain' ? 'contain' : ''}`}>
        {reference?.url ? (
          <button type="button" aria-label={`放大查看${title}`} onClick={() => onPreview(reference)}>
            <img src={reference.url} alt={title} />
          </button>
        ) : (
          <div className="character-stage-empty">
            <ScanFace size={25} />
            <span>{emptyText}</span>
          </div>
        )}
        {showTaskState && task && <TaskState task={task} />}
        {task && ['queued', 'paused', 'running'].includes(task.status) && (
          <TaskControls
            job={task}
            compact
            busy={busyTaskId === task.id}
            onPause={onPauseTask ? () => onPauseTask(task.id) : undefined}
            onResume={onResumeTask ? () => onResumeTask(task.id) : undefined}
            onDelete={onDeleteTask ? () => onDeleteTask(task.id) : undefined}
          />
        )}
      </div>
      <div className="character-stage-actions">{children}</div>
    </div>
  )
}

function TaskState({ task }) {
  const failed = task.status === 'failed' || task.status === 'cancelled'
  const completed = task.status === 'completed'
  const running = task.status === 'running'
  const label = completed
    ? '资产已生成'
    : failed
      ? task.status === 'cancelled'
        ? '已取消'
        : '生成失败'
      : task.status === 'queued' || task.status === 'paused'
        ? '等待生成'
        : '生成中'

  return (
    <div
      className={`character-task-state ${completed ? 'completed' : ''} ${failed ? 'failed' : ''}`}
      role="status"
      aria-live="polite"
    >
      {failed ? (
        <AlertCircle size={12} />
      ) : completed ? (
        <CheckCircle2 size={12} />
      ) : (
        <LoaderCircle size={12} className={running ? 'spin' : ''} />
      )}
      <span>{label}</span>
      {running && typeof task.progress === 'number' && <b>{task.progress}%</b>}
    </div>
  )
}
