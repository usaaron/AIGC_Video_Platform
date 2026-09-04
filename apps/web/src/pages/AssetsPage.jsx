import {
  ArrowRight,
  Badge,
  BadgeCheck,
  Boxes,
  Gauge,
  LoaderCircle,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shirt,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { IconButton, PageHeader } from '../components/ui'
import { AssetEditor } from '../features/assets/AssetEditor'
import { ASSET_TABS, IMAGE_MODEL_OPTIONS } from '../features/assets/assetOptions'
import { GenerationProgress } from '../features/assets/GenerationProgress'
import { getAssetPreviewUrl } from '../features/assets/assetPreview'
import {
  assetTaskCardState,
  characterAssetStatus,
  latestAssetImageTask,
} from '../features/assets/assetTaskState'
import { summarizeAsset } from '../features/assets/promptCompiler'

const emptyIcons = { character: UsersRound, prop: Boxes, costume: Shirt, brand: Badge, audio: Music2 }
const emptyAssetCopy = {
  character: ['人物形象待生成', '确认设定后生成面部与全身形象'],
  scene: ['场景画面待生成', '将根据环境、光线与构图生成'],
  prop: ['物品形象待生成', '将根据材质与用途生成'],
  costume: ['服装形象待生成', '将根据角色与设计要求生成'],
  brand: ['品牌视觉待生成', '将严格保留品牌文字与标识'],
  audio: ['音频素材待生成', '生成后可在项目内复用'],
}

export function AssetsPage({
  project,
  assets,
  tasks,
  imageModels,
  billing,
  onCreate,
  onUpdate,
  onDelete,
  onUpload,
  onGenerate,
  onGenerateStage,
  onGenerateAll,
  onGetTrustedConfiguration,
  onListTrustedPortraits,
  onRegisterVirtualPortrait,
  onBindTrustedPortrait,
  onRefreshTrustedPortrait,
  onNext,
}) {
  const [tab, setTab] = useState('character')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busyAssetId, setBusyAssetId] = useState(null)
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [imageModel, setImageModel] = useState('img2-default')
  const hunyuanConfigured = imageModels?.hunyuan === 'configured'
  const filtered = assets.filter(
    (asset) => asset.kind === tab && asset.name.toLowerCase().includes(search.toLowerCase()),
  )
  const generatable = filtered.filter((asset) => asset.sourceMode === 'generate' && asset.kind !== 'audio')
  const tabLabel = ASSET_TABS.find(([kind]) => kind === tab)?.[1]

  useEffect(() => {
    if (!editing?.id) return
    const updated = assets.find((asset) => asset.id === editing.id)
    const currentPortrait = editing.attributes?.trustedPortrait
    const updatedPortrait = updated?.attributes?.trustedPortrait
    const portraitChanged =
      currentPortrait?.assetId !== updatedPortrait?.assetId ||
      currentPortrait?.status !== updatedPortrait?.status ||
      currentPortrait?.checkedAt !== updatedPortrait?.checkedAt
    if (updated && (updated.updatedAt !== editing.updatedAt || portraitChanged)) setEditing(updated)
  }, [
    assets,
    editing?.id,
    editing?.updatedAt,
    editing?.attributes?.trustedPortrait?.assetId,
    editing?.attributes?.trustedPortrait?.status,
    editing?.attributes?.trustedPortrait?.checkedAt,
  ])

  return (
    <div className="page assets-page">
      <PageHeader
        eyebrow="第 2 步 · 资产"
        title="建立可复用的视觉资产"
        description="人物、场景、物品、服装、品牌和音频分别管理，并保持同一项目风格一致。"
      >
        <span className="inherited-ratio">
          项目比例 <strong>{project.aspectRatio}</strong>
        </span>
        <button className="button secondary" onClick={() => setEditing({ kind: tab })}>
          <Plus size={16} /> 添加{tabLabel}
        </button>
        {billing.plan === 'member' && generatable.length > 0 && (
          <button
            className="button primary"
            disabled={batchGenerating}
            onClick={async () => {
              setBatchGenerating(true)
              try {
                await onGenerateAll(generatable, imageModel)
              } finally {
                setBatchGenerating(false)
              }
            }}
          >
            {batchGenerating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            {batchGenerating ? '正在加入队列' : '当前分类并发生成'}
          </button>
        )}
      </PageHeader>

      <div className="asset-tabs asset-tabs-six">
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
        <label className="asset-model-select">
          <span>图片模型</span>
          <select
            value={imageModel}
            onChange={(event) => {
              if (event.target.value === 'hunyuan-image' && !hunyuanConfigured) return
              setImageModel(event.target.value)
            }}
          >
            {IMAGE_MODEL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value} disabled={value === 'hunyuan-image' && !hunyuanConfigured}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="asset-grid">
        {filtered.map((asset) => (
          <AssetCard
            asset={asset}
            key={asset.id}
            linkedCharacterName={
              asset.kind === 'costume'
                ? assets.find((item) => item.id === asset.attributes?.characterAssetId)?.name
                : null
            }
            onEdit={() => setEditing(asset)}
            task={latestAssetImageTask(asset, tasks)}
            tasks={tasks}
            onGenerate={async () => {
              setBusyAssetId(asset.id)
              try {
                await onGenerate(asset, imageModel)
              } finally {
                setBusyAssetId(null)
              }
            }}
            onPreview={setPreview}
            busy={busyAssetId === asset.id}
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
          key={editing.id || `new-${editing.kind}`}
          asset={editing}
          projectAssets={assets}
          aspectRatio={project.aspectRatio}
          projectVisualStyle={project.visualStyle}
          tasks={tasks}
          onUpload={onUpload}
          onClose={() => setEditing(null)}
          onCreateDraft={async (input) => {
            const created = await onCreate(input)
            setEditing(created)
            return created
          }}
          onSave={async (input) => {
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
          onPersist={async (input) => {
            const updated = await onUpdate(editing.id, input)
            if (updated) setEditing(updated)
            return updated
          }}
          onGenerateStage={onGenerateStage}
          onGenerateAsset={(asset, model = imageModel) => onGenerate(asset, model)}
          imageModel={imageModel}
          onGetTrustedConfiguration={onGetTrustedConfiguration}
          onListTrustedPortraits={onListTrustedPortraits}
          onRegisterVirtualPortrait={async (assetId, assetName) => {
            // 注册接口返回的是后台任务，不是资产；资产状态由项目轮询同步。
            return onRegisterVirtualPortrait(assetId, assetName)
          }}
          onBindTrustedPortrait={async (assetId, providerAssetId) => {
            const updated = await onBindTrustedPortrait(assetId, providerAssetId)
            if (updated) setEditing(updated)
            return updated
          }}
          onRefreshTrustedPortrait={async (assetId) => {
            const updated = await onRefreshTrustedPortrait(assetId)
            if (updated) setEditing(updated)
            return updated
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
      {preview && <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function AssetCard({ asset, task, tasks, linkedCharacterName, onEdit, onGenerate, onPreview, busy }) {
  const EmptyIcon = emptyIcons[asset.kind] || Sparkles
  const [emptyTitle, emptyDescription] = emptyAssetCopy[asset.kind] || ['资产待生成', '完成生成后在此预览']
  const tags = [...(linkedCharacterName ? [`归属：${linkedCharacterName}`] : []), ...summarizeAsset(asset)]
  const previewUrl = getAssetPreviewUrl(asset, tasks)
  const taskCardState = assetTaskCardState(task, previewUrl)
  return (
    <article className={`asset-card asset-${asset.kind}`}>
      <div className={`asset-image ${asset.kind === 'audio' ? 'sound-asset' : ''}`}>
        {previewUrl ? (
          <button
            className="asset-image-preview"
            type="button"
            aria-label={`放大查看 ${asset.name}`}
            onClick={() =>
              onPreview({ url: previewUrl, alt: asset.name, fileName: `${asset.name}-资产预览` })
            }
          >
            <img src={previewUrl} alt={asset.name} loading="eager" decoding="async" />
          </button>
        ) : (
          <div className={`asset-empty-state asset-empty-${asset.kind}`}>
            <span>
              <EmptyIcon size={28} />
            </span>
            <strong>{emptyTitle}</strong>
            <small>{emptyDescription}</small>
          </div>
        )}
        {(busy || taskCardState) && (
          <div className="asset-generation-overlay" role="status" aria-live="polite">
            <GenerationProgress task={!busy && taskCardState ? task : null} busy={busy} />
          </div>
        )}
        <span>
          {taskCardState === 'failed'
            ? '生成失败'
            : taskCardState === 'cancelled'
              ? '已取消'
              : ['queued', 'paused', 'running'].includes(taskCardState)
                ? '生成中'
                : asset.kind === 'character'
                  ? characterStatus(asset)
                  : asset.sourceMode === 'import'
                    ? '直接使用'
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
        <label>{asset.sourceMode === 'import' ? '素材使用方式' : '最终提示词'}</label>
        <p className="prompt-text">
          {asset.sourceMode === 'import'
            ? '直接使用本地原图，不调用 Img2；描述和标签只用于资产检索与镜头匹配。'
            : asset.prompt || '编辑资产后自动生成中文提示词'}
        </p>
        <div className="asset-actions">
          <button onClick={asset.kind === 'character' || asset.sourceMode === 'import' ? onEdit : onGenerate}>
            {asset.kind === 'character' || asset.sourceMode === 'import' ? (
              <Pencil size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            {asset.kind === 'character'
              ? '继续人物设定'
              : asset.sourceMode === 'import'
                ? '管理原图'
                : '生成新版本'}
          </button>
          <button onClick={onEdit}>编辑</button>
        </div>
      </div>
    </article>
  )
}

function characterStatus(asset) {
  return characterAssetStatus(asset)
}
