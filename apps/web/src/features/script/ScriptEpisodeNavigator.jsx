import { ChevronLeft, ChevronRight, Eraser, Layers3, Trash2 } from 'lucide-react'

export function ScriptEpisodeNavigator({
  orderedEpisodes,
  activeEpisode,
  activeEpisodeId,
  busy,
  onOpenEpisode,
  onDeleteLastEpisode,
  onClearAllEpisodes,
}) {
  const latestEpisode = orderedEpisodes.at(-1) || null
  const activeEpisodeIndex = activeEpisode
    ? orderedEpisodes.findIndex((episode) => episode.id === activeEpisode.id)
    : -1
  const previousEpisode = activeEpisode ? orderedEpisodes[activeEpisodeIndex - 1] : latestEpisode
  const nextEpisode = activeEpisode ? orderedEpisodes[activeEpisodeIndex + 1] : null

  return (
    <nav className="script-episode-navigator" aria-label="剧集导航">
      <div className="script-episode-navigator-summary">
        <span className="script-episode-navigator-icon">
          <Layers3 size={17} />
        </span>
        <span>
          <small>剧集</small>
          <strong>{activeEpisode?.title || `已保存 ${orderedEpisodes.length} 集`}</strong>
        </span>
      </div>
      <div className="script-episode-navigator-controls">
        <button
          type="button"
          className="script-episode-nav-button"
          title="上一集"
          aria-label="打开上一集"
          disabled={busy || !previousEpisode}
          onClick={() => onOpenEpisode(previousEpisode)}
        >
          <ChevronLeft size={16} />
        </button>
        <select
          value={activeEpisodeId || ''}
          aria-label="选择要编辑的剧集"
          disabled={busy}
          onChange={(event) => {
            const episode = orderedEpisodes.find((item) => item.id === event.target.value)
            if (episode) onOpenEpisode(episode)
          }}
        >
          <option value="" disabled>
            选择剧集
          </option>
          {orderedEpisodes.map((episode) => {
            const source = episode.draftContent || episode.content
            return (
              <option key={episode.id} value={episode.id}>
                第 {episode.episodeNumber} 集 · {source.replace(/\s/g, '').length} 字 ·{' '}
                {episode.status === 'draft' ? '待保存' : '已保存'}
              </option>
            )
          })}
        </select>
        <button
          type="button"
          className="script-episode-nav-button"
          title="下一集"
          aria-label="打开下一集"
          disabled={busy || !nextEpisode}
          onClick={() => onOpenEpisode(nextEpisode)}
        >
          <ChevronRight size={16} />
        </button>
        {activeEpisode?.id === latestEpisode?.id && (
          <button
            type="button"
            className="script-episode-nav-button danger"
            title="删除最后一集"
            aria-label={`删除${activeEpisode.title}`}
            disabled={busy}
            onClick={() => void onDeleteLastEpisode(activeEpisode)}
          >
            <Trash2 size={15} />
          </button>
        )}
        <button
          type="button"
          className="script-episode-nav-button danger"
          title="清空全部剧集"
          aria-label="清空全部剧集"
          disabled={busy}
          onClick={() => void onClearAllEpisodes()}
        >
          <Eraser size={15} />
          <span className="script-episode-clear-label">清空</span>
        </button>
      </div>
    </nav>
  )
}
