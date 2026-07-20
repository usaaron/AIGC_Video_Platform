import { useState } from 'react'
import { ArrowRight, Clock3, ListChecks, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { latestVideoTaskForShot } from '../features/generation/taskResults'
import { CameraMoveGuide } from '../features/storyboard/CameraMoveGuide'
import { batchGenerationPlan } from '../features/storyboard/shotGenerationPlan'

const assetKindLabels = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  costume: '服装',
  audio: '音频',
}

export function StoryboardPage({
  shots,
  assets = [],
  tasks = [],
  billing,
  onRegenerate,
  onCreate,
  onUpdate,
  onGenerate,
  onRetry,
  onNext,
}) {
  const [selected, setSelected] = useState(shots[0]?.id)
  const [editing, setEditing] = useState(null)
  const [confirmingBatch, setConfirmingBatch] = useState(false)
  const [submittingBatch, setSubmittingBatch] = useState(false)
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0)
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const plan = batchGenerationPlan(shots, tasks, billing?.credits ?? 0)

  const submitBatch = async () => {
    setSubmittingBatch(true)
    try {
      for (const item of plan.items) {
        if (item.action === 'retry' && onRetry) await onRetry(item.shot)
        else await onGenerate(item.shot, { rethrow: true })
      }
      setConfirmingBatch(false)
    } finally {
      setSubmittingBatch(false)
    }
  }

  return (
    <div className="page storyboard-page">
      <PageHeader
        eyebrow="第 3 步 · 分镜"
        title="列表式镜头管理"
        description="逐条确认标题、时长、提示词和引用资产；批量生成前先确认预算。"
      >
        <button className="button secondary" onClick={onRegenerate}>
          <RefreshCw size={16} /> 按剧本重拆
        </button>
        <button
          className="button primary"
          onClick={() => setConfirmingBatch(true)}
          disabled={!plan.items.length}
        >
          <Sparkles size={16} /> 生成未完成镜头
        </button>
      </PageHeader>
      <div className="storyboard-summary">
        <span>
          <ListChecks size={16} /> 镜头列表
        </span>
        <div>
          <span>{shots.length} 个镜头</span>
          <span>{totalDuration} 秒</span>
          <span>待提交 {plan.items.length} 条</span>
        </div>
      </div>
      <div className="shot-list">
        {shots.map((shot) => {
          const task = latestVideoTaskForShot(tasks, shot.id)
          const canRetry = task?.status === 'failed' || task?.status === 'cancelled'
          const isActive = task?.status === 'queued' || task?.status === 'running'
          const referencedAssets = (shot.assetIds || [])
            .map((assetId) => assetsById.get(assetId))
            .filter(Boolean)
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
                <div className="shot-asset-chips">
                  {referencedAssets.length ? (
                    referencedAssets.map((asset) => (
                      <span key={asset.id}>
                        {assetKindLabels[asset.kind]} · {asset.name}
                      </span>
                    ))
                  ) : (
                    <span className="muted">未引用资产</span>
                  )}
                </div>
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
                  {canRetry ? '重试' : task?.status === 'completed' ? '重生成' : '生成'}
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
        <span>
          批量最高消耗 {plan.estimatedCredits} 积分，余额 {billing?.credits ?? 0}。
        </span>
        <button className="button primary" onClick={onNext}>
          查看生成队列 <ArrowRight size={16} />
        </button>
      </div>
      {editing && (
        <ShotEditor
          shot={editing}
          assets={assets}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
        />
      )}
      {confirmingBatch && (
        <BatchGenerateModal
          plan={plan}
          credits={billing?.credits ?? 0}
          isSubmitting={submittingBatch}
          onClose={() => setConfirmingBatch(false)}
          onConfirm={submitBatch}
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

function ShotEditor({ shot, assets, onClose, onSave }) {
  const [title, setTitle] = useState(shot.title || '')
  const [framing, setFraming] = useState(shot.framing || '中景')
  const [duration, setDuration] = useState(shot.duration || 4)
  const [prompt, setPrompt] = useState(shot.prompt || '')
  const [imageUrl, setImageUrl] = useState(shot.imageUrl || '')
  const [assetIds, setAssetIds] = useState(shot.assetIds || [])

  const toggleAsset = (assetId) => {
    setAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal shot-editor-modal"
        onSubmit={(event) => {
          event.preventDefault()
          void onSave({
            title,
            framing,
            duration: Number(duration),
            prompt,
            assetIds,
            imageUrl: imageUrl || null,
          })
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
        <label className="field-label">引用资产</label>
        <div className="shot-asset-picker">
          {assets.length ? (
            assets.map((asset) => (
              <button
                type="button"
                key={asset.id}
                className={assetIds.includes(asset.id) ? 'active' : ''}
                onClick={() => toggleAsset(asset.id)}
              >
                <span>{assetKindLabels[asset.kind] || asset.kind}</span>
                <strong>{asset.name}</strong>
              </button>
            ))
          ) : (
            <p>还没有可引用资产，先到资产页创建角色、场景、道具或音频。</p>
          )}
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

function BatchGenerateModal({ plan, credits, isSubmitting, onClose, onConfirm }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal batch-generate-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">预算确认</span>
            <h2>批量生成未完成镜头</h2>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="batch-budget-summary">
          <div>
            <span>提交镜头</span>
            <strong>{plan.items.length}</strong>
          </div>
          <div>
            <span>最高消耗</span>
            <strong>{plan.estimatedCredits} 积分</strong>
          </div>
          <div>
            <span>当前余额</span>
            <strong>{credits} 积分</strong>
          </div>
        </div>
        <div className="batch-shot-list">
          {plan.items.map((item) => (
            <span key={item.shot.id}>
              {String(item.shot.order).padStart(2, '0')} · {item.shot.title} ·{' '}
              {item.action === 'retry' ? '重试' : '新建任务'}
            </span>
          ))}
        </div>
        {!plan.canSubmit && <p className="modal-warning">积分不足或没有待提交镜头，无法批量提交。</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!plan.canSubmit || isSubmitting}
            onClick={onConfirm}
          >
            {isSubmitting ? '提交中' : '确认生成'}
          </button>
        </div>
      </div>
    </div>
  )
}
