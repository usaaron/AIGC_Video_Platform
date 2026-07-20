import { useEffect, useRef } from 'react'
import {
  AlertCircle,
  Check,
  Clock3,
  Download,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Save,
} from 'lucide-react'
import { PageHeader } from '../components/ui'
import {
  completedFilmExportTask,
  completedVideoTaskForShot,
  downloadNameForTask,
  isPlayableVideoUrl,
  latestFilmExportTask,
  latestVideoTaskForShot,
  resultUrlForTask,
} from '../features/generation/taskResults'

export function FilmPage({
  project,
  shots,
  tasks = [],
  playing,
  setPlaying,
  currentShot,
  setCurrentShot,
  onSave,
  onEdit,
  onExport,
}) {
  const safeIndex = Math.min(currentShot, Math.max(0, shots.length - 1))
  const shot = shots[safeIndex]
  const totalDuration = shots.reduce((sum, item) => sum + item.duration, 0)
  const elapsed = shots.slice(0, safeIndex).reduce((sum, item) => sum + item.duration, 0)
  const statusTask = shot ? latestVideoTaskForShot(tasks, shot.id) : null
  const resultTask = shot ? completedVideoTaskForShot(tasks, shot.id) : null
  const exportTask = latestFilmExportTask(tasks)
  const completedExportTask = completedFilmExportTask(tasks)
  const exportUrl = completedExportTask ? resultUrlForTask(completedExportTask) : ''
  const hasAllShotVideos = shots.every((item) => completedVideoTaskForShot(tasks, item.id))
  const isExporting = exportTask?.status === 'queued' || exportTask?.status === 'running'
  const resultUrl = resultTask ? resultUrlForTask(resultTask) : ''
  const hasPlayableVideo = isPlayableVideoUrl(resultUrl)
  const previewUrl = resultUrl && !hasPlayableVideo ? resultUrl : shot?.imageUrl || '/demo/station.jpg'
  const videoRef = useRef(null)

  useEffect(() => {
    if (!videoRef.current) return
    if (playing) {
      void videoRef.current.play().catch(() => setPlaying(false))
      return
    }
    videoRef.current.pause()
  }, [playing, resultUrl, setPlaying])

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
        title="预览和导出"
        description={`先预览《${project.name}》，确认后导出项目包。`}
      >
        <button className="button secondary" onClick={onSave}>
          <Save size={16} /> 保存版本
        </button>
        {resultTask && (
          <a className="button secondary" href={resultUrl} download={downloadNameForTask(resultTask)}>
            <Download size={16} /> 下载当前视频
          </a>
        )}
        {completedExportTask && (
          <a
            className="button secondary"
            href={exportUrl}
            download={downloadNameForTask(completedExportTask)}
          >
            <Download size={16} /> 下载成片 MP4
          </a>
        )}
        <button className="button primary" onClick={onExport} disabled={!hasAllShotVideos || isExporting}>
          <Download size={16} /> 导出项目包
        </button>
      </PageHeader>
      <div className="film-layout">
        <section className="player-panel">
          <div className={`film-player ${hasPlayableVideo ? 'has-video' : ''}`}>
            {hasPlayableVideo ? (
              <video
                key={resultTask.id}
                ref={videoRef}
                src={resultUrl}
                poster={shot.imageUrl || '/demo/station.jpg'}
                className="film-frame"
                controls
                playsInline
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            ) : (
              <img key={shot.id} src={previewUrl} alt={shot.title} className="film-frame" />
            )}
            <div className="film-grade" />
            {!hasPlayableVideo && <div className="film-subtitle">{shot.prompt}</div>}
            {!hasPlayableVideo && (
              <button
                className="big-play"
                onClick={() => setPlaying((value) => !value)}
                aria-label={playing ? '暂停' : '播放'}
              >
                {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
              </button>
            )}
          </div>
          <div className="player-controls">
            <button onClick={() => setPlaying((value) => !value)} aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}
            </button>
            <span>00:{String(elapsed).padStart(2, '0')}</span>
            <div className="play-track">
              <span style={{ width: `${((safeIndex + 1) / shots.length) * 100}%` }} />
            </div>
            <span>00:{totalDuration}</span>
          </div>
        </section>
        <aside className="film-info">
          <span className="eyebrow">当前镜头</span>
          <h2>
            {String(shot.order).padStart(2, '0')} · {shot.title}
          </h2>
          <img src={previewUrl} alt="当前镜头缩略图" />
          <dl>
            <div>
              <dt>景别</dt>
              <dd>{shot.framing}</dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd>{shot.duration} 秒</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd className={shotStatusClass(statusTask, resultTask)}>
                {shotStatusIcon(statusTask, resultTask)} {shotStatusLabel(statusTask, resultTask)}
              </dd>
            </div>
          </dl>
          {resultTask && (
            <a className="button secondary full" href={resultUrl} download={downloadNameForTask(resultTask)}>
              <Download size={15} /> 下载当前视频
            </a>
          )}
          <button className="button secondary full" onClick={onEdit}>
            <RefreshCw size={15} /> 返回修改分镜
          </button>
        </aside>
      </div>
      <section className="film-shot-list-panel">
        <div className="panel-head">
          <div>
            <h2>镜头顺序</h2>
            <span>
              {shots.length} 个镜头 · {totalDuration} 秒
            </span>
          </div>
        </div>
        <div className="film-shot-list">
          {shots.map((item, index) => {
            const itemTask = latestVideoTaskForShot(tasks, item.id)
            const itemResult = completedVideoTaskForShot(tasks, item.id)
            const itemResultUrl = itemResult ? resultUrlForTask(itemResult) : ''
            const itemPreviewUrl =
              itemResultUrl && !isPlayableVideoUrl(itemResultUrl)
                ? itemResultUrl
                : item.imageUrl || '/demo/station.jpg'
            return (
              <button
                key={item.id}
                className={shotItemClass(safeIndex === index, itemTask, itemResult)}
                onClick={() => setCurrentShot(index)}
              >
                <img src={itemPreviewUrl} alt="" />
                <span>{String(item.order).padStart(2, '0')}</span>
                <strong>{item.title}</strong>
                <small>{shotStatusLabel(itemTask, itemResult)}</small>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function shotStatusLabel(task, resultTask) {
  if (task?.status === 'failed') return '生成失败'
  if (task?.status === 'running') return `${task.progress}%`
  if (task?.status === 'queued') return '等待生成'
  if (resultTask) return '视频已生成'
  return '可预览'
}

function shotStatusIcon(task, resultTask) {
  if (task?.status === 'failed') return <AlertCircle size={13} />
  if (task?.status === 'running') return <LoaderCircle size={13} className="spin" />
  if (task?.status === 'queued') return <Clock3 size={13} />
  if (resultTask) return <Check size={13} />
  return <Check size={13} />
}

function shotStatusClass(task, resultTask) {
  if (task?.status === 'failed') return 'bad'
  if (task?.status === 'running' || task?.status === 'queued') return 'pending'
  if (resultTask) return 'good'
  return 'good'
}

function shotItemClass(isActive, task, resultTask) {
  return [isActive ? 'active' : '', resultTask ? 'has-video' : '', task?.status === 'failed' ? 'failed' : '']
    .filter(Boolean)
    .join(' ')
}
