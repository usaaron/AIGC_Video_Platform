import {
  Check,
  Download,
  ExternalLink,
  Film,
  History,
  LoaderCircle,
  RefreshCw,
  Save,
  TriangleAlert,
  Video,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui'
import {
  completedShotVideoTask,
  contiguousSourceVideoTaskIds,
  filmPreviewTaskFor,
  isCurrentFilmPreview,
  latestCompletedFilmPreviewTask,
  sourceVideoTaskIds,
} from '../features/film/filmPreview'
import { projectRatioMode } from '../features/film/projectRatio'
import { normalizedVideoDuration } from '@seqora/prompting'

export function FilmPage({
  project,
  shots,
  tasks,
  currentShot,
  setCurrentShot,
  onSave,
  onEdit,
  onComposePreview,
  onExport,
}) {
  const [viewMode, setViewMode] = useState('full')
  const [composeSubmitting, setComposeSubmitting] = useState(null)
  const [loadedVideoUrl, setLoadedVideoUrl] = useState(null)
  const [failedVideoUrl, setFailedVideoUrl] = useState(null)
  const episodeNumbers = [...new Set(shots.map((item) => item.episodeNumber || 1))].sort(
    (left, right) => left - right,
  )
  const [selectedEpisode, setSelectedEpisode] = useState(() => String(episodeNumbers[0] || 'all'))
  const [selectedPreviewTaskId, setSelectedPreviewTaskId] = useState('current')
  const episodeNumber = selectedEpisode === 'all' ? null : Number(selectedEpisode)
  const shotMinDuration = project?.contentType === 'short-drama' ? 3 : 4
  const scopedShots = episodeNumber
    ? shots.filter((item) => (item.episodeNumber || 1) === episodeNumber)
    : shots
  const selectedGlobalShot = shots[currentShot]
  const scopedCurrentIndex = scopedShots.findIndex((item) => item.id === selectedGlobalShot?.id)
  const safeIndex = scopedCurrentIndex >= 0 ? scopedCurrentIndex : 0
  const shot = scopedShots[safeIndex]
  const totalDuration = scopedShots.reduce(
    (sum, item) => sum + normalizedVideoDuration(item.duration, shotMinDuration),
    0,
  )
  const videoTask = videoTaskFor(tasks, shot)
  const videoUrl = videoUrlFor(videoTask)
  const videoState = stateFor(videoTask)
  const ratioMode = projectRatioMode(project.aspectRatio)
  const completedSources = scopedShots.map((item) => completedShotVideoTask(tasks, item))
  const readyShotCount = completedSources.filter(Boolean).length
  const partialSourceTaskIds = contiguousSourceVideoTaskIds(tasks, scopedShots)
  const partialDuration = scopedShots
    .slice(0, partialSourceTaskIds.length)
    .reduce((sum, item) => sum + normalizedVideoDuration(item.duration, shotMinDuration), 0)
  const sourceTaskIds = sourceVideoTaskIds(tasks, scopedShots)
  const allShotsReady = scopedShots.length > 0 && sourceTaskIds.length === scopedShots.length
  const scopedPreviewTasks = tasks.filter(
    (task) => task.metadata?.generationStage === 'film-preview' && previewMatchesEpisode(task, episodeNumber),
  )
  const fullPreviewTask = filmPreviewTaskFor(scopedPreviewTasks, sourceTaskIds, 'full')
  const fullPreviewIsCurrent = isCurrentFilmPreview(fullPreviewTask, sourceTaskIds, 'full')
  const partialPreviewTask = filmPreviewTaskFor(scopedPreviewTasks, partialSourceTaskIds, 'partial')
  const partialPreviewIsCurrent = isCurrentFilmPreview(partialPreviewTask, partialSourceTaskIds, 'partial')
  const retainedFullPreviewTask = latestCompletedFilmPreviewTask(scopedPreviewTasks, 'full')
  const retainedPartialPreviewTask = latestCompletedFilmPreviewTask(scopedPreviewTasks, 'partial')
  const currentPreviewMode = fullPreviewIsCurrent
    ? 'full'
    : partialPreviewIsCurrent
      ? 'partial'
      : retainedFullPreviewTask
        ? 'full'
        : retainedPartialPreviewTask
          ? 'partial'
          : 'full'
  const currentPreviewTask = fullPreviewIsCurrent
    ? fullPreviewTask
    : partialPreviewIsCurrent
      ? partialPreviewTask
      : currentPreviewMode === 'full'
        ? retainedFullPreviewTask || fullPreviewTask
        : retainedPartialPreviewTask || partialPreviewTask
  const selectedHistoryTask = scopedPreviewTasks.find((task) => task.id === selectedPreviewTaskId)
  const previewMode =
    selectedHistoryTask?.metadata?.previewMode === 'partial' ? 'partial' : currentPreviewMode
  const previewTask = selectedHistoryTask || currentPreviewTask
  const previewIsCurrent = selectedHistoryTask
    ? isCurrentFilmPreview(
        selectedHistoryTask,
        selectedHistoryTask.metadata?.previewMode === 'partial' ? partialSourceTaskIds : sourceTaskIds,
        selectedHistoryTask.metadata?.previewMode === 'partial' ? 'partial' : 'full',
      )
    : currentPreviewMode === 'full'
      ? fullPreviewIsCurrent
      : partialPreviewIsCurrent
  const previewUrl = videoUrlFor(previewTask)
  const retainedPreviewVisible = Boolean(previewUrl && !previewIsCurrent)
  const previewShotCount = retainedPreviewVisible
    ? numericMetadata(previewTask, 'sourceShotCount', 0)
    : previewMode === 'partial'
      ? partialSourceTaskIds.length
      : readyShotCount
  const previewDuration = retainedPreviewVisible
    ? numericMetadata(previewTask, 'duration', 0)
    : previewMode === 'partial'
      ? partialDuration
      : totalDuration
  const previewState = stateForFilmPreview(
    previewTask,
    previewIsCurrent,
    readyShotCount,
    scopedShots.length,
    previewMode,
    partialSourceTaskIds.length,
  )
  const previewActive =
    previewIsCurrent &&
    (previewTask?.status === 'queued' ||
      previewTask?.status === 'running' ||
      previewTask?.status === 'paused')
  const displayUrl = viewMode === 'full' ? previewUrl : videoUrl
  const displayState = viewMode === 'full' ? previewState : videoState
  const displayVideoLoaded = Boolean(displayUrl && loadedVideoUrl === displayUrl)
  const displayVideoFailed = Boolean(displayUrl && failedVideoUrl === displayUrl)
  const previewDownloadName = `${safeFileName(project.name)}-${
    retainedPreviewVisible
      ? previewMode === 'partial'
        ? `上一版前${previewShotCount}镜片段`
        : '上一版完整成片'
      : previewMode === 'partial'
        ? `前${partialSourceTaskIds.length}镜片段`
        : '完整成片'
  }-${episodeNumber ? `第${episodeNumber}集` : '全部剧集'}-v${numericMetadata(previewTask, 'projectVersion', project.version)}.mp4`

  useEffect(() => {
    setSelectedPreviewTaskId('current')
  }, [project.id, selectedEpisode])

  const selectEpisode = (value) => {
    setSelectedEpisode(value)
    setViewMode('full')
    const nextEpisode = value === 'all' ? null : Number(value)
    const firstShot = nextEpisode ? shots.find((item) => (item.episodeNumber || 1) === nextEpisode) : shots[0]
    if (firstShot) setCurrentShot(shots.findIndex((item) => item.id === firstShot.id))
  }

  const composePreview = async (mode) => {
    setComposeSubmitting(mode)
    try {
      await onComposePreview(mode, episodeNumber)
      setViewMode('full')
    } finally {
      setComposeSubmitting(null)
    }
  }

  const playNextCompletedVideo = () => {
    const nextIndex = scopedShots.findIndex(
      (item, index) => index > safeIndex && Boolean(videoUrlFor(videoTaskFor(tasks, item.id))),
    )
    if (nextIndex >= 0) setCurrentShot(shots.findIndex((item) => item.id === scopedShots[nextIndex].id))
  }

  if (!shot)
    return (
      <div className="page empty-workspace">
        <h1>还没有分镜</h1>
        <p>先根据剧本创建分镜，再预览成片。</p>
        <button className="button primary" onClick={onEdit}>
          进入分镜设计
        </button>
      </div>
    )

  return (
    <div className="page film-page">
      <PageHeader
        eyebrow={`第 5 步 · 成片 · v${project.version}`}
        title={`《${project.name}》预览`}
        description="先选择剧集范围，再检查、合成并保存当前工作版；历史合成结果可随时回看。"
      >
        <span className="inherited-ratio">
          成片比例 <strong>{project.aspectRatio}</strong>
        </span>
        <button className="button secondary" onClick={onSave}>
          <Save size={16} /> 保存当前工作版
        </button>
        <button className="button primary" onClick={onExport}>
          <Download size={16} /> 导出项目数据
        </button>
      </PageHeader>
      <div className="film-preview-toolbar">
        <div className="film-scope-controls">
          <label>
            <span>成片范围</span>
            <select value={selectedEpisode} onChange={(event) => selectEpisode(event.target.value)}>
              {episodeNumbers.map((number) => (
                <option key={number} value={number}>
                  第 {number} 集
                </option>
              ))}
              {episodeNumbers.length > 1 && <option value="all">全部剧集</option>}
            </select>
          </label>
          <label>
            <span>
              <History size={13} /> 观看版本
            </span>
            <select
              value={selectedPreviewTaskId}
              onChange={(event) => {
                setSelectedPreviewTaskId(event.target.value)
                setViewMode('full')
              }}
            >
              <option value="current">当前工作版 · v{project.version}</option>
              {scopedPreviewTasks
                .filter((task) => task.status === 'completed' && task.metadata?.previewMode !== 'partial')
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    已合成 v{numericMetadata(task, 'projectVersion', 1)} ·{' '}
                    {formatFilmTaskTime(task.updatedAt)}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="film-view-switch" role="group" aria-label="成片观看模式">
          <button
            type="button"
            className={viewMode === 'full' ? 'active' : ''}
            aria-pressed={viewMode === 'full'}
            onClick={() => setViewMode('full')}
          >
            <Film size={15} /> 成片预览
          </button>
          <button
            type="button"
            className={viewMode === 'shot' ? 'active' : ''}
            aria-pressed={viewMode === 'shot'}
            onClick={() => setViewMode('shot')}
          >
            <Video size={15} /> 单镜头
          </button>
        </div>
        <div className="film-compose-control">
          <span className={previewUrl ? (retainedPreviewVisible ? 'retained' : 'ready') : ''}>
            {previewActive ? (
              <LoaderCircle size={15} className="spin" />
            ) : previewUrl ? (
              <Check size={15} />
            ) : (
              <Video size={15} />
            )}
            {previewActive
              ? `正在合成${previewMode === 'partial' ? '片段' : '完整成片'} ${previewTask.progress}%`
              : previewUrl
                ? retainedPreviewVisible
                  ? `上一版${previewMode === 'partial' ? '片段' : '完整成片'}已保留，当前分镜需重新生成`
                  : previewMode === 'partial'
                    ? `前 ${partialSourceTaskIds.length} 镜连续预览已就绪`
                    : '完整成片已就绪'
                : `视频生成进度 ${readyShotCount}/${scopedShots.length}`}
          </span>
          {previewUrl && (
            <>
              <a className="button secondary" href={previewUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> 打开播放
              </a>
              <a className="button primary" href={previewUrl} download={previewDownloadName}>
                <Download size={15} />
                {previewMode === 'partial' ? '下载片段' : '下载完整视频'}
              </a>
            </>
          )}
          {(!previewUrl || !previewIsCurrent) && (
            <>
              <button
                className="button secondary"
                type="button"
                disabled={
                  partialSourceTaskIds.length < 2 ||
                  allShotsReady ||
                  partialPreviewIsCurrent ||
                  composeSubmitting !== null
                }
                onClick={() => void composePreview('partial')}
              >
                {composeSubmitting === 'partial' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Video size={15} />
                )}
                合成已完成片段
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!allShotsReady || fullPreviewIsCurrent || composeSubmitting !== null}
                onClick={() => void composePreview('full')}
              >
                {composeSubmitting === 'full' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Film size={15} />
                )}
                {allShotsReady
                  ? '合成当前范围成片'
                  : `当前范围待完成 ${readyShotCount}/${scopedShots.length}`}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="film-layout">
        <section className="player-panel">
          <div className="film-player" data-ratio={ratioMode}>
            {displayUrl ? (
              <div className="film-media-shell">
                <video
                  key={displayUrl}
                  src={displayUrl}
                  className="film-frame"
                  controls
                  preload="auto"
                  playsInline
                  onCanPlay={() => {
                    setLoadedVideoUrl(displayUrl)
                    setFailedVideoUrl(null)
                  }}
                  onLoadedMetadata={() => {
                    setLoadedVideoUrl(displayUrl)
                    setFailedVideoUrl(null)
                  }}
                  onError={() => setFailedVideoUrl(displayUrl)}
                  onEnded={viewMode === 'shot' ? playNextCompletedVideo : undefined}
                />
                {!displayVideoLoaded && (
                  <div className={`film-video-status ${displayVideoFailed ? 'failed' : ''}`}>
                    {displayVideoFailed ? (
                      <TriangleAlert size={24} />
                    ) : (
                      <LoaderCircle size={24} className="spin" />
                    )}
                    <strong>{displayVideoFailed ? '应用内播放加载失败' : '正在读取视频'}</strong>
                    <span>
                      {displayVideoFailed
                        ? '可以使用上方“打开播放”或下载到本地观看。'
                        : '正在读取 MP4 元数据…'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="film-pending">
                <img
                  key={shot.id}
                  src={shot.imageUrl || '/demo/station.jpg'}
                  alt={`${shot.title}分镜参考图`}
                  className="film-frame"
                />
                <div className="film-pending-shade" />
                <div className={`film-pending-state ${displayState.tone}`}>
                  {displayState.icon}
                  <strong>{displayState.title}</strong>
                  <span>{displayState.detail}</span>
                </div>
              </div>
            )}
          </div>
        </section>
        <aside className="film-info">
          <span className="eyebrow">
            {viewMode === 'full'
              ? retainedPreviewVisible
                ? previewMode === 'partial'
                  ? '上一版片段'
                  : '上一版完整成片'
                : previewMode === 'partial'
                  ? '已完成片段'
                  : '完整成片'
              : '当前镜头'}
          </span>
          <h2>
            {viewMode === 'full'
              ? retainedPreviewVisible
                ? `《${project.name}》上一版成片快照`
                : previewMode === 'partial'
                  ? `《${project.name}》前 ${partialSourceTaskIds.length} 镜预览`
                  : `《${project.name}》全片预览`
              : `${String(shot.order).padStart(2, '0')} · ${shot.title}`}
          </h2>
          <img className="film-info-thumb" src={shot.imageUrl || '/demo/station.jpg'} alt="当前镜头缩略图" />
          <dl>
            <div>
              <dt>{viewMode === 'full' ? '镜头数量' : '景别'}</dt>
              <dd>
                {viewMode === 'full'
                  ? retainedPreviewVisible
                    ? `${previewShotCount}（上一版）`
                    : previewMode === 'partial'
                      ? `${partialSourceTaskIds.length}/${scopedShots.length}`
                      : `${readyShotCount}/${scopedShots.length}`
                  : shot.framing}
              </dd>
            </div>
            <div>
              <dt>{viewMode === 'full' ? '全片时长' : '输出时长'}</dt>
              <dd>
                {viewMode === 'full'
                  ? previewDuration
                  : normalizedVideoDuration(
                      videoTask?.metadata?.duration ?? shot.duration,
                      shotMinDuration,
                    )}{' '}
                秒
              </dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd className={displayUrl ? 'good' : displayState.tone}>
                {displayUrl && <Check size={13} />} {displayUrl ? '视频已就绪' : displayState.title}
              </dd>
            </div>
          </dl>
          <button className="button secondary full" onClick={onEdit}>
            <RefreshCw size={15} /> 返回修改分镜
          </button>
        </aside>
      </div>
      <section className="timeline-panel">
        <div className="panel-head">
          <div>
            <h2>时间线</h2>
            <span>
              {episodeNumber ? `第 ${episodeNumber} 集` : '全部剧集'} · {totalDuration} 秒
            </span>
          </div>
        </div>
        <div className="timeline-ruler">
          <span>00:00</span>
          <span>00:{Math.round(totalDuration / 4)}</span>
          <span>00:{Math.round(totalDuration / 2)}</span>
          <span>00:{totalDuration}</span>
        </div>
        <div className="timeline-track">
          {scopedShots.map((item, index) => (
            <button
              key={item.id}
              className={viewMode === 'shot' && safeIndex === index ? 'active' : ''}
              style={{ flex: normalizedVideoDuration(item.duration, shotMinDuration) }}
              onClick={() => {
                setCurrentShot(shots.findIndex((shotItem) => shotItem.id === item.id))
                setViewMode('shot')
              }}
            >
              <img src={item.imageUrl || '/demo/station.jpg'} alt="" />
              <span>{String(item.order).padStart(2, '0')}</span>
            </button>
          ))}
        </div>
        <div className="audio-track">
          <span>
            <Zap size={14} /> 项目环境音轨
          </span>
          <div />
        </div>
      </section>
    </div>
  )
}

function videoTaskFor(tasks, shot) {
  const shotId = shot?.id
  const selectedVideoTaskId = shot?.selectedVideoTaskId
  const shotTasks = tasks.filter(
    (task) => task.kind === 'video' && task.metadata?.shotId === shotId && task.status !== 'cancelled',
  )
  return (
    shotTasks.find(
      (task) => task.status === 'running' || task.status === 'queued' || task.status === 'paused',
    ) ||
    shotTasks.find((task) => task.id === selectedVideoTaskId && task.status === 'completed') ||
    shotTasks.find((task) => task.status === 'completed') ||
    shotTasks[0]
  )
}

function videoUrlFor(task) {
  if (task?.status !== 'completed') return null
  return task.resultUrl || task.outputs?.[0]?.url || null
}

function stateFor(task) {
  if (!task) {
    return {
      tone: 'idle',
      icon: <Video size={24} />,
      title: '视频未生成',
      detail: '请先在分镜页创建 Seedance 视频任务',
    }
  }
  if (task.status === 'failed') {
    return {
      tone: 'failed',
      icon: <TriangleAlert size={24} />,
      title: '视频生成失败',
      detail: task.error || '请返回分镜页重新生成',
    }
  }
  return {
    tone: 'active',
    icon: <LoaderCircle size={24} className="spin" />,
    title:
      task.status === 'running'
        ? `Seedance 生成中 ${task.progress}%`
        : task.status === 'paused'
          ? '视频已暂停'
          : '视频排队中',
    detail: '真实视频完成后才会在这里显示播放控件',
  }
}

function stateForFilmPreview(task, isCurrent, readyCount, shotCount, previewMode, contiguousCount) {
  const targetName = previewMode === 'partial' ? '片段预览' : '完整成片'
  if (task && isCurrent && task.status === 'failed') {
    return {
      tone: 'failed',
      icon: <TriangleAlert size={24} />,
      title: `${targetName}合成失败`,
      detail: task.error || `请重新合成${targetName}`,
    }
  }
  if (task && isCurrent && task.status !== 'completed') {
    return {
      tone: 'active',
      icon: <LoaderCircle size={24} className="spin" />,
      title: task.status === 'paused' ? `${targetName}已暂停` : `正在合成${targetName} ${task.progress}%`,
      detail: '本地合成只处理已生成视频，不会再次调用 Seedance 或扣除积分。',
    }
  }
  if (readyCount < shotCount) {
    return {
      tone: 'idle',
      icon: <Film size={24} />,
      title: contiguousCount >= 2 ? `可先合成前 ${contiguousCount} 镜` : '等待连续镜头完成',
      detail: `当前 ${readyCount}/${shotCount} 镜已完成；连续承接模式会按顺序生成，全部完成后自动合成完整 MP4。`,
    }
  }
  if (!task || !isCurrent) {
    return {
      tone: 'idle',
      icon: <Film size={24} />,
      title: task ? '镜头已更新，需要重新合成' : '完整预览尚未合成',
      detail: '点击“合成完整预览”，系统会按分镜顺序生成一个连续 MP4。',
    }
  }
  if (task.status === 'failed') {
    return {
      tone: 'failed',
      icon: <TriangleAlert size={24} />,
      title: '完整预览合成失败',
      detail: task.error || '请重新合成完整预览',
    }
  }
  return {
    tone: 'active',
    icon: <LoaderCircle size={24} className="spin" />,
    title: task.status === 'paused' ? '完整预览已暂停' : `正在合成完整预览 ${task.progress}%`,
    detail: '合成只处理已生成视频，不会再次调用 Seedance 或扣除积分。',
  }
}

function safeFileName(value) {
  return String(value || 'seqora-video')
    .replace(/[<>:"/\\|?*]/g, '-')
    .slice(0, 80)
}

function numericMetadata(task, key, fallback) {
  const value = task?.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function previewMatchesEpisode(task, episodeNumber) {
  const taskEpisode = task.metadata?.episodeNumber
  if (episodeNumber === null) return taskEpisode === null || taskEpisode === undefined
  return taskEpisode === episodeNumber
}

function formatFilmTaskTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '历史版本'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
