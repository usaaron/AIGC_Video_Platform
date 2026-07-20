import { useState } from 'react'
import { ArrowRight, Clock3, ListChecks, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { latestVideoTaskForShot } from '../features/generation/taskResults'
import { CameraMoveGuide } from '../features/storyboard/CameraMoveGuide'

export function StoryboardPage({
  shots,
  tasks = [],
  onRegenerate,
  onCreate,
  onUpdate,
  onGenerate,
  onRetry,
  onNext,
}) {
  const [selected, setSelected] = useState(shots[0]?.id)
  const [editing, setEditing] = useState(null)
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0)

  return (
    <div className="page storyboard-page">
      <PageHeader
        eyebrow="第 3 步 · 分镜"
        title="列表式镜头管理"
        description="像清单一样管理镜头标题、时长和画面提示词。"
      >
        <button className="button secondary" onClick={onRegenerate}>
          <RefreshCw size={16} /> 按剧本拆分
        </button>
        <button className="button primary" onClick={() => shots.forEach((shot) => void onGenerate(shot))}>
          <Sparkles size={16} /> 生成全部镜头
        </button>
      </PageHeader>
      <div className="storyboard-summary">
        <span>
          <ListChecks size={16} /> 镜头列表
        </span>
        <div>
          <span>{shots.length} 个镜头</span>
          <span>{totalDuration} 秒</span>
        </div>
      </div>
      <div className="shot-list">
        {shots.map((shot) => {
          const task = latestVideoTaskForShot(tasks, shot.id)
          const canRetry = task?.status === 'failed' || task?.status === 'cancelled'
          const isActive = task?.status === 'queued' || task?.status === 'running'
          return (
            <article
              className={`shot-row ${selected === shot.id ? 'selected' : ''}`}
              key={shot.id}
              onClick={() => setSelected(shot.id)}
            >
              <div className="shot-number">{String(shot.order).padStart(2, '0')}</div>
              <div className="shot-thumb">
                <img src={shot.imageUrl || '/demo/station.jpg'} alt={shot.title} />
                <span>{shot.framing}</span>
              </div>
              <div className="shot-content">
                <div>
                  <h3>{shot.title}</h3>
                  <span>
                    <Clock3 size={13} /> {shot.duration} 秒
                  </span>
                </div>
                <p>{shot.prompt}</p>
                {task && <small className={`shot-task-state ${task.status}`}>{shotTaskLabel(task)}</small>}
              </div>
              <div className="shot-actions">
                <button
                  className="shot-text-action"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setEditing(shot)
                  }}
                >
                  编辑
                </button>
                <button
                  className="shot-text-action primary"
                  type="button"
                  disabled={isActive}
                  onClick={(event) => {
                    event.stopPropagation()
                    void (canRetry && onRetry ? onRetry(shot) : onGenerate(shot))
                  }}
                >
                  生成
                </button>
              </div>
            </article>
          )
        })}
      </div>
      <button className="storyboard-add" onClick={() => setEditing({})}>
        <Plus size={17} /> 添加镜头
      </button>
      <div className="sticky-actions">
        <span>预计消耗 {shots.length * 18} 积分。</span>
        <button className="button primary" onClick={onNext}>
          查看生成队列 <ArrowRight size={16} />
        </button>
      </div>
      {editing && (
        <ShotEditor
          shot={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function shotTaskLabel(task) {
  if (task.status === 'failed') return '生成失败，可单镜头重试'
  if (task.status === 'cancelled') return '已取消，可单镜头重试'
  if (task.status === 'running') return `生成中 ${task.progress}%`
  if (task.status === 'queued') return '等待生成'
  if (task.status === 'completed') return '视频已生成'
  return task.status
}

function ShotEditor({ shot, onClose, onSave }) {
  const [title, setTitle] = useState(shot.title || '')
  const [framing, setFraming] = useState(shot.framing || '中景')
  const [duration, setDuration] = useState(shot.duration || 4)
  const [prompt, setPrompt] = useState(shot.prompt || '')
  const [imageUrl, setImageUrl] = useState(shot.imageUrl || '')

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal shot-editor-modal"
        onSubmit={(event) => {
          event.preventDefault()
          void onSave({ title, framing, duration: Number(duration), prompt, imageUrl: imageUrl || null })
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">分镜</span>
            <h2>{shot.id ? '编辑镜头' : '添加镜头'}</h2>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="field-grid">
          <label>
            <span>镜头标题</span>
            <input
              className="text-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label>
            <span>景别</span>
            <select value={framing} onChange={(event) => setFraming(event.target.value)}>
              <option>大全景</option>
              <option>广角</option>
              <option>中景</option>
              <option>中近景</option>
              <option>特写</option>
              <option>俯拍</option>
            </select>
          </label>
          <label>
            <span>时长（秒）</span>
            <input
              className="text-input"
              type="number"
              min="1"
              max="120"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <label>
            <span>预览图片 URL</span>
            <input
              className="text-input"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />
          </label>
        </div>
        <label className="field-label">画面提示词</label>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <CameraMoveGuide prompt={prompt} onPromptChange={setPrompt} />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            保存分镜
          </button>
        </div>
      </form>
    </div>
  )
}
