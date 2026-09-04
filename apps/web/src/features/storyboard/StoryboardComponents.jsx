import { Fragment, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  Check,
  Clock3,
  FolderOpen,
  History,
  ImagePlus,
  Link2,
  LoaderCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { IconButton } from '../../components/ui'
import { AssetAwareTextarea, AssetShortcutBar } from '../assets/AssetShortcutBar'
import { getAssetPreviewUrl } from '../assets/assetPreview'
import { selectShotAssetReferencesFromIndex, taskUsesAssetReferences } from './referenceSelector'
import { VIDEO_RESOLUTIONS } from './storyboardConstants'
import {
  generationActionLabel,
  isActive,
  resolutionLabel,
  selectedVersionTaskId,
  shotVersionPair,
  taskById,
  taskFor,
  taskLabel,
  taskOutputUrl,
  videoResolutionForTask,
} from './storyboardState'
import { normalizedVideoDuration } from '@seqora/prompting'

export function ShotRow({
  shot,
  minDuration = 4,
  previousShot,
  selected,
  selectedForBatch = false,
  assets,
  assetIndex,
  references: providedReferences,
  tasks,
  batchLocked,
  resolution,
  onSelect,
  onToggleBatch,
  onResolutionChange,
  onUpdate,
  onEdit,
  onHistory,
  onDelete,
  deleting,
  onGenerateVideo,
}) {
  const videoTask = taskFor(tasks, shot, 'video')
  const previewVideoTaskId = selectedVersionTaskId(tasks, shot, 'video')
  const previewVideoTask = taskById(tasks, previewVideoTaskId)
  const previewVideoUrl = taskOutputUrl(previewVideoTask, 'video')
  const references = providedReferences || selectShotAssetReferencesFromIndex(assetIndex, shot, 6, assets)
  const videoMatchesAssets = taskUsesAssetReferences(videoTask, references)
  const videoActionLabel = generationActionLabel(videoTask, videoMatchesAssets, '视频')
  const canReroll =
    Boolean(previewVideoUrl) || ['completed', 'failed', 'cancelled'].includes(videoTask?.status)
  const primaryVideoActionLabel = !isActive(videoTask) && canReroll ? '重新生成本镜' : videoActionLabel

  return (
    <Fragment>
      {previousShot && (
        <ContinuityConnector
          previousShot={previousShot}
          shot={shot}
          previousVideoTask={taskFor(tasks, previousShot, 'video')}
          onChange={(continuityMode) => void onUpdate(shot.id, { continuityMode })}
          disabled={batchLocked}
        />
      )}
      <article
        className={`shot-row ${selected ? 'selected' : ''} ${selectedForBatch ? 'batch-selected' : ''}`}
        onClick={onSelect}
      >
        <div className="shot-number">
          <label
            className="shot-select-control"
            title={selectedForBatch ? '取消选择此镜头' : '选择此镜头进行批量重生成'}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selectedForBatch}
              disabled={isActive(videoTask)}
              aria-label={`${shot.title}加入批量重生成`}
              onChange={() => onToggleBatch?.(shot.id)}
            />
            <span aria-hidden="true">{selectedForBatch ? <Check size={11} /> : null}</span>
          </label>
          <strong>{String(shot.order).padStart(2, '0')}</strong>
        </div>
        <div className={`shot-thumb ${previewVideoUrl ? 'has-video' : ''}`}>
          {previewVideoUrl ? (
            <video
              src={previewVideoUrl}
              controls
              playsInline
              preload="none"
              aria-label={`${shot.title}成片预览`}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <img src={shot.imageUrl || '/demo/station.jpg'} alt={shot.title} />
          )}
          <span>{previewVideoUrl ? '成片预览' : shot.framing}</span>
        </div>
        <div className="shot-content">
          <div>
            <h3>{shot.title}</h3>
            <span>
              <Clock3 size={13} /> 输出 {normalizedVideoDuration(shot.duration, minDuration)} 秒
            </span>
          </div>
          <p>{shot.prompt}</p>
          {shot.continuityNote && (
            <p className="shot-continuity-context">
              <Link2 size={13} />
              <span>{shot.continuityNote}</span>
            </p>
          )}
          <div className="shot-tags">
            <span>电影感</span>
            <span>{shot.framing}</span>
          </div>
          {references.length > 0 && (
            <div className="shot-reference-assets">
              {references.map((reference) => (
                <span key={reference.id}>{reference.assetName}</span>
              ))}
            </div>
          )}
          <div className="shot-generation-state">
            <span
              className={
                videoTask?.status === 'completed' && !videoMatchesAssets ? 'stale' : videoTask?.status || ''
              }
            >
              视频 ·{' '}
              {videoTask?.status === 'completed' && !videoMatchesAssets
                ? '需同步资产'
                : taskLabel(videoTask, false)}
              {videoTask
                ? ` · ${resolutionLabel(videoResolutionForTask(videoTask, VIDEO_RESOLUTIONS), VIDEO_RESOLUTIONS)}`
                : ''}
            </span>
          </div>
        </div>
        <div className="shot-actions">
          <select
            className="shot-resolution-select"
            aria-label={`${shot.title} 视频清晰度`}
            title="视频清晰度"
            value={resolution}
            disabled={isActive(videoTask)}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation()
              onResolutionChange(event.target.value)
            }}
          >
            {VIDEO_RESOLUTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`shot-action-button video ${canReroll ? 'reroll' : ''}`}
            title={videoActionLabel}
            aria-label={videoActionLabel}
            disabled={isActive(videoTask)}
            onClick={(event) => {
              event.stopPropagation()
              if (batchLocked) {
                const confirmed = window.confirm(
                  '当前已有视频批次在执行。强制生成会把这个镜头改为独立生成，不等待上一镜尾帧，可能降低衔接连续性。确认继续吗？',
                )
                if (!confirmed) return
                void onGenerateVideo(shot, { resolution, continuityMode: 'independent' })
                return
              }
              void onGenerateVideo(shot, { resolution })
            }}
          >
            {isActive(videoTask) ? (
              <LoaderCircle size={16} className="spin" />
            ) : canReroll ? (
              <RefreshCw size={16} />
            ) : (
              <Video size={16} />
            )}
            <span>{primaryVideoActionLabel}</span>
          </button>
          <small className="shot-reroll-note">
            {canReroll ? '生成新版本 · 旧版本保留' : '生成当前镜头 · 18 积分'}
          </small>
          <div className="shot-utility-actions">
            <IconButton
              label="版本历史"
              onClick={(event) => {
                event.stopPropagation()
                onHistory()
              }}
            >
              <History size={17} />
            </IconButton>
            <IconButton
              label="编辑分镜"
              disabled={isActive(videoTask)}
              onClick={(event) => {
                event.stopPropagation()
                onEdit()
              }}
            >
              <Pencil size={17} />
            </IconButton>
            <IconButton
              label="删除分镜"
              className="danger"
              disabled={isActive(videoTask) || deleting}
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
            >
              {deleting ? <LoaderCircle size={17} className="spin" /> : <Trash2 size={17} />}
            </IconButton>
          </div>
        </div>
      </article>
    </Fragment>
  )
}

