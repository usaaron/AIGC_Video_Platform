import { useState } from 'react'
import { ArrowRight, Check, Clapperboard, Clock3, Crown, Info, LoaderCircle, Play, Zap } from 'lucide-react'
import { JobRow, PageHeader } from '../components/ui'

const filters = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['audio', '音频'],
]

export function GenerationPage({
  jobs,
  concurrency,
  member,
  onUpgrade,
  onPause,
  onResume,
  onDelete,
  onClear,
  onNext,
}) {
  const [filter, setFilter] = useState('all')
  const [busyTaskId, setBusyTaskId] = useState(null)
  const queueJobs = jobs.filter((job) => typeof job.metadata?.queueHiddenAt !== 'string')
  const visibleJobs = filter === 'all' ? queueJobs : queueJobs.filter((job) => job.kind === filter)
  const active = queueJobs.filter((job) => ['queued', 'paused', 'running'].includes(job.status))
  const running = queueJobs.filter((job) => job.status === 'running' && job.provider !== 'local-compose')
  const hasTerminalJobs = queueJobs.some((job) => ['completed', 'failed', 'cancelled'].includes(job.status))

  const runTaskAction = async (taskId, action) => {
    if (busyTaskId) return
    setBusyTaskId(taskId)
    try {
      await action(taskId)
    } finally {
      setBusyTaskId(null)
    }
  }

  return (
    <div className="page queue-page">
      <PageHeader
        eyebrow="第 4 步 · 生成队列"
        title="创作正在发生"
        description="任务由后端持续处理，刷新页面不会中断。"
      >
        <button className="button secondary" onClick={onClear} disabled={!hasTerminalJobs}>
          归档已结束
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
            生成中<strong>{running.length}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon amber">
            <Clock3 size={19} />
          </span>
          <p>
            等待 / 暂停
            <strong>
              {queueJobs.filter((job) => job.status === 'queued').length} /{' '}
              {queueJobs.filter((job) => job.status === 'paused').length}
            </strong>
          </p>
        </div>
        <div>
          <span className="stat-icon blue">
            <Check size={19} />
          </span>
          <p>
            已完成<strong>{queueJobs.filter((job) => job.status === 'completed').length}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon coral">
            <Zap size={19} />
          </span>
          <p>
            并发占用
            <strong>
              {running.length} / {concurrency}
            </strong>
          </p>
        </div>
      </div>
      <section className="queue-policy" aria-label="队列处理规则">
        <Info size={17} />
        <div>
          <strong>队列处理规则</strong>
          <span>
            等待中的任务可以暂停、继续或删除并自动退款；弦序视频生成中可真实取消，其他第三方运行中不可伪暂停，失败会自动退款。
          </span>
        </div>
      </section>
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
            visibleJobs.map((job) => (
              <JobRow
                job={toDisplayJob(job)}
                key={job.id}
                busy={busyTaskId === job.id}
                onPause={() => runTaskAction(job.id, onPause)}
                onResume={() => runTaskAction(job.id, onResume)}
                onDelete={() => runTaskAction(job.id, onDelete)}
              />
            ))
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
