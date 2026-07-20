import { ScanFace } from 'lucide-react'

export function CharacterStagePanel({ eyebrow, title, description, task, reference, emptyText, children }) {
  return (
    <div className="character-stage-panel">
      <div className="character-stage-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="character-stage-preview">
        {reference?.url ? (
          <img src={reference.url} alt={title} />
        ) : (
          <div>
            <ScanFace size={25} />
            <span>{emptyText}</span>
          </div>
        )}
        {task && <TaskState task={task} />}
      </div>
      <div className="character-stage-actions">{children}</div>
    </div>
  )
}

function TaskState({ task }) {
  const labels = {
    queued: '排队中',
    running: `生成中 ${task.progress}%`,
    completed: '候选已生成',
    failed: '生成失败',
  }
  return (
    <span className={`character-task-state ${task.status}`} role="status" aria-live="polite">
      {labels[task.status] || task.status}
    </span>
  )
}
