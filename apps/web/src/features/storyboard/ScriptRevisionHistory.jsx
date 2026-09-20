import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { taskOutputUrl } from './storyboardState'
import './scriptRevisionHistory.css'

export function scriptProductionHistoryEntries(scriptEpisodes = []) {
  return scriptEpisodes
    .flatMap((episode) => {
      const history = episode.continuityState?.scriptProductionHistory
      if (!Array.isArray(history)) return []
      return history
        .filter(
          (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            typeof entry.content === 'string' &&
            Array.isArray(entry.shots),
        )
        .map((entry) => ({
          ...entry,
          episodeNumber: episode.episodeNumber,
          episodeId: episode.id,
          shots: entry.shots.filter(
            (shot) => shot && typeof shot.id === 'string' && typeof shot.prompt === 'string',
          ),
        }))
    })
    .sort(
      (left, right) =>
        String(right.savedAt).localeCompare(String(left.savedAt)) || left.episodeNumber - right.episodeNumber,
    )
}

function mediaUrl(value) {
  return typeof value === 'string' && (/^https?:\/\//iu.test(value) || /^\/(?!\/)/u.test(value))
    ? value
    : null
}

// A reused shot may acquire new videos after this snapshot. Only the saved
// selection, or a task that already existed when it was saved, belongs here.
export function historicalShotMedia(shot, savedAt, tasks = []) {
  const cutoff = Date.parse(savedAt)
  const find = (kind) => {
    const selectedId = kind === 'image' ? shot.selectedImageTaskId : shot.selectedVideoTaskId
    const candidates = tasks.filter(
      (task) =>
        task.kind === kind &&
        task.status === 'completed' &&
        task.metadata?.shotId === shot.id &&
        (!shot.projectId || task.projectId === shot.projectId),
    )
    if (selectedId) return candidates.find((task) => task.id === selectedId)
    return candidates
      .filter((task) => {
        const createdAt = Date.parse(task.createdAt || task.updatedAt)
        return Number.isFinite(cutoff) && Number.isFinite(createdAt) && createdAt <= cutoff
      })
      .sort((left, right) =>
        String(right.createdAt || right.updatedAt).localeCompare(String(left.createdAt || left.updatedAt)),
      )[0]
  }
  return {
    imageUrl: mediaUrl(shot.imageUrl) || mediaUrl(taskOutputUrl(find('image'), 'image')),
    videoUrl: mediaUrl(taskOutputUrl(find('video'), 'video')),
    references: Array.isArray(shot.referenceImages)
      ? shot.referenceImages.filter((image) => image && mediaUrl(image.url))
      : [],
  }
}

export function ScriptRevisionHistory({ scriptEpisodes = [], tasks = [] }) {
  const entries = useMemo(() => scriptProductionHistoryEntries(scriptEpisodes), [scriptEpisodes])
  const [expanded, setExpanded] = useState(false)
  if (!entries.length) return null
  return (
    <details
      className="script-revision-history"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setExpanded(event.currentTarget.open)
      }}
    >
      <summary>
        <History size={17} aria-hidden="true" /> 制作修订历史 <span>{entries.length} 个旧版</span>
      </summary>
      {expanded && (
        <div className="script-revision-history-list">
          <p>这里保留返修前的正文、分镜和已有媒体，仅供查看。</p>
          {entries.map((entry) => (
            <HistoryEntry key={`${entry.episodeId}:${entry.id}`} entry={entry} tasks={tasks} />
          ))}
        </div>
      )}
    </details>
  )
}

function HistoryEntry({ entry, tasks }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <details
      className="script-revision-entry"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setExpanded(event.currentTarget.open)
      }}
    >
      <summary>
        <strong>
          第 {entry.episodeNumber} 集 · {typeof entry.title === 'string' ? entry.title : '旧版剧本'}
        </strong>
        <span>
          {formatTime(entry.savedAt)} · 修订前版本 {entry.episodeRevision}
        </span>
      </summary>
      {expanded && <ScriptRevisionSnapshot entry={entry} tasks={tasks} />}
    </details>
  )
}

export function ScriptRevisionSnapshot({ entry, tasks = [] }) {
  return (
    <div className="script-revision-snapshot">
      <details className="script-revision-body">
        <summary>查看旧正文</summary>
        <pre>{entry.content}</pre>
      </details>
      <h3>旧版分镜 · {entry.shots.length} 个</h3>
      <div className="script-revision-shots">
        {[...entry.shots]
          .sort((left, right) => left.order - right.order)
          .map((shot) => (
            <article className="script-revision-shot" key={shot.id}>
              <h4>{shot.title || `镜头 ${shot.order}`}</h4>
              <p>
                {shot.framing} · {shot.duration} 秒
              </p>
              <HistoryMedia shot={shot} savedAt={entry.savedAt} tasks={tasks} />
              <details>
                <summary>查看分镜内容</summary>
                <pre>{shot.prompt}</pre>
                {shot.continuityNote && <p>衔接说明：{shot.continuityNote}</p>}
              </details>
            </article>
          ))}
      </div>
    </div>
  )
}

function HistoryMedia({ shot, savedAt, tasks }) {
  const media = historicalShotMedia(shot, savedAt, tasks)
  const [failedImage, setFailedImage] = useState(false)
  const [failedVideo, setFailedVideo] = useState(false)
  return (
    <div className="script-revision-media">
      {media.imageUrl && !failedImage && (
        <img
          src={media.imageUrl}
          alt={`${shot.title}旧版画面`}
          loading="lazy"
          onError={() => setFailedImage(true)}
        />
      )}
      {media.videoUrl && !failedVideo && (
        <video
          src={media.videoUrl}
          controls
          playsInline
          preload="none"
          aria-label={`${shot.title}旧版视频`}
          onError={() => setFailedVideo(true)}
        />
      )}
      {(failedImage || failedVideo) && (
        <p role="status">部分历史媒体暂时无法加载，正文与分镜记录仍然保留。</p>
      )}
      {!media.imageUrl && !media.videoUrl && (
        <p className="script-revision-media-empty">此版本暂无可用的生成画面或视频</p>
      )}
      {!!media.references.length && (
        <details>
          <summary>查看原参考图 · {media.references.length} 张</summary>
          <div className="script-revision-references">
            {media.references.map((image, index) => (
              <a href={image.url} target="_blank" rel="noopener noreferrer" key={`${index}:${image.url}`}>
                <img
                  src={image.url}
                  loading="lazy"
                  alt={image.name || `${shot.title}原参考图 ${index + 1}`}
                />
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function formatTime(value) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) return '保存时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
