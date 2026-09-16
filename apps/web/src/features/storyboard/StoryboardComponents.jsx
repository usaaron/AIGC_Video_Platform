import { Fragment, useRef, useState } from 'react'
import {
  ArrowDown,
  Check,
  Clock3,
  History,
  Link2,
  LoaderCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
  Video,
} from 'lucide-react'
import { IconButton } from '../../components/ui'
import { selectShotAssetReferencesFromIndex, taskUsesAssetReferences } from './referenceSelector'
import { VIDEO_RESOLUTIONS } from './storyboardConstants'
import {
  generationActionLabel,
  isActive,
  resolutionLabel,
  selectedVersionTaskId,
  shotVersionState,
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
  const versions = shotVersionState(tasks, shot, 'video')
  const canRollback = Boolean(versions.previous && taskOutputUrl(versions.previous.task, 'video'))
  const previewVideoTaskId = selectedVersionTaskId(tasks, shot, 'video')
  const previewVideoTask = taskById(tasks, previewVideoTaskId)
  const previewVideoUrl = taskOutputUrl(previewVideoTask, 'video')
  const references = providedReferences || selectShotAssetReferencesFromIndex(assetIndex, shot, 6, assets)
  const videoMatchesAssets = taskUsesAssetReferences(videoTask, references)
  const videoActionLabel = generationActionLabel(videoTask, videoMatchesAssets, '视频')
  const canReroll =
    Boolean(previewVideoUrl) || ['completed', 'failed', 'cancelled'].includes(videoTask?.status)
  const primaryVideoActionLabel = !isActive(videoTask) && canReroll ? '再抽一次' : videoActionLabel

  const [submitting, setSubmitting] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const submitLock = useRef(false)
  const generate = async () => {
    if (submitLock.current || isActive(videoTask)) return
    if (
      batchLocked &&
      !window.confirm('当前已有视频批次在执行。继续会将本镜改为独立生成，不等待上一镜尾帧。确认继续吗？')
    )
      return
    submitLock.current = true
    setSubmitting(true)
    setGenerationError('')
    try {
      await onGenerateVideo(shot, { resolution, ...(batchLocked ? { continuityMode: 'independent' } : {}) })
    } catch (error) {
      setGenerationError(error.message)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

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
              disabled={isActive(videoTask) || submitting}
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
            disabled={isActive(videoTask) || submitting}
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
            title={canReroll ? '重新生成本镜，保留已有版本' : videoActionLabel}
            aria-label={submitting ? '正在提交' : primaryVideoActionLabel}
            disabled={isActive(videoTask) || submitting}
            onClick={(event) => {
              event.stopPropagation()
              void generate()
            }}
          >
            {isActive(videoTask) || submitting ? (
              <LoaderCircle size={16} className="spin" />
            ) : canReroll ? (
              <RefreshCw size={16} />
            ) : (
              <Video size={16} />
            )}
            <span>{submitting ? '正在提交' : primaryVideoActionLabel}</span>
          </button>
          <small className="shot-reroll-note">
            {canReroll ? '18 积分 / 次 · 旧版本保留' : '生成当前镜头 · 18 积分'}
          </small>
          {generationError && (
            <p className="shot-submit-error" role="alert">
              {generationError}
            </p>
          )}
          <button
            type="button"
            className="shot-action-button edit"
            disabled={isActive(videoTask) || submitting}
            onClick={(event) => {
              event.stopPropagation()
              onEdit()
            }}
          >
            <Pencil size={18} /> 编辑分镜
          </button>
          <button
            type="button"
            className="shot-action-button rollback"
            disabled={!canRollback || batchLocked || submitting}
            title={
              batchLocked
                ? '等待当前批次完成后回退'
                : !canRollback
                  ? '暂无可回退的上一版本'
                  : `查看并回退到 V${versions.previous.number}`
            }
            onClick={(event) => {
              event.stopPropagation()
              onHistory()
            }}
          >
            <RotateCcw size={17} /> 回退到上一版本
          </button>
          {versions.current && (
            <small className="shot-current-version">
              当前使用 V{versions.current.number}
              {!versions.previous ? ' · 暂无上一版本' : ''}
            </small>
          )}
          <div className="shot-utility-actions">
            <button
              type="button"
              className="button secondary shot-view-versions"
              disabled={submitting}
              onClick={(event) => {
                event.stopPropagation()
                onHistory()
              }}
            >
              <History size={16} /> 查看版本
            </button>
            <IconButton
              label="删除分镜"
              className="danger"
              disabled={isActive(videoTask) || submitting || deleting}
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
