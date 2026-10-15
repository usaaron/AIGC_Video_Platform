import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock3,
  Download,
  FileText,
  Images,
  LoaderCircle,
  Music2,
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
import {
  FILM_FPS,
  FILM_RATIOS,
  FILM_RESOLUTIONS,
  completedAudioTasks,
  createFilmDraft,
  filmExportDraftForTask,
  moveFilmClip,
  orderedFilmShots,
  replaceFilmClip,
  syncFilmDraft,
  updateFilmClip,
} from '../features/film/filmDraft'

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
  const [draft, setDraft] = useState(() => createFilmDraft(project, shots, tasks))
  const shotSignature = useMemo(
    () => shots.map((item) => `${item.id}:${item.title}:${item.duration}`).join('|'),
    [shots],
  )

  useEffect(() => {
    setDraft((current) => syncFilmDraft(current, project, shots, tasks))
  }, [project, shotSignature, shots, tasks])

  const timelineShots = orderedFilmShots(shots, draft.sequence)
  const safeIndex = Math.min(currentShot, Math.max(0, timelineShots.length - 1))
  const shot = timelineShots[safeIndex]
  const totalDuration = timelineShots.reduce((sum, item) => sum + clipDurationFor(draft, item), 0)
  const elapsed = timelineShots
    .slice(0, safeIndex)
    .reduce((sum, item) => sum + clipDurationFor(draft, item), 0)
  const statusTask = shot ? latestVideoTaskForShot(tasks, shot.id) : null
  const resultTask = shot ? completedVideoTaskForShot(tasks, shot.id) : null
  const exportTask = latestFilmExportTask(tasks)
  const completedExportTask = completedFilmExportTask(tasks)
  const exportUrl = completedExportTask ? resultUrlForTask(completedExportTask) : ''
  const completedShotCount = shots.filter((item) => completedVideoTaskForShot(tasks, item.id)).length
  const exportDraft = filmExportDraftForTask(draft, shots, tasks)
  const hasAllTimelineVideos =
    timelineShots.length > 0 && exportDraft.timeline.length === timelineShots.length
  const audioAssets = assets.filter((asset) => asset.kind === 'audio')
  const audioTasks = tasks.filter((task) => task.kind === 'audio')
  const audioAcceptance = audioAcceptanceFor(audioAssets, audioTasks)
  const audioAccepted = audioAssets.length === 0 || audioAcceptance.acceptedCount === audioAssets.length
  const isExporting = exportTask?.status === 'queued' || exportTask?.status === 'running'
  const canExport = hasAllTimelineVideos && audioAccepted && !isExporting
  const resultUrl = resultTask ? resultUrlForTask(resultTask) : ''
  const hasPlayableVideo = isPlayableVideoUrl(resultUrl)
  const previewUrl = resultUrl && !hasPlayableVideo ? resultUrl : shot?.imageUrl || '/demo/station.jpg'
  const currentSubtitle = shot ? subtitleForShot(draft, shot) : ''
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
        <button className="button primary" onClick={() => onExport(exportDraft)} disabled={!canExport}>
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
            {draft.subtitlesEnabled && currentSubtitle && (
              <div className="film-subtitle">{currentSubtitle}</div>
            )}
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
            <span>{formatClock(elapsed)}</span>
            <div className="play-track">
              <span style={{ width: `${((safeIndex + 1) / timelineShots.length) * 100}%` }} />
            </div>
            <span>{formatClock(totalDuration)}</span>
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
              <dd>{clipDurationFor(draft, shot)} 秒</dd>
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
      <FilmEditorPanel
        draft={draft}
        setDraft={setDraft}
        shots={shots}
        tasks={tasks}
        timelineShots={timelineShots}
        activeIndex={safeIndex}
        totalDuration={totalDuration}
        onSelectShot={setCurrentShot}
      />
    </div>
  )
}

