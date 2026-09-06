import { Check, RefreshCw, X } from 'lucide-react'
import { Component } from 'react'
import { BrandMark } from './BrandMark'
import { IconButton } from './ui'

export function WorkspaceLoading({ fullPage = false }) {
  return (
    <div className={fullPage ? 'app-loading' : 'workspace-loading'}>
      <BrandMark size={20} spin />
      <div>
        <strong>正在打开工作台</strong>
        <p>同步页面与项目数据...</p>
      </div>
    </div>
  )
}

export function WorkspaceLoadError({ message, onRetry }) {
  return (
    <div className="workspace-loading workspace-loading-error" role="alert">
      <X size={21} />
      <div>
        <strong>项目暂时打不开</strong>
        <p>{message || '项目数据同步失败，请重试。'}</p>
        <button className="button primary" type="button" onClick={onRetry}>
          <RefreshCw size={15} /> 重新打开
        </button>
      </div>
    </div>
  )
}

export class WorkspaceErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(previousProps) {
    if (previousProps.projectId !== this.props.projectId && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <WorkspaceLoadError
          message="当前项目页面数据异常，请重新打开项目。"
          onRetry={() => {
            this.setState({ error: null })
            this.props.onRetry?.()
          }}
        />
      )
    }
    return this.props.children
  }
}

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
