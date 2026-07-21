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
  assets = [],
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
  const completedShotCount = shots.filter((item) => completedVideoTaskForShot(tasks, item.id)).length
  const hasAllShotVideos = shots.length > 0 && completedShotCount === shots.length
  const audioAssets = assets.filter((asset) => asset.kind === 'audio')
  const audioTasks = tasks.filter((task) => task.kind === 'audio')
  const audioAcceptance = audioAcceptanceFor(audioAssets, audioTasks)
  const audioAccepted = audioAssets.length === 0 || audioAcceptance.acceptedCount === audioAssets.length
  const isExporting = exportTask?.status === 'queued' || exportTask?.status === 'running'
  const canExport = hasAllShotVideos && audioAccepted && !isExporting
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
        description={`先验收镜头视频和音频，再导出《${project.name}》成片 MP4。`}
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
        <button className="button primary" onClick={onExport} disabled={!canExport}>
          <Download size={16} /> 导出 MP4
        </button>
      </PageHeader>
      <AcceptanceChecklist
        completedShotCount={completedShotCount}
        totalShots={shots.length}
        audioAssets={audioAssets}
        acceptedAudioCount={audioAcceptance.acceptedCount}
        exportTask={exportTask}
        completedExportTask={completedExportTask}
      />
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

function AcceptanceChecklist({
  completedShotCount,
  totalShots,
  audioAssets,
  acceptedAudioCount,
  exportTask,
  completedExportTask,
}) {
  const shotOk = totalShots > 0 && completedShotCount === totalShots
  const audioOk = audioAssets.length === 0 || acceptedAudioCount === audioAssets.length
  const exportOk = Boolean(completedExportTask)
  return (
    <section className="film-acceptance">
      <AcceptanceItem
        ok={shotOk}
        title="镜头视频"
        detail={`${completedShotCount}/${totalShots} 个镜头已完成`}
      />
      <AcceptanceItem
        ok={audioOk}
        title="音频"
        detail={
          audioAssets.length
            ? `${acceptedAudioCount}/${audioAssets.length} 个音频资产可用于导出`
            : '未配置音频资产，可直接导出无音轨版本'
        }
      />
      <AcceptanceItem
        ok={exportOk}
        pending={exportTask?.status === 'queued' || exportTask?.status === 'running'}
        title="成片 MP4"
        detail={exportLabel(exportTask, completedExportTask)}
      />
    </section>
  )
}

function AcceptanceItem({ ok, pending = false, title, detail }) {
  const className = ok ? 'good' : pending ? 'pending' : 'bad'
  return (
    <div className={`film-acceptance-item ${className}`}>
      <span>
        {ok ? (
          <Check size={15} />
        ) : pending ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <AlertCircle size={15} />
        )}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

function exportLabel(exportTask, completedExportTask) {
  if (completedExportTask) return 'MP4 已生成，可下载验收'
  if (exportTask?.status === 'queued') return '导出任务等待中'
  if (exportTask?.status === 'running') return `导出中 ${exportTask.progress}%`
  if (exportTask?.status === 'failed') return exportTask.error || '导出失败，可返回生成页重试'
  return '待导出'
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

function audioAcceptanceFor(audioAssets, audioTasks) {
  const completedTaskByAsset = new Map(
    audioTasks
      .filter((task) => task.status === 'completed' && resultUrlForTask(task) && task.metadata?.assetId)
      .map((task) => [task.metadata.assetId, task]),
  )
  const acceptedCount = audioAssets.filter(
    (asset) => asset.references?.length || completedTaskByAsset.has(asset.id),
  ).length

  return { acceptedCount }
}