export function ContinuityConnector({ previousShot, shot, previousVideoTask, onChange, disabled = false }) {
  const mode = shot.continuityMode || 'independent'
  const lastFrameReady = previousVideoTask?.outputs?.some((output) => output.view === 'last-frame')
  const previousVideoReady = previousVideoTask?.status === 'completed'
  const status =
    mode === 'continue'
      ? lastFrameReady
        ? '上一镜头尾帧已就绪'
        : previousVideoReady
          ? '上一镜头缺少尾帧，请重新生成'
          : '生成上一镜头后自动获取尾帧'
      : '两个镜头独立生成，使用普通切镜'

  return (
    <div className={`continuity-connector ${mode}`}>
      <div className="continuity-rail">
        <span className="continuity-thumb">
          {lastFrameReady ? (
            <img
              src={`/api/v1/generation/tasks/${previousVideoTask.id}/outputs/last-frame`}
              alt={`${previousShot.title}尾帧`}
            />
          ) : (
            <img src={previousShot.imageUrl || '/demo/station.jpg'} alt={`${previousShot.title}参考图`} />
          )}
        </span>
        <ArrowDown size={16} />
        <span className="continuity-thumb">
          <img src={shot.imageUrl || '/demo/station.jpg'} alt={`${shot.title}参考图`} />
        </span>
      </div>
      <div className="continuity-copy">
        <span className="eyebrow">
          {String(previousShot.order).padStart(2, '0')} → {String(shot.order).padStart(2, '0')}
        </span>
        <strong>{mode === 'continue' ? '承接上一镜头' : '独立切镜'}</strong>
        <span>{status}</span>
      </div>
      <div className="continuity-mode" role="group" aria-label={`${shot.title}衔接方式`}>
        <button
          type="button"
          className={mode === 'independent' ? 'active' : ''}
          aria-pressed={mode === 'independent'}
          disabled={disabled}
          onClick={() => onChange('independent')}
        >
          <Scissors size={14} /> 独立切镜
        </button>
        <button
          type="button"
          className={mode === 'continue' ? 'active' : ''}
          aria-pressed={mode === 'continue'}
          disabled={disabled}
          onClick={() => onChange('continue')}
        >
          {mode === 'continue' && lastFrameReady ? <Check size={14} /> : <Link2 size={14} />} 承接上镜
        </button>
      </div>
    </div>
  )
}

