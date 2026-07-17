import { ArrowRight, Check, Clapperboard, Clock3, Crown, LoaderCircle, Play, Zap } from 'lucide-react'
import { JobRow, PageHeader } from '../components/ui'

export function GenerationPage({ jobs, concurrency, member, setMember, onClear, onNext }) {
  const active = jobs.filter((job) => job.status !== 'completed')

  return (
    <div className="page queue-page">
      <PageHeader
        eyebrow="第 4 步 · 生成队列"
        title="创作正在发生"
        description="离开页面也不会中断任务，完成后会自动汇入成片。"
      >
        <button className="button secondary" onClick={onClear}>
          清理已完成
        </button>
        <button className="button primary" onClick={onNext}>
          预览成片 <Play size={15} fill="currentColor" />
        </button>
      </PageHeader>
      <div className="queue-stats">
        <div>
          <span className="stat-icon mint">
            <LoaderCircle size={19} />
          </span>
          <p>
            生成中<strong>{jobs.filter((job) => job.status === 'running').length}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon amber">
            <Clock3 size={19} />
          </span>
          <p>
            等待中<strong>{jobs.filter((job) => job.status === 'queued').length}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon blue">
            <Check size={19} />
          </span>
          <p>
            已完成<strong>{jobs.filter((job) => job.status === 'completed').length}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon coral">
            <Zap size={19} />
          </span>
          <p>
            当前并发<strong>{concurrency}</strong>
          </p>
        </div>
      </div>
      {!member && (
        <section className="upgrade-banner">
          <div className="upgrade-visual">
            <Crown size={24} />
          </div>
          <div>
            <span className="eyebrow">节省等待时间</span>
            <h2>开启 3 路并发生成</h2>
            <p>免费版会逐个处理任务；会员可同时生成角色、场景和视频。</p>
          </div>
          <button className="button dark" onClick={() => setMember(true)}>
            体验会员并发 <ArrowRight size={16} />
          </button>
        </section>
      )}
      <section className="queue-panel">
        <div className="panel-head">
          <div>
            <h2>全部任务</h2>
            <span>{active.length ? `${active.length} 项尚未完成` : '所有任务已完成'}</span>
          </div>
          <div className="queue-filter">
            <button className="active">全部</button>
            <button>图片</button>
            <button>视频</button>
          </div>
        </div>
        <div className="jobs-list">
          {jobs.length ? (
            jobs.map((job) => <JobRow job={job} key={job.id} />)
          ) : (
            <div className="empty-state">
              <Clapperboard size={28} />
              <h3>暂无生成任务</h3>
              <p>从分镜页面选择镜头开始生成。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
