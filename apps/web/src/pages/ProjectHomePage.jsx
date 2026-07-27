import {
  ArrowRight,
  CircleAlert,
  Clock3,
  FolderOpen,
  LoaderCircle,
  PauseCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { BrandMark } from '../components/BrandMark'
import { IconButton, PageHeader } from '../components/ui'

const AGENT_EXAMPLES = [
  {
    input: '帮我生成我朋友15s的短片',
    thinking: '已识别为短视频任务，准备进入人物、场景和镜头流程。',
    output: '15 秒 · 9:16 · 1 个主角 · 3 个镜头 · 预计 54 积分',
  },
  {
    input: '帮我生产60s的内容',
    thinking: '正在把时长拆成可连续生成的镜头段，并保留前后尾帧。',
    output: '60 秒 · 约 8 个镜头 · 自动建立 2 条连续性链路',
  },
  {
    input: '帮我生成5万字的都市悬疑故事',
    thinking: '长篇内容将先建立人物关系、案件主线和章节节奏。',
    output: '故事大纲 · 角色卡 · 线索表 · 章节规划 · 待确认后扩写',
  },
  {
    input: '帮我策划一部5万字的小说，每集一分钟，主角是个可以看见未来的摄影师',
    thinking: '已捕捉题材、主角能力和短剧节奏，准备生成一份可制作方案。',
    output: '60 集 · 每集 1 分钟 · 视觉风格建议 · 资产清单 · 分镜计划',
  },
]

export function ProjectHomePage({ projects, onCreate, onOpen, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [agentInput, setAgentInput] = useState('')
  const [agentExampleIndex, setAgentExampleIndex] = useState(0)
  const [agentTypedText, setAgentTypedText] = useState('')
  const [agentPhase, setAgentPhase] = useState('input')

  useEffect(() => {
    let cancelled = false
    let timer = null
    const example = AGENT_EXAMPLES[agentExampleIndex]
    let cursor = 0
    setAgentPhase('input')
    setAgentTypedText('')

    const typeNext = () => {
      if (cancelled) return
      cursor += 1
      setAgentTypedText(example.input.slice(0, cursor))
      if (cursor < example.input.length) {
        timer = window.setTimeout(typeNext, 38)
        return
      }
      setAgentPhase('planning')
      timer = window.setTimeout(() => {
        if (cancelled) return
        setAgentPhase('output')
        timer = window.setTimeout(() => {
          if (!cancelled) setAgentExampleIndex((index) => (index + 1) % AGENT_EXAMPLES.length)
        }, 2300)
      }, 1600)
    }

    timer = window.setTimeout(typeNext, 420)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [agentExampleIndex])

  const useAgentExample = (example) => {
    setAgentInput(example.input)
    setAgentPhase('input')
  }

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
                    {contentTypeLabel(project.contentType)} · {project.aspectRatio}
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

      <section className="project-agent-shell">
        <div className="project-agent-heading">
          <span className="project-agent-icon">
            <BrandMark className="project-agent-brand-mark" size={19} />
          </span>
          <div>
            <span className="eyebrow">创作 Agent</span>
            <h2>描述你想制作的内容</h2>
          </div>
          <span className="project-agent-status">
            <Sparkles size={13} /> 框架预览
          </span>
        </div>
        <div className="project-agent-stage" aria-live="polite">
          <div className="project-agent-stage-line project-agent-stage-user">
            <span>YOU</span>
            <strong>{agentTypedText || '等待你的创作指令'}</strong>
            {agentPhase === 'input' && <i className="project-agent-caret" />}
          </div>
          <div className={`project-agent-stage-line project-agent-stage-system ${agentPhase}`}>
            <span>SEQORA</span>
            <strong>
              {agentPhase === 'input' && '正在接收创作意图'}
              {agentPhase === 'planning' && AGENT_EXAMPLES[agentExampleIndex].thinking}
              {agentPhase === 'output' && AGENT_EXAMPLES[agentExampleIndex].output}
            </strong>
            {agentPhase === 'planning' && <BrandMark className="project-agent-stage-mark" size={11} spin />}
          </div>
        </div>
        <div className="project-agent-examples" aria-label="创作示例">
          <span>试试这样说</span>
          {AGENT_EXAMPLES.map((example) => (
            <button key={example.input} type="button" onClick={() => useAgentExample(example)}>
              {example.input}
            </button>
          ))}
        </div>
        <textarea
          value={agentInput}
          onChange={(event) => setAgentInput(event.target.value)}
          placeholder="例如：帮我策划一部 60 集的都市悬疑漫剧，每集 1 分钟，主角是一名能看见未来的摄影师……"
        />
        <div className="project-agent-footer">
          <div>
            <span>剧集规划</span>
            <span>剧本</span>
            <span>资产</span>
            <span>分镜</span>
            <span>生成</span>
          </div>
          <button className="button primary" disabled title="Agent 自动工作流将在后续版本开放">
            <BrandMark className="project-agent-button-mark" size={13} spin={agentPhase === 'planning'} />{' '}
            开始规划
          </button>
        </div>
      </section>
    </div>
  )
}

function contentTypeLabel(value) {
  if (value === 'advertisement') return '广告'
  if (value === 'animation') return '动画短片'
  return '短剧'
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
