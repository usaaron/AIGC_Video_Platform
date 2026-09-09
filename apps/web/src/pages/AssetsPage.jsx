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
  ChevronDown,
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
  onCreateTrustedValidationSession,
  onRefreshTrustedValidationSession,
  onLatestTrustedValidationSession,
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
  const [error, setError] = useState('')
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
    <div className="page assets-page studio-assets-page">
      <PageHeader eyebrow="视觉资产" title="资产设计">
        <span className="inherited-ratio">
          项目比例 <strong>{project.aspectRatio}</strong>
        </span>
        <button className="button primary" onClick={() => setEditing({ kind: tab })}>
          <Plus size={16} /> 添加{tabLabel}
        </button>
        {billing.plan === 'member' && generatable.length > 0 && (
          <button
            className="button secondary"
            disabled={batchGenerating}
            onClick={async () => {
              setBatchGenerating(true)
              setError('')
              try {
                await onGenerateAll(generatable, imageModel)
              } catch (generationError) {
                setError(generationError.message)
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

      <div className="asset-tabs asset-tabs-six" role="tablist" aria-label="资产分类">
        {ASSET_TABS.map(([kind, label]) => (
          <button
            role="tab"
            aria-selected={tab === kind}
            key={kind}
            className={tab === kind ? 'active' : ''}
            onClick={() => setTab(kind)}
          >
            {label} <span>{assets.filter((asset) => asset.kind === kind).length}</span>
          </button>
        ))}
      </div>
      <div className="asset-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label={`搜索${tabLabel}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`搜索${tabLabel}`}
          />
        </div>
        <div className="generation-note">
          <Gauge size={15} />
          {billing.plan === 'member' ? '最多并发 3 项' : '按顺序生成'}
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
      {error && (
        <p className="operation-error" role="alert">
          {error}
        </p>
      )}

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
              setError('')
              try {
                await onGenerate(asset, imageModel)
              } catch (generationError) {
                setError(generationError.message)
              } finally {
                setBusyAssetId(null)
              }
            }}
            onPreview={setPreview}
            busy={busyAssetId === asset.id}
          />
        ))}
        {filtered.length > 0 && (
          <button className="add-asset" onClick={() => setEditing({ kind: tab })}>
            <span>
              <Plus size={21} />
            </span>
            <strong>添加{tabLabel}</strong>
          </button>
        )}
      </div>
      {filtered.length === 0 && (
        <div className="authoring-asset-empty">
          <Boxes size={30} />
          <h2>{search ? `没有找到“${search}”` : `还没有${tabLabel}资产`}</h2>
          <button
            className="button secondary"
            onClick={() => (search ? setSearch('') : setEditing({ kind: tab }))}
          >
            {search ? <Search size={16} /> : <Plus size={16} />}
            {search ? '清除搜索' : `添加${tabLabel}`}
          </button>
        </div>
      )}

      <div className="sticky-actions authoring-flow-footer">
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
          onRegisterVirtualPortrait={async (assetId, assetName, faceReferenceId) => {
            // 注册接口返回的是后台任务，不是资产；资产状态由项目轮询同步。
            return onRegisterVirtualPortrait(assetId, assetName, faceReferenceId)
          }}
          onCreateTrustedValidationSession={onCreateTrustedValidationSession}
          onRefreshTrustedValidationSession={onRefreshTrustedValidationSession}
          onLatestTrustedValidationSession={onLatestTrustedValidationSession}
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
  const [emptyTitle] = emptyAssetCopy[asset.kind] || ['资产待生成']
  const tags = [
    ...new Set(
      [...(linkedCharacterName ? [`归属：${linkedCharacterName}`] : []), ...summarizeAsset(asset)].filter(
        Boolean,
      ),
    ),
  ]
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
          <button
            type="button"
            onClick={onEdit}
            className={`asset-empty-state asset-empty-${asset.kind}`}
            aria-label={`编辑${asset.name}并生成图片`}
          >
            <span>
              <EmptyIcon size={28} />
            </span>
            <strong>{emptyTitle}</strong>
          </button>
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
        <details className="authoring-card-details">
          <summary>
            {asset.sourceMode === 'import' ? '素材信息' : '提示词'}
            <ChevronDown size={14} />
          </summary>
          <p className="prompt-text">
            {asset.sourceMode === 'import' ? '直接使用原图' : asset.prompt || '编辑资产后自动生成中文提示词'}
          </p>
        </details>
        <div className="asset-actions">
          <button
            disabled={
              asset.kind !== 'character' &&
              asset.kind !== 'audio' &&
              asset.sourceMode !== 'import' &&
              (busy || ['queued', 'paused', 'running'].includes(taskCardState))
            }
            onClick={
              asset.kind === 'character' || asset.kind === 'audio' || asset.sourceMode === 'import'
                ? onEdit
                : onGenerate
            }
          >
            {asset.kind === 'character' || asset.kind === 'audio' || asset.sourceMode === 'import' ? (
              <Pencil size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            {asset.kind === 'character'
              ? '继续人物设定'
              : asset.kind === 'audio'
                ? '编辑音频素材'
                : asset.sourceMode === 'import'
                  ? '管理原图'
                  : '生成新版本'}
          </button>
          <button onClick={onEdit} aria-label={`编辑${asset.name}设定`} title="编辑设定">
            <Pencil size={15} />
          </button>
        </div>
      </div>
    </article>
  )
}

function characterStatus(asset) {
  return characterAssetStatus(asset)
}
