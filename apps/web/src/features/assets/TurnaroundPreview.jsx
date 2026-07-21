import { Images } from 'lucide-react'

import { isActive, viewLabel } from './characterWorkflowUtils'

export function TurnaroundPreview({ task, outputs, disabled, onRegenerateView }) {
  if (!outputs.length) {
    return (
      <div className="turnaround-empty">
        <Images size={28} />
        <span>{isActive(task) ? `正在生成源图 ${task.progress}%` : '完成面部和全身定稿后生成'}</span>
      </div>
    )
  }
  const selected = outputs.slice(0, 3)
  return (
    <div className="turnaround-sheet-preview">
      {selected.map((output) => {
        const label = viewLabel(output.view)
        return (
          <div key={output.id}>
            <img src={output.url} alt={label} />
            <span>{label}</span>
            <button
              type="button"
              aria-label={`重生${label}`}
              disabled={disabled}
              onClick={() => onRegenerateView(output.view)}
            >
              重生
            </button>
          </div>
        )
      })}
    </div>
  )
}
