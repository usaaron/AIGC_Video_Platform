import { useState } from 'react'
import { ArrowRight, Clock3, Film, MoreHorizontal, RefreshCw, Sparkles } from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { DEMO_SHOTS } from '../data/demoData'

export function StoryboardPage({ onGenerate, onNext }) {
  const [selected, setSelected] = useState(2)

  return (
    <div className="page storyboard-page">
      <PageHeader
        eyebrow="第 3 步 · 分镜"
        title="一眼看清整段影片"
        description="AI 已拆分出 5 个镜头，可以调整顺序、画面和时长。"
      >
        <button className="button secondary">
          <RefreshCw size={16} /> 重新拆分
        </button>
        <button className="button primary" onClick={() => DEMO_SHOTS.forEach(onGenerate)}>
          <Sparkles size={16} /> 生成全部镜头
        </button>
      </PageHeader>
      <div className="storyboard-summary">
        <span>
          <Film size={16} /> 第一集 · 午夜来信
        </span>
        <div>
          <span>5 个镜头</span>
          <span>22 秒</span>
          <span>9:16</span>
        </div>
      </div>
      <div className="shot-list">
        {DEMO_SHOTS.map((shot) => (
          <article
            className={`shot-row ${selected === shot.id ? 'selected' : ''}`}
            key={shot.id}
            onClick={() => setSelected(shot.id)}
          >
            <div className="shot-number">{shot.number}</div>
            <div className="shot-thumb">
              <img src={shot.image} alt={shot.title} />
              <span>{shot.framing}</span>
            </div>
            <div className="shot-content">
              <div>
                <h3>{shot.title}</h3>
                <span>
                  <Clock3 size={13} /> {shot.duration} 秒
                </span>
              </div>
              <p>{shot.prompt}</p>
              <div className="shot-tags">
                <span>电影感</span>
                <span>冷色调</span>
                <span>缓慢运镜</span>
              </div>
            </div>
            <div className="shot-actions">
              <IconButton
                label="生成此镜头"
                onClick={(event) => {
                  event.stopPropagation()
                  onGenerate(shot)
                }}
              >
                <Sparkles size={17} />
              </IconButton>
              <IconButton label="更多操作">
                <MoreHorizontal size={18} />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
      <div className="sticky-actions">
        <span>预计消耗 90 积分，生成时间约 4 分钟。</span>
        <button className="button primary" onClick={onNext}>
          查看生成队列 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
