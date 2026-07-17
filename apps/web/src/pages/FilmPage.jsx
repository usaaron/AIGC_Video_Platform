import {
  Check,
  Download,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Zap,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { DEMO_SHOTS } from '../data/demoData'

export function FilmPage({ playing, setPlaying, currentShot, setCurrentShot, onExport }) {
  const shot = DEMO_SHOTS[currentShot]
  const totalDuration = DEMO_SHOTS.reduce((sum, item) => sum + item.duration, 0)
  const elapsed = DEMO_SHOTS.slice(0, currentShot).reduce((sum, item) => sum + item.duration, 0)

  return (
    <div className="page film-page">
      <PageHeader
        eyebrow="第 5 步 · 成片"
        title="《午夜胶片》预览"
        description="检查节奏与镜头，需要修改时可随时返回对应步骤。"
      >
        <button className="button secondary">
          <Save size={16} /> 保存版本
        </button>
        <button className="button primary" onClick={onExport}>
          <Download size={16} /> 导出项目包
        </button>
      </PageHeader>
      <div className="film-layout">
        <section className="player-panel">
          <div className="film-player">
            <img key={shot.id} src={shot.image} alt={shot.title} className="film-frame" />
            <div className="film-grade" />
            <div className="film-subtitle">
              {currentShot < 2
                ? '午夜十二点，三号站台。'
                : currentShot === 3
                  ? '你终于来了。'
                  : '这卷胶片拍下的是明天。'}
            </div>
            <button
              className="big-play"
              onClick={() => setPlaying((value) => !value)}
              aria-label={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
          </div>
          <div className="player-controls">
            <button onClick={() => setPlaying((value) => !value)}>
              {playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}
            </button>
            <span>00:{String(elapsed).padStart(2, '0')}</span>
            <div className="play-track">
              <span style={{ width: `${((currentShot + 1) / DEMO_SHOTS.length) * 100}%` }} />
            </div>
            <span>00:{totalDuration}</span>
            <button>
              <Settings size={16} />
            </button>
          </div>
        </section>
        <aside className="film-info">
          <span className="eyebrow">当前镜头</span>
          <h2>
            {shot.number} · {shot.title}
          </h2>
          <img src={shot.image} alt="当前镜头缩略图" />
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
                <Check size={13} /> 已生成
              </dd>
            </div>
          </dl>
          <button className="button secondary full">
            <RefreshCw size={15} /> 返回修改提示词
          </button>
        </aside>
      </div>
      <section className="timeline-panel">
        <div className="panel-head">
          <div>
            <h2>时间线</h2>
            <span>第一集 · {totalDuration} 秒</span>
          </div>
          <div className="timeline-tools">
            <button>
              <Search size={15} /> 适应窗口
            </button>
            <IconButton label="更多时间线操作">
              <MoreHorizontal size={17} />
            </IconButton>
          </div>
        </div>
        <div className="timeline-ruler">
          <span>00:00</span>
          <span>00:05</span>
          <span>00:10</span>
          <span>00:15</span>
          <span>00:20</span>
        </div>
        <div className="timeline-track">
          {DEMO_SHOTS.map((item, index) => (
            <button
              key={item.id}
              className={currentShot === index ? 'active' : ''}
              style={{ flex: item.duration }}
              onClick={() => setCurrentShot(index)}
            >
              <img src={item.image} alt="" />
              <span>{item.number}</span>
            </button>
          ))}
        </div>
        <div className="audio-track">
          <span>
            <Zap size={14} /> AI 环境音 · 雨夜站台
          </span>
          <div />
        </div>
      </section>
    </div>
  )
}
