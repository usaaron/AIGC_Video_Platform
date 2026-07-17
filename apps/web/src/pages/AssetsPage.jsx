import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Gauge,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shirt,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { useState } from 'react'
import { IconButton, PageHeader } from '../components/ui'
import { AssetEditor } from '../features/assets/AssetEditor'
import { ASSET_TABS } from '../features/assets/assetOptions'
import { summarizeAsset } from '../features/assets/promptCompiler'

const emptyIcons = { character: UsersRound, prop: Boxes, costume: Shirt, audio: Music2 }

export function AssetsPage({
  project,
  assets,
  tasks,
  billing,
  onCreate,
  onUpdate,
  onDelete,
  onUpload,
  onGenerate,
  onGenerateStage,
  onGenerateAll,
  onNext,
}) {
  const [tab, setTab] = useState('character')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const filtered = assets.filter(
    (asset) => asset.kind === tab && asset.name.toLowerCase().includes(search.toLowerCase()),
  )
  const tabLabel = ASSET_TABS.find(([kind]) => kind === tab)?.[1]

  return (
    <div className="page assets-page">
      <PageHeader
        eyebrow="第 2 步 · 资产"
        title="建立可复用的视觉资产"
        description="人物、场景、物品、服装和音频分别管理，并保持同一项目风格一致。"
      >
        <span className="inherited-ratio">
          项目比例 <strong>{project.aspectRatio}</strong>
        </span>
        <button className="button secondary" onClick={() => setEditing({ kind: tab })}>
          <Plus size={16} /> 添加{tabLabel}
        </button>
        {billing.plan === 'member' && filtered.length > 0 && (
          <button className="button primary" onClick={() => onGenerateAll(filtered)}>
            <Sparkles size={16} /> 当前分类并发生成
          </button>
        )}
      </PageHeader>

      <div className="asset-tabs asset-tabs-five">
        {ASSET_TABS.map(([kind, label]) => (
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
            placeholder={`搜索${tabLabel}`}
          />
        </div>
        <div className="generation-note">
          <Gauge size={15} />
          {billing.plan === 'member' ? '会员模式：最多同时生成 3 项' : '免费模式：任务按顺序逐个生成'}
        </div>
      </div>

      <div className="asset-grid">
        {filtered.map((asset) => (
          <AssetCard
            asset={asset}
            key={asset.id}
            onEdit={() => setEditing(asset)}
            onGenerate={() => onGenerate(asset)}
          />
        ))}
        <button className="add-asset" onClick={() => setEditing({ kind: tab })}>
          <span>
            <Plus size={21} />
          </span>
          <strong>添加{tabLabel}</strong>
          <small>本地导入或使用 AI 生成</small>
        </button>
      </div>

      <div className="sticky-actions">
        <span>
          <BadgeCheck size={15} />
          当前项目共 {assets.length} 项资产
        </span>
        <button className="button primary" onClick={onNext}>
          进入分镜设计 <ArrowRight size={16} />
        </button>
      </div>

      {editing && (
        <AssetEditor
          asset={editing}
          aspectRatio={project.aspectRatio}
          tasks={tasks}
          onUpload={onUpload}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
          onPersist={async (input) => onUpdate(editing.id, input)}
          onGenerateStage={onGenerateStage}
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

function AssetCard({ asset, onEdit, onGenerate }) {
  const EmptyIcon = emptyIcons[asset.kind] || Sparkles
  const tags = summarizeAsset(asset)
  return (
    <article className="asset-card">
      <div className={`asset-image ${asset.kind === 'audio' ? 'sound-asset' : ''}`}>
        {asset.imageUrl ? <img src={asset.imageUrl} alt={asset.name} /> : <EmptyIcon size={42} />}
        <span>
          {asset.kind === 'character'
            ? characterStatus(asset)
            : asset.sourceMode === 'import'
              ? '本地导入'
              : asset.status === 'confirmed'
                ? '已确认'
                : 'AI 资产'}
        </span>
        <IconButton label="编辑资产" onClick={onEdit}>
          <Pencil size={17} />
        </IconButton>
      </div>
      <div className="asset-body">
        <div className="asset-title">
          <div>
            <h3>{asset.name}</h3>
            <p>{asset.description || '暂无补充说明'}</p>
          </div>
        </div>
        <div className="asset-meta-tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <label>最终提示词</label>
        <p className="prompt-text">{asset.prompt || '编辑资产后自动生成中文提示词'}</p>
        <div className="asset-actions">
          <button onClick={asset.kind === 'character' ? onEdit : onGenerate}>
            <RefreshCw size={14} />
            {asset.kind === 'character' ? '继续人物设定' : '生成新版本'}
          </button>
          <button onClick={onEdit}>编辑</button>
        </div>
      </div>
    </article>
  )
}

function characterStatus(asset) {
  if (asset.attributes.faceStatus !== 'approved') return '待确认面部'
  if (asset.attributes.bodyStatus !== 'approved') return '面部已确认'
  return '全身已确认'
}
