import {
  ArrowRight,
  BookOpenText,
  CircleAlert,
  Clock3,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  PauseCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { BrandMark } from '../components/BrandMark'
import { IconButton, PageHeader } from '../components/ui'

const FUNCTION_STACK = [
  {
    id: 'agent',
    index: '01',
    eyebrow: 'ORCHESTRATOR / AGENT',
    title: '对话一句成片',
    description: '从一句创作意图开始，未来串起剧本、资产、分镜与成片。',
    icon: BrandMark,
    className: 'function-stack-card-agent',
    messages: [
      ['user', '帮我做一支 60 秒的赛博悬疑短片'],
      ['system', '已识别主题，准备规划故事与制作链路'],
      ['system', '剧本 · 资产 · 分镜 · 成片 · 待确认'],
    ],
  },
  {
    id: 'image',
    index: '02',
    eyebrow: 'IMAGE STUDIO',
    title: '图片大师',
    description: '独立生成角色、场景、物品和视觉参考图。',
    icon: ImagePlus,
    className: 'function-stack-card-image',
    messages: ['人物面部', '场景设定', '产品视觉'],
  },
  {
    id: 'script',
    index: '03',
    eyebrow: 'WRITING ROOM',
    title: '剧本大师',
    description: '面向长剧本的世界观、人物关系、分集与章节规划。',
    icon: BookOpenText,
    className: 'function-stack-card-script',
    messages: ['世界观', '人物关系', '分集大纲'],
  },
]

export function ProjectHomePage({ projects, onCreate, onOpen, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const beginRename = (project) => {
    setEditingId(project.id)
    setName(project.name)
    setError('')
  }

  const saveRename = async (event, project) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName || nextName === project.name) {
      setEditingId(null)
      return
    }
    setBusyId(project.id)
    setError('')
    try {
      await onRename(project.id, nextName)
      setEditingId(null)
    } catch (renameError) {
      setError(renameError.message)
    } finally {
      setBusyId(null)
    }
  }

  const removeProject = async (project) => {
    if (!window.confirm(`确定删除项目“${project.name}”吗？项目数据会进入归档。`)) return
    setBusyId(project.id)
    setError('')
    try {
      await onDelete(project.id)
    } catch (deleteError) {
      setError(deleteError.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page project-home-page">
      <PageHeader
        eyebrow="项目库"
        title="所有创作，一处管理"
        description="打开项目继续制作，或从一个新的故事开始。"
      >
        <button className="button primary" onClick={onCreate}>
          <Plus size={16} /> 新建项目
        </button>
      </PageHeader>

      <section className="project-library" aria-label="项目列表">
        <div className="project-library-heading">
          <div>
            <h2>最近项目</h2>
            <span>{projects.length} 个项目</span>
          </div>
        </div>
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
        <div className="project-folder-grid">
          {projects.map((project, index) => (
            <article className="project-folder" key={project.id}>
              <span className="project-folder-index">PROJECT / {String(index + 1).padStart(2, '0')}</span>
              <button className="project-folder-open" onClick={() => onOpen(project.id)}>
                <span
                  className={`project-folder-mark ${project.previewUrl ? 'has-preview' : ''}`}
                  aria-hidden="true"
                >
                  {project.previewUrl ? <img src={project.previewUrl} alt="" /> : <FolderOpen size={25} />}
                  <small>{String(index + 1).padStart(2, '0')}</small>
                </span>
                <span className="project-folder-copy">
                  <span className="project-folder-meta">
                    {contentTypeLabel(project.contentType)} · {visualStyleLabel(project.visualStyle)} ·{' '}
                    {project.aspectRatio}
                  </span>
                  <strong>{project.name}</strong>
                  <span className="project-folder-date">
                    <Clock3 size={13} /> {formatProjectDate(project.updatedAt)}
                  </span>
                  <ProjectGenerationState summary={project.generationSummary} />
                </span>
                <ArrowRight className="project-folder-arrow" size={18} />
              </button>
              <div className="project-folder-actions">
                <IconButton label="重命名项目" onClick={() => beginRename(project)}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  label="删除项目"
                  className="danger"
                  disabled={busyId === project.id}
                  onClick={() => void removeProject(project)}
                >
                  {busyId === project.id ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
                </IconButton>
              </div>
              {editingId === project.id && (
                <form className="project-folder-rename" onSubmit={(event) => void saveRename(event, project)}>
                  <input
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                  <button className="button primary" disabled={!name.trim() || busyId === project.id}>
                    {busyId === project.id ? <LoaderCircle size={14} className="spin" /> : '保存'}
                  </button>
                  <IconButton label="取消重命名" type="button" onClick={() => setEditingId(null)}>
                    <X size={15} />
                  </IconButton>
                </form>
              )}
            </article>
          ))}
          <button className="project-folder project-folder-create" onClick={onCreate}>
            <span>
              <Plus size={22} />
            </span>
            <strong>新建项目</strong>
          </button>
        </div>
      </section>

      <section className="function-stack" aria-label="功能栈">
        <header className="function-stack-heading">
          <div>
            <span className="eyebrow">FUNCTION STACK</span>
            <h2>把创作拆成三个入口</h2>
            <p>先从最适合你的工作方式开始，项目内的素材和风格会在后续流程中保持一致。</p>
          </div>
          <span className="function-stack-rule">序幕 / 01</span>
        </header>
        <div className="function-stack-grid">
          {FUNCTION_STACK.map((item) => (
            <FunctionStackCard item={item} key={item.id} />
          ))}
        </div>
      </section>
    </div>
  )
}

function contentTypeLabel(value) {
  if (value === 'advertisement') return '广告'
  if (value === 'animation') return '短片'
  return '网剧'
}

function visualStyleLabel(value) {
  if (value === 'photorealistic') return '仿真人'
  if (value === 'chinese-2d' || value === 'anime') return '2D风'
  if (value === 'chinese-3d') return '3D风'
  if (value === 'storybook') return '绘本风'
  return 'CG风'
}

function FunctionStackCard({ item }) {
  const Icon = item.icon
  return (
    <article className={`function-stack-card ${item.className}`}>
      <div className="function-stack-card-topline">
        <span>{item.index}</span>
        <span>{item.eyebrow}</span>
        <i />
      </div>
      <div className="function-stack-card-title">
        <span className="function-stack-card-icon">
          <Icon size={item.id === 'agent' ? 20 : 18} />
        </span>
        <div>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </div>
      </div>
      {item.id === 'agent' ? (
        <div className="function-stack-agent-preview" aria-hidden="true">
          {item.messages.map(([role, message]) => (
            <div className={`function-stack-message ${role}`} key={message}>
              <span>{role === 'user' ? 'YOU' : 'SEQORA'}</span>
              <strong>{message}</strong>
            </div>
          ))}
          <span className="function-stack-agent-pulse" />
        </div>
      ) : (
        <div className="function-stack-tool-preview" aria-hidden="true">
          {item.messages.map((message, index) => (
            <span key={message} style={{ '--stack-delay': `${index * 120}ms` }}>
              {message}
            </span>
          ))}
        </div>
      )}
      <footer className="function-stack-card-footer">
        <span>本期 UI 已就绪 · 功能开发中</span>
        <button type="button" className="function-stack-open" disabled title="该功能将在后续版本开放">
          即将开放 <ArrowRight size={14} />
        </button>
      </footer>
    </article>
  )
}

function ProjectGenerationState({ summary }) {
  if (!summary || !summary.latest.length) {
    return (
      <span className="project-folder-state">
        <i /> 可继续制作
      </span>
    )
  }

  return (
    <span className="project-generation-summary">
      <span className="project-generation-counts">
        {summary.running > 0 && (
          <b className="running">
            <LoaderCircle size={11} className="spin" /> 生成中 {summary.running}
          </b>
        )}
        {summary.queued > 0 && <b className="queued">排队 {summary.queued}</b>}
        {summary.paused > 0 && (
          <b className="paused">
            <PauseCircle size={10} /> 暂停 {summary.paused}
          </b>
        )}
        {summary.failed > 0 && (
          <b className="failed">
            <CircleAlert size={10} /> 错误 {summary.failed}
          </b>
        )}
      </span>
      {summary.latest.slice(0, 2).map((task) => (
        <span className={`project-generation-task ${task.status}`} key={task.id}>
          <i />
          <span>{task.label}</span>
          <small>{taskStatusLabel(task)}</small>
        </span>
      ))}
    </span>
  )
}

function taskStatusLabel(task) {
  if (task.status === 'running') return `${task.progress}%`
  if (task.status === 'queued') return '排队'
  if (task.status === 'paused') return '暂停'
  return '失败'
}

function formatProjectDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
