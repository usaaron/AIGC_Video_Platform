import { ArrowRight, BadgeCheck, Check, Crown, Play, Plus } from 'lucide-react'
import { JobRow, PageHeader, StatusDot } from '../components/ui'

export function OverviewPage({ projectName, setActiveStep, runningJobs, jobs, member, setNewProjectOpen }) {
  const completed = jobs.filter((job) => job.status === 'completed').length

  return (
    <div className="page overview-page">
      <PageHeader
        eyebrow="项目工作台"
        title={`继续创作《${projectName}》`}
        description="所有素材和生成任务都在一个流程里，继续上次停下的位置。"
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
              <StatusDot status="running" /> 制作中
            </span>
            <span>竖屏短剧 · 约 2 分钟</span>
          </div>
          <h2>雨夜，一卷能预见明天的胶片，正等待被打开。</h2>
          <div className="progress-row">
            <div>
              <span>项目进度</span>
              <strong>68%</strong>
            </div>
            <div className="project-progress">
              <span />
            </div>
          </div>
          <div className="hero-stats">
            <div>
              <strong>2</strong>
              <span>角色</span>
            </div>
            <div>
              <strong>5</strong>
              <span>分镜</span>
            </div>
            <div>
              <strong>22s</strong>
              <span>预计时长</span>
            </div>
            <div>
              <strong>{completed}</strong>
              <span>已生成</span>
            </div>
          </div>
        </div>
        <button className="hero-preview" onClick={() => setActiveStep('film')} aria-label="预览成片">
          <img src="/demo/station.jpg" alt="雨夜车站影片预览" />
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
          <BadgeCheck size={15} /> 已自动保存
        </span>
      </div>
      <div className="workflow-grid">
        {[
          ['01', '剧本', '已完成', '完成故事梗概与对白', 'script', 'complete'],
          ['02', '角色资产', '1 项待确认', '确认周野的角色形象', 'assets', 'current'],
          ['03', '分镜', '5 / 5', '检查镜头与提示词', 'storyboard', 'complete'],
          [
            '04',
            '视频生成',
            runningJobs.length ? `${runningJobs.length} 项进行中` : '可开始',
            member ? '会员并发生成已开启' : '逐个生成，会员可并发',
            'generate',
            'pending',
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
              <JobRow key={job.id} job={job} compact />
            ))}
          </div>
        </section>
        <section className="membership-panel">
          <div className="membership-icon">
            <Crown size={19} />
          </div>
          <div>
            <span className="eyebrow">{member ? '创作会员已开启' : '加速你的创作'}</span>
            <h2>{member ? '3 路任务并发中' : '批量生成，不必逐个等待'}</h2>
            <p>
              {member
                ? '当前项目已获得会员并发与批量生成权限。'
                : '会员可同时生成角色、场景和视频，项目交付更快。'}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
