import {
  ArrowRight,
  ArrowUp,
  CircleAlert,
  Clock3,
  FolderOpen,
  LoaderCircle,
  PauseCircle,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { IconButton, PageHeader } from '../components/ui'

export function ProjectHomePage({ projects, onCreate, onOpen, onRename, onDelete, onStartAgent }) {
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [idea, setIdea] = useState('')
  const visibleProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()),
  )

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
      <PageHeader eyebrow="序幕工作室" title="开始你的下一部作品" />
      <section className="studio-start" aria-label="一句成片入口">
        <div className="studio-start-heading">
          <Sparkles size={21} />
          <h2>你想拍一个怎样的故事？</h2>
          <span>一句成片</span>
        </div>
        <form
          className="studio-idea-composer"
          onSubmit={(event) => {
            event.preventDefault()
            ;(onStartAgent || onCreate)(idea.trim())
          }}
        >
          <textarea
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            aria-label="创作想法"
            placeholder="说几个点就好。主角是谁，发生了什么，想要什么风格…"
            rows={3}
            maxLength={4000}
          />
          <div>
            <span>
              <i /> 描述想法 · 确认方案 · 开始制作
            </span>
            <button
              type="submit"
              className="studio-idea-submit"
              aria-label="用这个想法开始创作"
              title="开始创作"
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </form>
        <div className="studio-start-options">
          <div>
            {['雨夜悬疑短剧', '新品发布广告', '治愈系动画短片'].map((prompt) => (
              <button key={prompt} type="button" onClick={() => setIdea(prompt)}>
                {prompt}
                <ArrowRight size={12} />
              </button>
            ))}
          </div>
          <button type="button" onClick={onCreate}>
            <SlidersHorizontal size={14} /> 自己掌控制作
          </button>
        </div>
      </section>

      <section className="project-library" aria-label={projects.length ? '项目列表' : '新项目欢迎页'}>
        <div className="project-library-heading">
          <div>
            <h2>我的项目</h2>
            <span>{projects.length} 个项目</span>
          </div>
          <div className="project-library-controls">
            <label className="project-library-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索项目"
                aria-label="搜索项目"
              />
            </label>
            <button type="button" className="button secondary" onClick={onCreate}>
              <Plus size={15} /> 新建项目
            </button>
          </div>
        </div>
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
        <div className="project-folder-grid">
          {visibleProjects.map((project, index) => (
            <article className="project-folder" key={project.id}>
              <button className="project-folder-open" onClick={() => onOpen(project.id)}>
                <span
                  className={`project-folder-mark ${project.previewUrl ? 'has-preview' : ''}`}
                  aria-hidden="true"
                >
                  {project.previewUrl ? (
                    <img src={project.previewUrl} alt="" />
                  ) : (
                    <>
                      <FolderOpen size={27} />
                      <span>STORY {String(index + 1).padStart(2, '0')}</span>
                    </>
                  )}
                  <small>{project.aspectRatio}</small>
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
        </div>
        {!projects.length && (
          <div className="studio-project-empty">
            <FolderOpen size={28} />
            <h3>欢迎来到序幕 TV</h3>
            <p>从一个想法，开始你的第一部作品。</p>
            <button className="button secondary" onClick={onCreate}>
              <Plus size={16} /> 创建第一个项目
            </button>
          </div>
        )}
        {projects.length > 0 && !visibleProjects.length && (
          <p className="studio-project-search-empty">没有找到“{query}”相关的项目。</p>
        )}
      </section>
    </div>
  )
}

export function ProjectEmptyWelcome({ onCreate }) {
  return <ProjectHomePage projects={[]} onCreate={onCreate} />
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
