import { Fragment, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  Check,
  Clock3,
  Film,
  ImagePlus,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  Video,
  X,
  Zap,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { selectShotAssetReferences, taskUsesAssetReferences } from '../features/storyboard/referenceSelector'
import { activeVideoTasksForShots, planVideoBatch } from '../features/storyboard/videoBatchPlanner'
import { normalizedVideoDuration } from '@seqora/prompting'

const VIDEO_RESOLUTIONS = [
  { value: '480p', label: '480P' },
  { value: '720p', label: '720P' },
  { value: '1080p', label: '1080P' },
  { value: '4k', label: '4K' },
]

export function StoryboardPage({
  shots,
  assets,
  tasks,
  concurrency = 1,
  onRegenerate,
  onCreate,
  onUpdate,
  onGenerateImage,
  onGenerateVideo,
  onGenerateAllVideos,
  onNext,
}) {
  const [selected, setSelected] = useState(shots[0]?.id)
  const [editing, setEditing] = useState(null)
  const [batchResolution, setBatchResolution] = useState('720p')
  const [batchMode, setBatchMode] = useState('parallel')
  const [shotResolutions, setShotResolutions] = useState({})
  const [splitting, setSplitting] = useState('')
  const [generatingAll, setGeneratingAll] = useState(false)
  const [operationError, setOperationError] = useState('')
  const totalDuration = shots.reduce((sum, shot) => sum + normalizedVideoDuration(shot.duration), 0)
  const batchPlan = planVideoBatch(shots, batchMode, concurrency)
  const activeBatchTasks = activeVideoTasksForShots(tasks, shots)
  const batchLocked = activeBatchTasks.length > 0
  const controlsLocked = batchLocked || Boolean(splitting) || generatingAll
  const activeShotCount = new Set(activeBatchTasks.map((task) => task.metadata?.shotId)).size

  const splitFromScript = async (mode) => {
    if (controlsLocked) return
    setSplitting(mode)
    setOperationError('')
    try {
      await onRegenerate(mode)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setSplitting('')
    }
  }

  const generateAll = async () => {
    if (controlsLocked) return
    setGeneratingAll(true)
    setOperationError('')
    try {
      await onGenerateAllVideos(shots, batchResolution, batchMode)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setGeneratingAll(false)
    }
  }

  return (
    <div className="page storyboard-page">
      <PageHeader
        eyebrow="第 3 步 · 分镜"
        title="一眼看清整段影片"
        description="分镜已保存到项目，可以调整画面、提示词和时长。"
      >
        <button
          className="button secondary"
          onClick={() => void splitFromScript('scene')}
          disabled={controlsLocked}
        >
          {splitting === 'scene' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
          {splitting === 'scene' ? '正在按场次拆分' : '按场次拆分'}
        </button>
        <button
          className="button secondary"
          onClick={() => void splitFromScript('beat')}
          disabled={controlsLocked}
        >
          {splitting === 'beat' ? <LoaderCircle size={16} className="spin" /> : <Scissors size={16} />}
          {splitting === 'beat' ? '正在动作级细拆' : '动作级细拆'}
        </button>
        <button className="button secondary" onClick={() => setEditing({})} disabled={controlsLocked}>
          <Pencil size={16} /> 手动添加
        </button>
        <label className="batch-resolution-control">
          <span>批量清晰度</span>
          <select
            value={batchResolution}
            onChange={(event) => setBatchResolution(event.target.value)}
            disabled={controlsLocked}
          >
            {VIDEO_RESOLUTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="batch-mode-control" role="group" aria-label="批量生成策略">
          <button
            type="button"
            className={batchMode === 'parallel' ? 'active' : ''}
            aria-pressed={batchMode === 'parallel'}
            title={`最多同时执行 ${concurrency} 路视频链路`}
            onClick={() => setBatchMode('parallel')}
            disabled={controlsLocked}
          >
            <Zap size={14} /> 分段并发
          </button>
          <button
            type="button"
            className={batchMode === 'continuity' ? 'active' : ''}
            aria-pressed={batchMode === 'continuity'}
            title="把全部镜头设为一条尾帧承接链，严格按顺序生成"
            onClick={() => setBatchMode('continuity')}
            disabled={controlsLocked}
          >
            <Link2 size={14} /> 全片串联
          </button>
        </div>
        <button
          className="button primary"
          onClick={() => void generateAll()}
          disabled={!shots.length || controlsLocked}
        >
          {generatingAll ? <LoaderCircle size={16} className="spin" /> : <Video size={16} />}
          {generatingAll ? '正在加入队列' : batchMode === 'parallel' ? '安全并发生成' : '全片串联生成'}
        </button>
      </PageHeader>
      <div className="storyboard-summary">
        <span>
          <Film size={16} /> 第一集 · 主故事
        </span>
        <div>
          <span>{shots.length} 个镜头</span>
          <span>{totalDuration} 秒</span>
          <span>{Math.max(0, shots.length - 1)} 个衔接点</span>
          <span>
            {batchPlan.immediateLaneCount} / {concurrency} 路链路
          </span>
        </div>
      </div>
      <div className="storyboard-continuity-note">
        <Link2 size={16} />
        <div>
          <strong>连续性工作台</strong>
          <span>
            {batchMode === 'parallel'
              ? `只在独立场次之间建立 ${batchPlan.immediateLaneCount} 路并发；连续镜头链绝不拆分，链内等待真实尾帧。`
              : '全部镜头将设为一条承接链；上一镜头尾帧落盘后，下一镜头才会提交。'}
          </span>
        </div>
      </div>
      {operationError && (
        <p className="operation-error" role="alert">
          {operationError}
        </p>
      )}
      {batchLocked && (
        <div className="storyboard-batch-lock" role="status">
          <LockKeyhole size={17} />
          <div>
            <strong>当前生成批次已锁定</strong>
            <span>
              有 {activeShotCount}{' '}
              个分镜视频任务仍在排队、暂停或生成中。请先到生成队列处理当前任务，完成、失败或删除后再切换并发/串联策略。
            </span>
          </div>
        </div>
      )}
      <div className="shot-list">
        {shots.map((shot, index) => {
          const imageTask = taskFor(tasks, shot.id, 'image')
          const videoTask = taskFor(tasks, shot.id, 'video')
          const references = selectShotAssetReferences(assets, shot)
          const imageMatchesAssets = taskUsesAssetReferences(imageTask, references)
          const videoMatchesAssets = taskUsesAssetReferences(videoTask, references)
          const imageActionLabel = generationActionLabel(
            imageTask,
            imageMatchesAssets,
            '图片',
            Boolean(shot.imageUrl),
          )
          const videoActionLabel = generationActionLabel(videoTask, videoMatchesAssets, '视频')
          const resolution = shotResolutions[shot.id] || videoResolutionForTask(videoTask) || batchResolution
          return (
            <Fragment key={shot.id}>
              {index > 0 && (
                <ContinuityConnector
                  previousShot={shots[index - 1]}
                  shot={shot}
                  previousVideoTask={taskFor(tasks, shots[index - 1].id, 'video')}
                  onChange={(continuityMode) => void onUpdate(shot.id, { continuityMode })}
                  disabled={batchLocked}
                />
              )}
              <article
                className={`shot-row ${selected === shot.id ? 'selected' : ''}`}
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
                      <Clock3 size={13} /> 输出 {normalizedVideoDuration(shot.duration)} 秒
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
                        imageTask?.status === 'completed' && !imageMatchesAssets
                          ? 'stale'
                          : imageTask?.status || (shot.imageUrl ? 'completed' : '')
                      }
                    >
                      分镜图 ·{' '}
                      {imageTask?.status === 'completed' && !imageMatchesAssets
                        ? '需同步资产'
                        : taskLabel(imageTask, Boolean(shot.imageUrl))}
                    </span>
                    <span
                      className={
                        videoTask?.status === 'completed' && !videoMatchesAssets
                          ? 'stale'
                          : videoTask?.status || ''
                      }
                    >
                      视频 ·{' '}
                      {videoTask?.status === 'completed' && !videoMatchesAssets
                        ? '需同步资产'
                        : taskLabel(videoTask, false)}
                      {videoTask ? ` · ${resolutionLabel(videoResolutionForTask(videoTask))}` : ''}
                    </span>
                  </div>
                </div>
                <div className="shot-actions">
                  <button
                    type="button"
                    className="shot-action-button image"
                    title={imageActionLabel}
                    aria-label={imageActionLabel}
                    disabled={isActive(imageTask)}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onGenerateImage(shot)
                    }}
                  >
                    {isActive(imageTask) ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ImagePlus size={16} />
                    )}
                    <span>{imageActionLabel}</span>
                  </button>
                  <select
                    className="shot-resolution-select"
                    aria-label={`${shot.title} 视频清晰度`}
                    title="视频清晰度"
                    value={resolution}
                    disabled={isActive(videoTask) || batchLocked}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation()
                      setShotResolutions((current) => ({ ...current, [shot.id]: event.target.value }))
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
                    className="shot-action-button video"
                    title={videoActionLabel}
                    aria-label={videoActionLabel}
                    disabled={isActive(videoTask) || batchLocked}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onGenerateVideo(shot, { resolution })
                    }}
                  >
                    {isActive(videoTask) ? <LoaderCircle size={16} className="spin" /> : <Video size={16} />}
                    <span>{videoActionLabel}</span>
                  </button>
                  <IconButton
                    label="编辑分镜"
                    disabled={batchLocked}
                    onClick={(event) => {
                      event.stopPropagation()
                      setEditing(shot)
                    }}
                  >
                    <Pencil size={17} />
                  </IconButton>
                </div>
              </article>
            </Fragment>
          )
        })}
      </div>
      <button className="storyboard-add" onClick={() => setEditing({})} disabled={controlsLocked}>
        <Plus size={17} /> 手动添加镜头
      </button>
      <div className="sticky-actions">
        <span>视频 18 积分；分镜图可选，系统会按项目类型自动合并质量保护规则。</span>
        <button className="button primary" onClick={onNext}>
          查看生成队列 <ArrowRight size={16} />
        </button>
      </div>
      {editing && (
        <ShotEditor
          shot={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (batchLocked) {
              setOperationError('当前生成批次已锁定，请先处理生成队列中的视频任务。')
              return
            }
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function taskFor(tasks, shotId, kind) {
  return tasks.find((task) => task.kind === kind && task.metadata?.shotId === shotId)
}

function ContinuityConnector({ previousShot, shot, previousVideoTask, onChange, disabled = false }) {
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

function isActive(task) {
  return task?.status === 'queued' || task?.status === 'paused' || task?.status === 'running'
}

function taskLabel(task, hasResult) {
  if (!task) return hasResult ? '已就绪' : '未生成'
  if (task.status === 'completed') return '已完成'
  if (task.status === 'failed') return '失败'
  if (task.status === 'paused') return '已暂停'
  if (task.status === 'running') return `${task.progress}%`
  return '排队中'
}

function generationActionLabel(task, matchesAssets, kind, hasResult = false) {
  if (task?.status === 'running') return `${kind}生成中 ${task.progress}%`
  if (task?.status === 'queued') return `${kind}排队中`
  if (task?.status === 'paused') return `${kind}已暂停`
  if (task?.status === 'completed' && !matchesAssets) return `同步${kind}`
  if (task || hasResult) return `重新生成${kind}`
  return `生成${kind}`
}

function videoResolutionForTask(task) {
  return VIDEO_RESOLUTIONS.some((option) => option.value === task?.metadata?.resolution)
    ? task.metadata.resolution
    : null
}

function resolutionLabel(value) {
  return VIDEO_RESOLUTIONS.find((option) => option.value === value)?.label || '720P'
}

function ShotEditor({ shot, onClose, onSave }) {
  const [title, setTitle] = useState(shot.title || '')
  const [framing, setFraming] = useState(shot.framing || '中景')
  const [duration, setDuration] = useState(normalizedVideoDuration(shot.duration))
  const [prompt, setPrompt] = useState(shot.prompt || '')
  const [negativePrompt, setNegativePrompt] = useState(shot.negativePrompt || '')
  const [continuityNote, setContinuityNote] = useState(shot.continuityNote || '')
  const [imageUrl, setImageUrl] = useState(shot.imageUrl || '')

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
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
              min="4"
              max="15"
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
        <label className="field-label">衔接上下文</label>
        <textarea
          value={continuityNote}
          placeholder="记录上一场结束时的人物位置、动作、物品、光线和最后一句对白"
          onChange={(event) => setContinuityNote(event.target.value)}
        />
        <label className="field-label">补充负面提示词</label>
        <textarea
          value={negativePrompt}
          placeholder="例如：不要水印、不要多余人物、不要面部漂移"
          onChange={(event) => setNegativePrompt(event.target.value)}
        />
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