export function ShotHistoryModal({ shot, tasks, onClose, onRestore, onOpenVersionEditor }) {
  const [restoring, setRestoring] = useState('')
  const [error, setError] = useState('')
  const videoVersions = shotVersionPair(tasks, shot, 'video')

  const restore = async (kind, taskId) => {
    setRestoring(taskId)
    setError('')
    try {
      await onRestore(kind, taskId)
    } catch (restoreError) {
      setError(restoreError.message)
    } finally {
      setRestoring('')
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal shot-history-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">镜头版本</span>
            <h2>{shot.title}</h2>
            <p>仅保留当前版和上一版入口，恢复后成片合成与镜头承接会同步使用该版本。</p>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="shot-history-columns">
          <ShotHistoryColumn
            title="镜头视频"
            kind="video"
            versions={videoVersions}
            selectedTaskId={selectedVersionTaskId(tasks, shot, 'video')}
            restoring={restoring}
            onRestore={restore}
            onOpenVersionEditor={onOpenVersionEditor}
          />
        </div>
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>,
    document.body,
  )
}

function ShotHistoryColumn({
  title,
  kind,
  versions,
  selectedTaskId,
  restoring,
  onRestore,
  onOpenVersionEditor,
}) {
  return (
    <section className="shot-history-column">
      <header>
        <span>{kind === 'image' ? <ImagePlus size={15} /> : <Video size={15} />}</span>
        <div>
          <strong>{title}</strong>
          <small>{versions.length > 1 ? '当前版本 + 上一版本' : '首个版本生成后自动留档'}</small>
        </div>
      </header>
      {versions.length ? (
        <div className="shot-version-list">
          {versions.map((task, index) => {
            const current = task.id === selectedTaskId
            const url = taskOutputUrl(task, kind)
            return (
              <article className={`shot-version-card ${current ? 'current' : ''}`} key={task.id}>
                <div className="shot-version-media">
                  {kind === 'video' ? (
                    <video src={url || undefined} controls preload="none" />
                  ) : url ? (
                    <img src={url} alt={`${title}${current ? '当前版' : '上一版'}`} />
                  ) : (
                    <ImagePlus size={24} />
                  )}
                  <span>{current ? '当前使用' : index === 0 ? '最新生成' : '上一版本'}</span>
                </div>
                <div className="shot-version-meta">
                  <div>
                    <strong>{task.model || (kind === 'video' ? 'Seedance' : 'Img2')}</strong>
                    <span>{formatVersionTime(task.updatedAt || task.createdAt)}</span>
                  </div>
                  <div className="shot-version-buttons">
                    <button
                      type="button"
                      className={`button ${current ? 'secondary' : 'primary'}`}
                      disabled={current || Boolean(restoring)}
                      onClick={() => void onRestore(kind, task.id)}
                    >
                      {restoring === task.id ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : current ? (
                        <Check size={15} />
                      ) : (
                        <RotateCcw size={15} />
                      )}
                      {current ? '当前成片' : '设为当前成片'}
                    </button>
                    {onOpenVersionEditor && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={Boolean(restoring)}
                        onClick={() => onOpenVersionEditor(task)}
                      >
                        <Pencil size={14} />
                        打开生成框
                      </button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="shot-history-empty">
          <History size={20} />
          <span>还没有可用版本</span>
          <small>完成首次{title}生成后会自动保留</small>
        </div>
      )}
    </section>
  )
}

export function ShotEditor({
  shot,
  shots = [],
  minDuration = 4,
  assets = [],
  tasks = [],
  onUpload,
  onClose,
  onSave,
}) {
  const orderedShots = [...shots].sort((left, right) => left.order - right.order)
  const [insertionIndex, setInsertionIndex] = useState(orderedShots.length)
  const title = shot.title || `镜头 ${orderedShots.length + 1}`
  const framing = shot.framing || '中景'
  const [duration, setDuration] = useState(normalizedVideoDuration(shot.duration, minDuration))
  const [prompt, setPrompt] = useState(shot.prompt || '')
  const promptArea = useRef(null)
  const negativePrompt = shot.negativePrompt || ''
  const continuityNote = shot.continuityNote || ''
  const [imageUrl, setImageUrl] = useState(shot.imageUrl || '')
  const [scriptEpisodeId, setScriptEpisodeId] = useState(shot.scriptEpisodeId || null)
  const [episodeNumber, setEpisodeNumber] = useState(shot.episodeNumber || 1)
  const [episodeTitle, setEpisodeTitle] = useState(shot.episodeTitle || `第 ${shot.episodeNumber || 1} 集`)
  const [episodeKind, setEpisodeKind] = useState(shot.episodeKind || 'standard')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const referenceAssets = assets
    .map((asset) => ({ asset, url: getAssetPreviewUrl(asset, tasks) }))
    .filter((item) => Boolean(item.url))

  const insertionLabel =
    insertionIndex === 0
      ? '最前面'
      : insertionIndex >= orderedShots.length
        ? '末尾'
        : `第 ${insertionIndex} 镜之后`

  const changeInsertionIndex = (value) => {
    const nextIndex = Math.max(0, Math.min(orderedShots.length, Number(value)))
    setInsertionIndex(nextIndex)
    const previous = nextIndex > 0 ? orderedShots[nextIndex - 1] : null
    const next = orderedShots[nextIndex] || null
    const episode = previous || next
    if (episode) {
      setScriptEpisodeId(episode.scriptEpisodeId || null)
      setEpisodeNumber(episode.episodeNumber || 1)
      setEpisodeTitle(episode.episodeTitle || `第 ${episode.episodeNumber || 1} 集`)
      setEpisodeKind('standard')
    }
  }

  const uploadReference = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const media = await onUpload(file)
      setImageUrl(media.url)
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setUploading(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop storyboard-editor-backdrop" onMouseDown={onClose}>
      <form
        className="modal storyboard-shot-editor"
        onSubmit={(event) => {
          event.preventDefault()
          void onSave({
            title,
            framing,
            duration: Number(duration),
            prompt,
            negativePrompt,
            continuityNote,
            imageUrl: imageUrl || null,
            scriptEpisodeId,
            episodeBreakBefore: Boolean(shot.episodeBreakBefore),
            episodeNumber: Number(episodeNumber),
            episodeTitle: episodeTitle.trim() || `第 ${episodeNumber} 集`,
            episodeKind,
            continuityMode: shot.id
              ? shot.continuityMode || 'continue'
              : insertionIndex === 0
                ? 'independent'
                : shot.continuityMode || 'continue',
            ...(shot.id
              ? {}
              : {
                  insertAfterShotId: insertionIndex === 0 ? null : orderedShots[insertionIndex - 1]?.id,
                }),
          })
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head storyboard-shot-editor-head">
          <div>
            <span className="eyebrow">分镜</span>
            <h2>{shot.id ? '编辑镜头' : '添加镜头'}</h2>
          </div>
          <div className="storyboard-shot-editor-head-actions">
            <label className="shot-duration-control">
              <span>时长</span>
              <span>
                <input
                  type="number"
                  min={minDuration}
                  max="15"
                  value={duration}
                  aria-label="镜头时长（秒）"
                  onChange={(event) => setDuration(event.target.value)}
                />
                <em>秒</em>
              </span>
            </label>
            <IconButton label="关闭" type="button" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </div>
        </div>
        <div className="shot-editor-workspace">
          <section className="shot-editor-reference-panel">
            <div className={`shot-editor-reference-stage ${imageUrl ? 'has-image' : ''}`}>
              {imageUrl ? (
                <img src={imageUrl} alt="镜头参考" />
              ) : (
                <div className="shot-editor-reference-empty">
                  <ImagePlus size={30} />
                  <strong>暂无参考图</strong>
                </div>
              )}
              {imageUrl && (
                <IconButton label="移除参考图" type="button" onClick={() => setImageUrl('')}>
                  <X size={16} />
                </IconButton>
              )}
            </div>
            <div className="shot-reference-source-actions">
              <label className="button secondary">
                {uploading ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
                {uploading ? '上传中' : '本地上传'}
                <input
                  className="hidden-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(event) => void uploadReference(event)}
                />
              </label>
              <button
                className={`button secondary ${assetPickerOpen ? 'active' : ''}`}
                type="button"
                aria-expanded={assetPickerOpen}
                onClick={() => setAssetPickerOpen((current) => !current)}
              >
                <FolderOpen size={15} /> 从资产库选择
              </button>
            </div>
            {uploadError && (
              <p className="operation-error" role="alert">
                {uploadError}
              </p>
            )}
            {assetPickerOpen && (
              <div className="shot-asset-picker">
                <div className="shot-asset-picker-head">
                  <strong>资产库</strong>
                  <span>{referenceAssets.length} 张可用</span>
                </div>
                {referenceAssets.length ? (
                  <div className="shot-asset-picker-grid">
                    {referenceAssets.map(({ asset, url }) => (
                      <button
                        className={imageUrl === url ? 'selected' : ''}
                        type="button"
                        key={asset.id}
                        aria-label={`使用资产 ${asset.name}`}
                        aria-pressed={imageUrl === url}
                        onClick={() => {
                          setImageUrl(url)
                          setAssetPickerOpen(false)
                        }}
                      >
                        <img src={url} alt="" />
                        <span>{asset.name}</span>
                        {imageUrl === url && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="shot-asset-picker-empty">
                    <ImagePlus size={20} />
                    <span>资产库暂无可用图片</span>
                  </div>
                )}
              </div>
            )}
          </section>
          <section className="shot-editor-prompt-panel">
            <label className="field-label" htmlFor="shot-visual-prompt">
              画面提示词
            </label>
            <AssetAwareTextarea
              className="shot-editor-prompt-input"
              inputRef={promptArea}
              assets={assets}
              tasks={tasks}
              value={prompt}
              id="shot-visual-prompt"
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="画面提示词"
            />
            <AssetShortcutBar
              assets={assets}
              tasks={tasks}
              value={prompt}
              onChange={setPrompt}
              inputRef={promptArea}
              label="插入资产名称"
            />
          </section>
        </div>
        {!shot.id && (
          <label className="shot-insertion-control compact">
            <span>
              <strong>插入位置</strong>
              <em>{insertionLabel}</em>
            </span>
            <input
              type="range"
              min="0"
              max={orderedShots.length}
              step="1"
              value={insertionIndex}
              aria-label="新分镜插入位置"
              onChange={(event) => changeInsertionIndex(event.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            保存分镜
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function formatVersionTime(value) {
  if (!value) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