function FilmEditorPanel({
  draft,
  setDraft,
  shots,
  tasks,
  timelineShots,
  activeIndex,
  totalDuration,
  onSelectShot,
}) {
  const audioOptions = completedAudioTasks(tasks)
  const coverShot = shots.find((shot) => shot.id === draft.coverShotId) || timelineShots[0]
  const coverPreviewUrl = coverShot ? previewUrlForShot(coverShot, tasks) : '/demo/station.jpg'

  const patchDraft = (input) => setDraft((current) => ({ ...current, ...input }))
  const patchClip = (shotId, input) => setDraft((current) => updateFilmClip(current, shotId, input))

  const moveClip = (index, direction) => {
    setDraft((current) => ({ ...current, sequence: moveFilmClip(current.sequence, index, direction) }))
    onSelectShot(Math.min(Math.max(index + direction, 0), Math.max(0, timelineShots.length - 1)))
  }

  return (
    <section className="film-shot-list-panel film-editor-panel">
      <div className="panel-head">
        <div>
          <h2>轻量成片编辑</h2>
          <span>
            {timelineShots.length} 个镜头 · {formatClock(totalDuration)} · {draft.ratio} · {draft.resolution}
          </span>
        </div>
      </div>

      <div className="film-editor-settings">
        <section className="film-setting-block cover">
          <span>
            <Images size={14} /> 封面
          </span>
          <img src={coverPreviewUrl} alt="成片封面" />
          <select
            aria-label="选择封面"
            value={draft.coverShotId}
            onChange={(event) => patchDraft({ coverShotId: event.target.value })}
          >
            {shots.map((shot) => (
              <option key={shot.id} value={shot.id}>
                {String(shot.order).padStart(2, '0')} · {shot.title}
              </option>
            ))}
          </select>
        </section>

        <section className="film-setting-block output">
          <span>MP4 导出参数</span>
          <label>
            比例
            <select value={draft.ratio} onChange={(event) => patchDraft({ ratio: event.target.value })}>
              {FILM_RATIOS.map((ratio) => (
                <option key={ratio}>{ratio}</option>
              ))}
            </select>
          </label>
          <label>
            分辨率
            <select
              value={draft.resolution}
              onChange={(event) => patchDraft({ resolution: event.target.value })}
            >
              {FILM_RESOLUTIONS.map((resolution) => (
                <option key={resolution}>{resolution}</option>
              ))}
            </select>
          </label>
          <label>
            帧率
            <select value={draft.fps} onChange={(event) => patchDraft({ fps: Number(event.target.value) })}>
              {FILM_FPS.map((fps) => (
                <option key={fps} value={fps}>
                  {fps} fps
                </option>
              ))}
            </select>
          </label>
          <label className="film-subtitle-toggle">
            <input
              type="checkbox"
              checked={draft.subtitlesEnabled}
              onChange={(event) => patchDraft({ subtitlesEnabled: event.target.checked })}
            />
            <span>启用字幕</span>
          </label>
        </section>

        <section className="film-setting-block audio">
          <span>
            <Music2 size={14} /> BGM / 旁白
          </span>
          <label>
            音频轨
            <select
              value={draft.bgmTaskId}
              onChange={(event) => patchDraft({ bgmTaskId: event.target.value })}
            >
              <option value="">无音频轨</option>
              {audioOptions.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            旁白文案
            <textarea
              value={draft.voiceoverText}
              onChange={(event) => patchDraft({ voiceoverText: event.target.value })}
              placeholder="可留空"
            />
          </label>
        </section>
      </div>

      <div className="film-edit-timeline" aria-label="成片时间线">
        {timelineShots.map((item, index) => {
          const itemTask = latestVideoTaskForShot(tasks, item.id)
          const itemResult = completedVideoTaskForShot(tasks, item.id)
          const clip = draft.clips[item.id] || { duration: item.duration, subtitle: item.title }
          const isActive = activeIndex === index
          return (
            <article className={`film-edit-row ${isActive ? 'active' : ''}`} key={`${item.id}-${index}`}>
              <button className="film-edit-preview" type="button" onClick={() => onSelectShot(index)}>
                <img src={previewUrlForShot(item, tasks)} alt="" />
                <span>{String(index + 1).padStart(2, '0')}</span>
              </button>

              <div className="film-edit-main">
                <strong>{item.title}</strong>
                <small>
                  {item.framing} · {shotStatusLabel(itemTask, itemResult)}
                </small>
                <label className="film-edit-field subtitle">
                  <FileText size={13} /> 字幕
                  <input
                    value={clip.subtitle}
                    onChange={(event) => patchClip(item.id, { subtitle: event.target.value })}
                  />
                </label>
              </div>

              <div className="film-edit-controls">
                <div className="film-move-buttons">
                  <button type="button" disabled={index === 0} onClick={() => moveClip(index, -1)}>
                    <ArrowUp size={13} /> 上移
                  </button>
                  <button
                    type="button"
                    disabled={index === timelineShots.length - 1}
                    onClick={() => moveClip(index, 1)}
                  >
                    <ArrowDown size={13} /> 下移
                  </button>
                </div>

                <label className="film-edit-field trim">
                  裁剪时长
                  <input
                    min="1"
                    max="120"
                    type="number"
                    value={clip.duration}
                    onChange={(event) => patchClip(item.id, { duration: event.target.value })}
                  />
                </label>

                <label className="film-edit-field replace">
                  替换镜头
                  <select
                    value={item.id}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        sequence: replaceFilmClip(current.sequence, index, event.target.value),
                      }))
                    }
                  >
                    {shots.map((shot) => (
                      <option key={shot.id} value={shot.id}>
                        {String(shot.order).padStart(2, '0')} · {shot.title}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className={`film-cover-action ${draft.coverShotId === item.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => patchDraft({ coverShotId: item.id })}
                >
                  封面
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
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

function previewUrlForShot(shot, tasks) {
  const result = completedVideoTaskForShot(tasks, shot.id)
  const resultUrl = result ? resultUrlForTask(result) : ''
  if (resultUrl && !isPlayableVideoUrl(resultUrl)) return resultUrl
  return shot.imageUrl || '/demo/station.jpg'
}

function clipDurationFor(draft, shot) {
  return Number(draft.clips[shot.id]?.duration || shot.duration || 4)
}

function subtitleForShot(draft, shot) {
  return String(draft.clips[shot.id]?.subtitle || shot.title || '').trim()
}

function formatClock(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(value / 60)
  const remainder = value % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}
