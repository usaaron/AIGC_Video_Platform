import { ArrowRight, BadgeCheck, Check, Crown, Play, Plus } from 'lucide-react'
import { JobRow, PageHeader, StatusDot } from '../components/ui'

export function OverviewPage({ project, assets, shots, jobs, billing, setActiveStep, setNewProjectOpen }) {
  const completed = jobs.filter((job) => job.status === 'completed').length
  const running = jobs.filter((job) => job.status === 'running')
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0)
  const progress = Math.min(
    100,
    Math.round(
      (Number(Boolean(project.script)) +
        Number(assets.length > 0) +
        Number(shots.length > 0) +
        Number(completed > 0)) *
        25,
    ),
  )

  return (
    <div className="page overview-page">
      <PageHeader
        eyebrow="项目工作台"
        title={`继续创作《${project.name}》`}
        description="项目、素材和生成任务都已同步到你的账号。"
      >
        <button className="button secondary" onClick={() => setNewProjectOpen(true)}>
          <Plus size={16} /> 新建项目
        </button>
        <button className="button primary" onClick={() => setActiveStep('script')}>
          继续创作 <ArrowRight size={16} />
        </button>
      </PageHeader>
      <section className="project-hero">
        <div className="hero-copy">
          <div className="hero-meta">
            <span className="live-chip">
              <StatusDot status="running" /> {project.status === 'producing' ? '制作中' : '草稿'}
            </span>
            <span>
              {project.aspectRatio} · {project.contentType === 'short-drama' ? '短剧' : '视频项目'}
            </span>
          </div>
          <h2>{project.synopsis || '为这个项目写下一句清晰的故事简介。'}</h2>
          <div className="progress-row">
            <div>
              <span>项目进度</span>
              <strong>{progress}%</strong>
            </div>
            <div className="project-progress">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="hero-stats">
            <div>
              <strong>{assets.filter((asset) => asset.kind === 'character').length}</strong>
              <span>角色</span>
            </div>
            <div>
              <strong>{shots.length}</strong>
              <span>分镜</span>
            </div>
            <div>
              <strong>{totalDuration}s</strong>
              <span>预计时长</span>
            </div>
            <div>
              <strong>{completed}</strong>
              <span>已生成</span>
            </div>
          </div>
        </div>
        <button className="hero-preview" onClick={() => setActiveStep('film')} aria-label="预览成片">
          <img src={shots[0]?.imageUrl || '/demo/station.jpg'} alt="项目预览" />
          <span className="preview-play">
            <Play size={21} fill="currentColor" />
          </span>
          <span className="preview-caption">
            预览当前成片 <ArrowRight size={14} />
          </span>
        </button>
      </section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">制作流程</span>
          <h2>接下来要做什么</h2>
        </div>
        <span className="autosave">
          <BadgeCheck size={15} /> 数据已同步
        </span>
      </div>
      <div className="workflow-grid">
        {[
          [
            '01',
            '剧本',
            project.script ? '已保存' : '待填写',
            '完成故事内容与对白',
            'script',
            project.script ? 'complete' : 'current',
          ],
          [
            '02',
            '角色资产',
            `${assets.length} 项`,
            '确认人物、场景与声音',
            'assets',
            assets.length ? 'complete' : 'pending',
          ],
          [
            '03',
            '分镜',
            `${shots.length} 个`,
            '检查镜头与提示词',
            'storyboard',
            shots.length ? 'complete' : 'pending',
          ],
          [
            '04',
            '视频生成',
            running.length ? `${running.length} 项进行中` : `${completed} 项完成`,
            `当前可并发 ${billing.concurrency} 项`,
            'generate',
            running.length ? 'current' : 'pending',
          ],
        ].map(([number, title, status, description, id, state]) => (
          <button className={`workflow-card ${state}`} key={id} onClick={() => setActiveStep(id)}>
            <div className="workflow-top">
              <span>{number}</span>
              {state === 'complete' ? <Check size={16} /> : <ArrowRight size={16} />}
            </div>
            <h3>{title}</h3>
            <p>{description}</p>
            <span className="workflow-status">{status}</span>
          </button>
        ))}
      </div>
      <div className="two-column">
        <section className="activity-panel">
          <div className="panel-head">
            <h2>最近生成</h2>
            <button onClick={() => setActiveStep('generate')}>查看全部</button>
          </div>
          <div className="activity-list">
            {jobs.slice(0, 3).map((job) => (
              <JobRow key={job.id} job={toDisplayJob(job)} compact />
            ))}
            {!jobs.length && <p className="panel-empty">还没有生成任务。</p>}
          </div>
        </section>
        <section className="membership-panel">
          <div className="membership-icon">
            <Crown size={19} />
          </div>
          <div>
            <span className="eyebrow">{billing.plan === 'member' ? '创作会员' : '免费版'}</span>
            <h2>{billing.concurrency} 路任务并发</h2>
            <p>可用 {billing.credits} 积分，所有消耗都记录在积分账单。</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function toDisplayJob(job) {
  const type = { text: '文本', image: '图片', video: '视频', audio: '音频' }[job.kind]
  return { ...job, type, cost: job.estimatedCredits }
}
