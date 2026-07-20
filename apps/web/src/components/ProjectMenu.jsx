import { Check, X } from 'lucide-react'
import { IconButton } from './ui'
import './projectMenu.css'

export function ProjectMenu({ projects, currentId, onClose, onSelect, onCreate }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal project-menu" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">项目</span>
            <h2>切换项目</h2>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="project-menu-list">
          {projects.map((item) => (
            <button
              key={item.id}
              className={item.id === currentId ? 'active' : ''}
              onClick={() => onSelect(item.id)}
            >
              <span>{item.name}</span>
              <small>
                {item.status === 'producing' ? '制作中' : '草稿'} · v{item.version}
              </small>
              {item.id === currentId && <Check size={16} />}
            </button>
          ))}
        </div>
        <button className="button primary full" onClick={onCreate}>
          新建项目
        </button>
      </div>
    </div>
  )
}
