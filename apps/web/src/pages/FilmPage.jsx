import { Check, Download, Pause, Play, RefreshCw, Save, Zap } from 'lucide-react'
import { PageHeader } from '../components/ui'

export function FilmPage({
  project,
  shots,
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
        description="检查镜头顺序与节奏，保存版本后可以继续修改。"
      >
        <button className="button secondary" onClick={onSave}>
          <Save size={16} /> 保存版本
        </button>
        <button className="button primary" onClick={onExport}>
          <Download size={16} /> 导出项目包
        </button>
      </PageHeader>
      <div className="film-layout">
        <section className="player-panel">
          <div className="film-player">
            <img
              key={shot.id}
              src={shot.imageUrl || '/demo/station.jpg'}
              alt={shot.title}
              className="film-frame"
            />
            <div className="film-grade" />
            <div className="film-subtitle">{shot.prompt}</div>
            <button
              className="big-play"
              onClick={() => setPlaying((value) => !value)}
              aria-label={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
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
          <img src={shot.imageUrl || '/demo/station.jpg'} alt="当前镜头缩略图" />
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
              <dd className="good">
                <Check size={13} /> 可预览
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
            <span>第一集 · {totalDuration} 秒</span>
          </div>
        </div>
        <div className="timeline-ruler">
          <span>00:00</span>
          <span>00:{Math.round(totalDuration / 4)}</span>
          <span>00:{Math.round(totalDuration / 2)}</span>
          <span>00:{totalDuration}</span>
        </div>
        <div className="timeline-track">
          {shots.map((item, index) => (
            <button
              key={item.id}
              className={safeIndex === index ? 'active' : ''}
              style={{ flex: item.duration }}
              onClick={() => setCurrentShot(index)}
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
