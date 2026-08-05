import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import JSZip from 'jszip'
import {
  ArrowDown,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Film,
  History,
  ImagePlus,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Video,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { AssetAwareTextarea, AssetShortcutBar } from '../features/assets/AssetShortcutBar'
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
  project,
  shots,
  assets,
  tasks,
  episodeDurationSeconds: projectEpisodeDurationSeconds = 60,
  onUpdateEpisodeDuration,
  concurrency = 1,
  unlimitedConcurrency = false,
  onRegenerate,
  onAutoSplitEpisodes,
  onCreate,
  onUpdate,
  onUpload,
  onGenerateVideo,
  onGenerateAllVideos,
  onNext,
}) {
  const [selected, setSelected] = useState(shots[0]?.id)
  const [editing, setEditing] = useState(null)
  const [historyShotId, setHistoryShotId] = useState(null)
  const [batchResolution, setBatchResolution] = useState('720p')
  const [batchMode, setBatchMode] = useState('parallel')
  const [episodeDuration, setEpisodeDuration] = useState(projectEpisodeDurationSeconds)
  const [shotResolutions, setShotResolutions] = useState({})
  const [splitting, setSplitting] = useState('')
  const [splittingEpisodes, setSplittingEpisodes] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [operationError, setOperationError] = useState('')
  const [operationNotice, setOperationNotice] = useState('')
  const [downloadingVideos, setDownloadingVideos] = useState(false)
  const isWebSeries = project?.contentType === 'short-drama'
  const shotMinDuration = isWebSeries ? 3 : 4
  const totalDuration = shots.reduce(
    (sum, shot) => sum + normalizedVideoDuration(shot.duration, shotMinDuration),
    0,
  )
  const batchPlan = planVideoBatch(shots, batchMode, concurrency)
  const activeBatchTasks = activeVideoTasksForShots(tasks, shots)
  const batchLocked = activeBatchTasks.length > 0
  const controlsLocked = batchLocked || Boolean(splitting) || splittingEpisodes || generatingAll
  const activeShotCount = new Set(activeBatchTasks.map((task) => task.metadata?.shotId)).size
  const episodes = groupShotsByEpisode(shots, shotMinDuration)
  const [selectedEpisode, setSelectedEpisode] = useState(() => episodeKeyForShot(shots[0]) || 'all')
  const visibleEpisodes =
    selectedEpisode === 'all'
      ? episodes
      : episodes.filter((episode) => episodeKey(episode) === selectedEpisode)
  const selectedEpisodeIndex = episodes.findIndex((episode) => episodeKey(episode) === selectedEpisode)
  const historyShot = shots.find((shot) => shot.id === historyShotId) || null
  const downloadableVideos = shots.flatMap((shot) => {
    const taskId = selectedVersionTaskId(tasks, shot, 'video')
    const task = tasks.find((item) => item.id === taskId && item.status === 'completed')
    const url = taskOutputUrl(task, 'video')
    return task && url ? [{ shot, task, url }] : []
  })

  useEffect(() => {
    setEpisodeDuration(projectEpisodeDurationSeconds)
  }, [project?.id, projectEpisodeDurationSeconds])

  useEffect(() => {
    if (selectedEpisode === 'all') return
    if (!episodes.some((episode) => episodeKey(episode) === selectedEpisode)) {
      setSelectedEpisode(episodes[0] ? episodeKey(episodes[0]) : 'all')
    }
  }, [episodes, selectedEpisode])

  const splitFromScript = async (mode) => {
    if (controlsLocked) return
    setSplitting(mode)
    setOperationError('')
    try {
      await onRegenerate(mode, episodeDuration)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setSplitting('')
    }
  }

  const autoSplitEpisodes = async () => {
    if (controlsLocked || !shots.length) return
    setSplittingEpisodes(true)
    setOperationError('')
    setOperationNotice('')
    try {
      await onAutoSplitEpisodes(episodeDuration)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setSplittingEpisodes(false)
    }
  }

  const generateAll = async (mode = batchMode) => {
    if (controlsLocked) return
    if (
      mode === 'parallel' &&
      !window.confirm('安全并发只会同时生成互相独立的镜头链；同一链内仍会等待上一镜真实尾帧。确认开始吗？')
    )
      return
    if (
      mode === 'independent' &&
      !window.confirm('全部独立生成会取消所有镜头的尾帧承接关系，速度更快，但镜头连续性会降低。确认继续吗？')
    )
      return
    setGeneratingAll(true)
    setOperationError('')
    setOperationNotice('')
    try {
      await onGenerateAllVideos(shots, batchResolution, mode)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setGeneratingAll(false)
    }
  }

  const downloadCompletedVideos = async () => {
    if (!downloadableVideos.length || downloadingVideos) return
    setDownloadingVideos(true)
    setOperationError('')
    setOperationNotice('')
    try {
      const zip = new JSZip()
      const { successCount, failures } = await addStoryboardVideosToArchive(zip, downloadableVideos)
      if (!successCount) {
        throw new Error(
          `没有可下载的视频；${failures.length} 条已完成记录的源文件暂不可用，请重新生成后再试。`,
        )
      }
      const archive = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })
      downloadBlob(archive, `${safeFileName(project.name || '序幕TV项目')}-分镜视频.zip`)
      setOperationNotice(
        failures.length
          ? `已打包 ${successCount} 条视频，另有 ${failures.length} 条源文件暂不可用，详情已写入压缩包。`
          : `已打包 ${successCount} 条视频。`,
      )
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setDownloadingVideos(false)
    }
  }

  const latestEpisode = episodes.at(-1)
  const newShotDraft = (episodeNumber = latestEpisode?.number || 1, forceNewEpisode = false) => ({
    title: forceNewEpisode ? `第 ${episodeNumber} 集 · 开场镜头` : `镜头 ${shots.length + 1}`,
    framing: '中景',
    duration: shotMinDuration,
    prompt: '',
    negativePrompt: '',
    imageUrl: null,
    continuityMode: forceNewEpisode || !shots.length ? 'independent' : 'continue',
    continuityNote: '',
    episodeBreakBefore: forceNewEpisode,
    episodeNumber,
    episodeTitle: forceNewEpisode
      ? `第 ${episodeNumber} 集`
      : latestEpisode?.title || `第 ${episodeNumber} 集`,
    episodeKind: 'standard',
  })

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
          title="每个剧本场次生成一个视频镜头，不再自动把场内动作重复拆开"
        >
          {splitting === 'scene' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
          {splitting === 'scene' ? '正在按场次智能生成' : '按场次智能生成'}
        </button>
        <button
          className="button secondary"
          onClick={() => void splitFromScript('beat')}
          disabled={controlsLocked}
        >
          {splitting === 'beat' ? <LoaderCircle size={16} className="spin" /> : <Scissors size={16} />}
          {splitting === 'beat' ? '正在动作级细拆' : '高级：动作级细拆'}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setEditing(newShotDraft())}
          disabled={controlsLocked}
        >
          <Plus size={16} /> 添加分镜
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setEditing(newShotDraft((latestEpisode?.number || 0) + 1, true))}
          disabled={controlsLocked}
        >
          <BookOpenText size={16} /> 添加分集
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
        <span className="safe-parallel-help" tabIndex={0} aria-label="安全并发生成说明">
          <CircleHelp size={16} />
          <span role="tooltip">独立镜头链会同时生成；同一链内必须等上一镜真实尾帧返回后再生成下一镜。</span>
        </span>
        <button
          className="button secondary"
          onClick={() => void generateAll('independent')}
          disabled={!shots.length || controlsLocked}
          title="忽略尾帧承接，把所有镜头作为独立任务同时提交"
        >
          <Zap size={16} /> 全部独立生成
        </button>
        <button
          className="button secondary"
          onClick={() => void downloadCompletedVideos()}
          disabled={!downloadableVideos.length || downloadingVideos}
          title={`下载当前选中的已完成视频版本，共 ${downloadableVideos.length} 条`}
        >
          {downloadingVideos ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
          {downloadingVideos ? '正在打包' : `批量下载 ${downloadableVideos.length} 条`}
        </button>
      </PageHeader>
      <div className="episode-split-toolbar">
        <div>
          <span className="eyebrow">剧集结构</span>
          <strong>按目标时长自动分集</strong>
          <small>镜头保持完整，钩子留在本集末镜；强制分集标记优先生效</small>
        </div>
        <label>
          <span>每集时长</span>
          <span className="episode-duration-input">
            <input
              aria-label="分镜每集时长（秒）"
              type="number"
              min="30"
              max="300"
              step="1"
              value={episodeDuration}
              disabled={controlsLocked}
              onChange={(event) => setEpisodeDuration(Number(event.target.value) || 0)}
              onBlur={() => {
                const next = Math.min(300, Math.max(30, Math.round(Number(episodeDuration) || 60)))
                setEpisodeDuration(next)
                if (next !== projectEpisodeDurationSeconds && onUpdateEpisodeDuration) {
                  void onUpdateEpisodeDuration(next).catch((error) => setOperationError(error.message))
                }
              }}
            />
            <em>秒</em>
          </span>
          <span className="episode-duration-source">沿用剧本设置</span>
        </label>
        <button
          className="button secondary"
          disabled={!shots.length || controlsLocked}
          onClick={() => void autoSplitEpisodes()}
        >
          {splittingEpisodes ? <LoaderCircle size={16} className="spin" /> : <Scissors size={16} />}
          {splittingEpisodes ? '正在分集' : '自动分集'}
        </button>
      </div>
      <div className="storyboard-summary">
        <span>
          <Film size={16} /> {episodes.length} 集 · {shots.length} 个镜头
        </span>
        <div>
          <span>{shots.length} 个镜头</span>
          <span>{totalDuration} 秒</span>
          <span>{Math.max(0, shots.length - 1)} 个衔接点</span>
          <span>
            {batchPlan.immediateLaneCount} / {unlimitedConcurrency ? '演示不限' : concurrency} 路链路
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
      {operationNotice && (
        <p className="operation-notice" role="status">
          {operationNotice}
        </p>
      )}
      {batchLocked && (
        <div className="storyboard-batch-lock" role="status">
          <LockKeyhole size={17} />
          <div>
            <strong>当前生成批次已锁定</strong>
            <span>
              有 {activeShotCount}{' '}
              个分镜视频任务仍在排队、暂停或生成中。批次策略暂时锁定；未在执行的镜头仍可编辑，也可确认后强制独立生成。
            </span>
          </div>
        </div>
      )}
      {episodes.length > 1 && (
        <nav className="episode-navigator" aria-label="剧集导航">
          <div>
            <span>当前查看</span>
            <strong>
              {selectedEpisode === 'all'
                ? `全部 ${episodes.length} 集`
                : episodes[selectedEpisodeIndex]?.title || '选择剧集'}
            </strong>
          </div>
          <IconButton
            label="上一集"
            disabled={selectedEpisode === 'all' || selectedEpisodeIndex <= 0}
            onClick={() => setSelectedEpisode(episodeKey(episodes[selectedEpisodeIndex - 1]))}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <select
            value={selectedEpisode}
            aria-label="选择要查看的剧集"
            onChange={(event) => setSelectedEpisode(event.target.value)}
          >
            {episodes.map((episode) => (
              <option value={episodeKey(episode)} key={episodeKey(episode)}>
                第 {episode.number} 集 · {episode.title} · {episode.shots.length} 镜
              </option>
            ))}
            <option value="all">全部剧集</option>
          </select>
          <IconButton
            label="下一集"
            disabled={selectedEpisode === 'all' || selectedEpisodeIndex >= episodes.length - 1}
            onClick={() => setSelectedEpisode(episodeKey(episodes[selectedEpisodeIndex + 1]))}
          >
            <ChevronRight size={16} />
          </IconButton>
        </nav>
      )}
      <div className="episode-list">
        {visibleEpisodes.map((episode) => (
          <section className={`episode-group ${episode.kind}`} key={episode.number}>
            <header className="episode-header">
              <div>
                <span>第 {episode.number} 集</span>
                <strong>{episode.title}</strong>
                {episode.hasHook && <small>末镜为剧情钩子</small>}
              </div>
              <div>
                <span>{episode.shots.length} 个镜头</span>
                <span>{episode.duration} 秒</span>
              </div>
            </header>
            <div className="shot-list">
              {episode.shots.map((shot) => {
                const globalIndex = shots.findIndex((item) => item.id === shot.id)
                const previousShot = globalIndex > 0 ? shots[globalIndex - 1] : null
                return (
                  <ShotRow
                    key={shot.id}
                    shot={shot}
                    minDuration={shotMinDuration}
                    previousShot={previousShot}
                    selected={selected === shot.id}
                    assets={assets}
                    tasks={tasks}
                    batchLocked={batchLocked}
                    resolution={
                      shotResolutions[shot.id] ||
                      videoResolutionForTask(taskFor(tasks, shot, 'video')) ||
                      batchResolution
                    }
                    onSelect={() => setSelected(shot.id)}
                    onResolutionChange={(value) =>
                      setShotResolutions((current) => ({ ...current, [shot.id]: value }))
                    }
                    onUpdate={onUpdate}
                    onEdit={() => setEditing(shot)}
                    onHistory={() => setHistoryShotId(shot.id)}
                    onGenerateVideo={onGenerateVideo}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="sticky-actions">
        <span>视频 18 积分；直接使用项目资产与上一镜真实尾帧，不预生成静态分镜图。</span>
        <button className="button primary" onClick={onNext}>
          查看生成队列 <ArrowRight size={16} />
        </button>
      </div>
      {editing && (
        <ShotEditor
          shot={editing}
          minDuration={shotMinDuration}
          assets={assets}
          tasks={tasks}
          onUpload={onUpload}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.id && isActive(taskFor(tasks, editing, 'video'))) {
              setOperationError('这个镜头正在生成，当前版本完成或取消后才能修改。')
              return
            }
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
        />
      )}
      {historyShot && (
        <ShotHistoryModal
          shot={historyShot}
          tasks={tasks}
          onClose={() => setHistoryShotId(null)}
          onRestore={async (kind, taskId) => {
            const field = kind === 'image' ? 'selectedImageTaskId' : 'selectedVideoTaskId'
            await onUpdate(historyShot.id, { [field]: taskId })
          }}
        />
      )}
    </div>
  )
}

function taskFor(tasks, shot, kind) {
  const shotId = typeof shot === 'string' ? shot : shot.id
  const selectedTaskId =
    typeof shot === 'string' ? null : kind === 'image' ? shot.selectedImageTaskId : shot.selectedVideoTaskId
  const candidates = tasks.filter((task) => task.kind === kind && task.metadata?.shotId === shotId)
  return (
    candidates.find((task) => isActive(task) && typeof task.metadata?.queueHiddenAt !== 'string') ||
    candidates.find((task) => task.id === selectedTaskId && task.status === 'completed') ||
    candidates.find((task) => typeof task.metadata?.queueHiddenAt !== 'string') ||
    candidates.find((task) => task.status === 'completed') ||
    null
  )
}

function ShotRow({
  shot,
  minDuration = 4,
  previousShot,
  selected,
  assets,
  tasks,
  batchLocked,
  resolution,
  onSelect,
  onResolutionChange,
  onUpdate,
  onEdit,
  onHistory,
  onGenerateVideo,
}) {
  const videoTask = taskFor(tasks, shot, 'video')
  const previewVideoTaskId = selectedVersionTaskId(tasks, shot, 'video')
  const previewVideoTask = tasks.find((task) => task.id === previewVideoTaskId) || null
  const previewVideoUrl = taskOutputUrl(previewVideoTask, 'video')
  const references = selectShotAssetReferences(assets, shot)
  const videoMatchesAssets = taskUsesAssetReferences(videoTask, references)
  const videoActionLabel = generationActionLabel(videoTask, videoMatchesAssets, '视频')

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
      <article className={`shot-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <div className="shot-number">{String(shot.order).padStart(2, '0')}</div>
        <div className={`shot-thumb ${previewVideoUrl ? 'has-video' : ''}`}>
          {previewVideoUrl ? (
            <video
              src={previewVideoUrl}
              controls
              playsInline
              preload="metadata"
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
              {videoTask ? ` · ${resolutionLabel(videoResolutionForTask(videoTask))}` : ''}
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
            className="shot-action-button video"
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
            {isActive(videoTask) ? <LoaderCircle size={16} className="spin" /> : <Video size={16} />}
            <span>{videoActionLabel}</span>
          </button>
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
          </div>
        </div>
      </article>
    </Fragment>
  )
}

function ShotHistoryModal({ shot, tasks, onClose, onRestore }) {
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

function ShotHistoryColumn({ title, kind, versions, selectedTaskId, restoring, onRestore }) {
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
                    <video src={url || undefined} controls preload="metadata" />
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
                    {current ? '正在使用' : '恢复此版本'}
                  </button>
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

function shotVersionPair(tasks, shot, kind) {
  const completed = tasks
    .filter((task) => task.kind === kind && task.metadata?.shotId === shot.id && task.status === 'completed')
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  if (!completed.length) return []
  const selectedId = selectedVersionTaskId(tasks, shot, kind)
  const current = completed.find((task) => task.id === selectedId) || completed[0]
  const previous = completed.find((task) => task.id !== current.id)
  return [current, previous].filter(Boolean)
}

function selectedVersionTaskId(tasks, shot, kind) {
  const storedId = kind === 'image' ? shot.selectedImageTaskId : shot.selectedVideoTaskId
  if (
    storedId &&
    tasks.some(
      (task) =>
        task.id === storedId &&
        task.kind === kind &&
        task.metadata?.shotId === shot.id &&
        task.status === 'completed',
    )
  )
    return storedId
  return tasks
    .filter((task) => task.kind === kind && task.metadata?.shotId === shot.id && task.status === 'completed')
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0]?.id
}

function taskOutputUrl(task, kind) {
  if (!task) return null
  if (kind === 'video')
    return task.resultUrl || task.outputs?.find((output) => output.mediaType === 'video')?.url
  return task.resultUrl || task.outputs?.find((output) => output.mediaType === 'image')?.url
}

export async function addStoryboardVideosToArchive(zip, videos, fetchVideo = globalThis.fetch) {
  const failures = []
  let successCount = 0
  for (const { shot, url } of videos) {
    try {
      const response = await fetchVideo(url, { credentials: 'include' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const episode = `第${String(shot.episodeNumber || 1).padStart(2, '0')}集`
      const name = `${String(shot.order).padStart(2, '0')}-${safeFileName(shot.title || '未命名镜头')}.mp4`
      zip.folder(episode)?.file(name, await response.blob())
      successCount += 1
    } catch (error) {
      failures.push({ shot, message: error instanceof Error ? error.message : String(error) })
    }
  }
  if (failures.length) {
    zip.file(
      '_下载失败清单.txt',
      [
        '以下分镜的已完成记录暂时无法读取源文件，可在分镜页重新生成后再次下载：',
        ...failures.map(
          ({ shot, message }) =>
            `第 ${shot.episodeNumber || 1} 集 · ${shot.title || `镜头 ${shot.order}`}：${message}`,
        ),
      ].join('\n'),
    )
  }
  return { successCount, failures }
}

function safeFileName(value) {
  return [...String(value || '')]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
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

export function groupShotsByEpisode(shots, minDuration = 4) {
  const groups = new Map()
  for (const shot of shots) {
    const number = shot.episodeNumber || 1
    const kind = shot.episodeKind || 'standard'
    const key = String(number)
    const current = groups.get(key) || {
      number,
      title: shot.episodeTitle || `第 ${number} 集`,
      kind: 'standard',
      hasHook: false,
      duration: 0,
      shots: [],
    }
    current.shots.push(shot)
    current.duration += normalizedVideoDuration(shot.duration, minDuration)
    current.hasHook ||= kind === 'hook'
    current.kind = current.hasHook ? 'hook' : 'standard'
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => left.number - right.number)
}

function episodeKey(episode) {
  return String(episode.number)
}

function episodeKeyForShot(shot) {
  if (!shot) return ''
  return String(shot.episodeNumber || 1)
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

function ShotEditor({ shot, minDuration = 4, assets = [], tasks = [], onUpload, onClose, onSave }) {
  const [title, setTitle] = useState(shot.title || '')
  const [framing, setFraming] = useState(shot.framing || '中景')
  const [duration, setDuration] = useState(normalizedVideoDuration(shot.duration, minDuration))
  const [prompt, setPrompt] = useState(shot.prompt || '')
  const promptArea = useRef(null)
  const [negativePrompt, setNegativePrompt] = useState(shot.negativePrompt || '')
  const [continuityNote, setContinuityNote] = useState(shot.continuityNote || '')
  const [imageUrl, setImageUrl] = useState(shot.imageUrl || '')
  const [episodeNumber, setEpisodeNumber] = useState(shot.episodeNumber || 1)
  const [episodeTitle, setEpisodeTitle] = useState(shot.episodeTitle || `第 ${shot.episodeNumber || 1} 集`)
  const [episodeKind, setEpisodeKind] = useState(shot.episodeKind || 'standard')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

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
            episodeBreakBefore: Boolean(shot.episodeBreakBefore),
            episodeNumber: Number(episodeNumber),
            episodeTitle: episodeTitle.trim() || `第 ${episodeNumber} 集`,
            episodeKind,
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
              min={minDuration}
              max="15"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <label>
            <span>所属集数</span>
            <input
              className="text-input"
              type="number"
              min="1"
              value={episodeNumber}
              onChange={(event) => setEpisodeNumber(event.target.value)}
            />
          </label>
          <label>
            <span>剧集标题</span>
            <input
              className="text-input"
              value={episodeTitle}
              maxLength={120}
              onChange={(event) => setEpisodeTitle(event.target.value)}
            />
          </label>
          <label>
            <span>剧集类型</span>
            <select value={episodeKind} onChange={(event) => setEpisodeKind(event.target.value)}>
              <option value="standard">常规剧集</option>
              <option value="hook">剧情钩子</option>
            </select>
          </label>
          <label>
            <span>参考图片 URL</span>
            <input
              className="text-input"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />
          </label>
        </div>
        <div className="shot-reference-editor">
          <div className="shot-reference-preview">
            {imageUrl ? <img src={imageUrl} alt="镜头参考" /> : <ImagePlus size={24} />}
          </div>
          <div>
            <strong>镜头参考图</strong>
            <span>生成分镜图和视频时作为本镜头画面参考。</span>
          </div>
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
          {imageUrl && (
            <IconButton label="移除参考图" type="button" onClick={() => setImageUrl('')}>
              <X size={15} />
            </IconButton>
          )}
        </div>
        {uploadError && (
          <p className="operation-error" role="alert">
            {uploadError}
          </p>
        )}
        <label className="field-label">画面提示词</label>
        <AssetAwareTextarea
          inputRef={promptArea}
          assets={assets}
          tasks={tasks}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          aria-label="画面提示词"
        />
        <AssetShortcutBar
          assets={assets}
          tasks={tasks}
          value={prompt}
          onChange={setPrompt}
          inputRef={promptArea}
          label="本镜头资产快捷键"
        />
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
    </div>,
    document.body,
  )
}
