import { useState } from 'react'
import { ArrowRight, Check, Clapperboard, Clock3, Crown, LoaderCircle, Play, Zap } from 'lucide-react'
import { JobRow, PageHeader } from '../components/ui'

const filters = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['audio', '音频'],
]

export function GenerationPage({ jobs, concurrency, member, onUpgrade, onClear, onNext }) {
  const [filter, setFilter] = useState('all')
  const visibleJobs = filter === 'all' ? jobs : jobs.filter((job) => job.kind === filter)
  const active = jobs.filter((job) => job.status !== 'completed')

  return (
    <div className="page queue-page">
      <PageHeader
        eyebrow="第 4 步 · 生成队列"
        title="创作正在发生"
        description="任务由后端持续处理，刷新页面不会中断。"
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
            <p>免费版任务会依次执行，会员可同时处理 3 项。</p>
          </div>
          <button className="button dark" onClick={onUpgrade}>
            查看会员方案 <ArrowRight size={16} />
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
            {filters.map(([id, label]) => (
              <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="jobs-list">
          {visibleJobs.length ? (
            visibleJobs.map((job) => <JobRow job={toDisplayJob(job)} key={job.id} />)
          ) : (
            <div className="empty-state">
              <Clapperboard size={28} />
              <h3>当前分类没有任务</h3>
              <p>从资产或分镜页面开始生成。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function toDisplayJob(job) {
  const type = { text: '文本', image: '图片', video: '视频', audio: '音频' }[job.kind]
  return { ...job, type, cost: job.estimatedCredits }
}
