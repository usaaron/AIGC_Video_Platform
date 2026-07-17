import { useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Gauge,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'

const tabs = [
  ['character', '人物'],
  ['scene', '场景'],
  ['sound', '声音'],
  ['prop', '道具'],
]

export function AssetsPage({
  assets,
  billing,
  onCreate,
  onUpdate,
  onDelete,
  onGenerate,
  onGenerateAll,
  onNext,
}) {
  const [tab, setTab] = useState('character')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const filtered = assets.filter(
    (asset) => asset.kind === tab && asset.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="page">
      <PageHeader
        eyebrow="第 2 步 · 资产"
        title="让角色与世界保持一致"
        description="人物、场景、声音和道具都归入项目资产库。"
      >
        <button className="button secondary" onClick={() => setEditing({ kind: tab })}>
          <Plus size={16} /> 添加资产
        </button>
        {billing.plan === 'member' && (
          <button className="button primary" onClick={onGenerateAll}>
            <Sparkles size={16} /> 全部并发生成
          </button>
        )}
      </PageHeader>
      <div className="asset-tabs">
        {tabs.map(([kind, label]) => (
          <button key={kind} className={tab === kind ? 'active' : ''} onClick={() => setTab(kind)}>
            {label} <span>{assets.filter((asset) => asset.kind === kind).length}</span>
          </button>
        ))}
      </div>
      <div className="asset-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索当前分类"
          />
        </div>
        <div className="generation-note">
          <Gauge size={15} />{' '}
          {billing.plan === 'member' ? '会员模式：最多同时生成 3 项' : '免费模式：任务按顺序逐个生成'}
        </div>
      </div>
      <div className="asset-grid">
        {filtered.map((asset) => (
          <article className="asset-card" key={asset.id}>
            <div className={`asset-image ${asset.kind === 'sound' ? 'sound-asset' : ''}`}>
              {asset.imageUrl ? <img src={asset.imageUrl} alt={asset.name} /> : <Music2 size={42} />}
              <span>{asset.status === 'confirmed' ? '已确认' : '草稿'}</span>
              <IconButton label="编辑资产" onClick={() => setEditing(asset)}>
                <Pencil size={17} />
              </IconButton>
            </div>
            <div className="asset-body">
              <div className="asset-title">
                <div>
                  <h3>{asset.name}</h3>
                  <p>{asset.description}</p>
                </div>
                <span className="asset-check">
                  <Check size={13} />
                </span>
              </div>
              <label>生成提示词</label>
              <p className="prompt-text">{asset.prompt || '尚未填写提示词'}</p>
              <div className="asset-actions">
                <button onClick={() => onGenerate(asset)}>
                  <RefreshCw size={14} /> 生成新版本
                </button>
                <button onClick={() => setEditing(asset)}>编辑</button>
              </div>
            </div>
          </article>
        ))}
        <button className="add-asset" onClick={() => setEditing({ kind: tab })}>
          <span>
            <Plus size={21} />
          </span>
          <strong>添加{tabs.find(([kind]) => kind === tab)?.[1]}</strong>
          <small>填写信息后保存到项目</small>
        </button>
      </div>
      <div className="sticky-actions">
        <span>
          <BadgeCheck size={15} /> 当前项目共 {assets.length} 项资产。
        </span>
        <button className="button primary" onClick={onNext}>
          进入分镜设计 <ArrowRight size={16} />
        </button>
      </div>
      {editing && (
        <AssetEditor
          asset={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
          onDelete={
            editing.id
              ? async () => {
                  await onDelete(editing.id)
                  setEditing(null)
                }
              : null
          }
        />
      )}
    </div>
  )
}

function AssetEditor({ asset, onClose, onSave, onDelete }) {
  const [name, setName] = useState(asset.name || '')
  const [description, setDescription] = useState(asset.description || '')
  const [prompt, setPrompt] = useState(asset.prompt || '')
  const [imageUrl, setImageUrl] = useState(asset.imageUrl || '')
  const [status, setStatus] = useState(asset.status || 'draft')

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal asset-editor"
        onSubmit={(event) => {
          event.preventDefault()
          void onSave({
            ...(asset.id ? {} : { kind: asset.kind }),
            name,
            description,
            prompt,
            imageUrl: imageUrl || null,
            ...(asset.id ? { status } : {}),
          })
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">{asset.id ? '编辑资产' : '新建资产'}</span>
            <h2>{asset.id ? asset.name : '添加项目资产'}</h2>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <label className="field-label">名称</label>
        <input
          className="text-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label className="field-label">说明</label>
        <input
          className="text-input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label className="field-label">生成提示词</label>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <label className="field-label">预览图片 URL（声音可留空）</label>
        <input
          className="text-input"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
        />
        {asset.id && (
          <label className="field-label">
            状态
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
            </select>
          </label>
        )}
        <div className="modal-actions">
          {onDelete && (
            <button className="button danger" type="button" onClick={onDelete}>
              <Trash2 size={15} /> 删除
            </button>
          )}
          <button className="button secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            保存资产
          </button>
        </div>
      </form>
    </div>
  )
}
