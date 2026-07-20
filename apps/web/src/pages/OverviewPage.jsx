import {
  ArrowRight,
  BookOpenText,
  Check,
  Clapperboard,
  Film,
  Layers3,
  PackageOpen,
  Plus,
  WandSparkles,
} from 'lucide-react'
import { PageHeader, StatusDot } from '../components/ui'
import { resultUrlForTask } from '../features/generation/taskResults'

export function OverviewPage({ project, assets, shots, jobs, billing, setActiveStep, setNewProjectOpen }) {
  const steps = buildOverviewSteps({ project, assets, shots, jobs })
  const completedSteps = steps.filter((step) => step.done).length
  const progress = Math.round((completedSteps / steps.length) * 100)
  const nextStep = steps.find((step) => !step.done) || steps.at(-1)
  const recentResults = jobs
    .filter((job) => job.status === 'completed' && resultUrlForTask(job))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 4)

  return (
    <div className="page overview-page">
      <PageHeader
        eyebrow="总览"
        title={`《${project.name}》当前项目进度`}
        description="只看当前做到哪一步、下一步做什么、最近生成了什么。"
      >
        <button className="button secondary" onClick={() => setNewProjectOpen(true)}>
          <Plus size={16} /> 新建项目
        </button>
        <button className="button primary" onClick={() => setActiveStep(nextStep.id)}>
          下一步：{nextStep.title} <ArrowRight size={16} />
        </button>
      </PageHeader>

      <section className="overview-focus">
        <div className="overview-progress-panel">
          <div className="overview-meta">
            <span className="live-chip">
              <StatusDot status={jobs.some((job) => job.status === 'running') ? 'running' : 'completed'} />
              {project.status === 'producing' ? '制作中' : '草稿'}
            </span>
            <span>{project.aspectRatio}</span>
            <span>{billing.credits} 积分</span>
          </div>
          <div className="overview-progress-title">
            <div>
              <span>整体进度</span>
              <strong>{progress}%</strong>
            </div>
            <div className="project-progress">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="overview-progress-list">
            {steps.map((step) => {
              const Icon = step.icon
              return (
                <button
                  key={step.id}
                  className={step.id === nextStep.id && !step.done ? 'current' : step.done ? 'done' : ''}
                  onClick={() => setActiveStep(step.id)}
                >
                  <span>{step.done ? <Check size={13} /> : step.number}</span>
                  <Icon size={16} />
                  <strong>{step.title}</strong>
                  <small>{step.status}</small>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="overview-next-panel">
          <span>下一步</span>
          <h3>{nextStep.title}</h3>
          <p>{nextStep.action}</p>
          <button className="button primary" onClick={() => setActiveStep(nextStep.id)}>
            继续处理 <ArrowRight size={16} />
          </button>
        </aside>
      </section>

      <section className="recent-results-panel">
        <div className="panel-head">
          <div>
            <h2>最近结果</h2>
            <span>{recentResults.length ? '可直接查看生成结果' : '完成生成后会显示在这里'}</span>
          </div>
        </div>
        {recentResults.length ? (
          <div className="recent-results-grid">
            {recentResults.map((job) => (
              <ResultCard job={job} key={job.id} />
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <Film size={26} />
            <h3>还没有生成结果</h3>
            <p>从资产或分镜页提交任务后，这里会展示最近完成的结果。</p>
          </div>
        )}
      </section>
    </div>
  )
}

function ResultCard({ job }) {
  const resultUrl = resultUrlForTask(job)
  const isImageLike = job.kind === 'image' || !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(resultUrl)

  return (
    <article className="recent-result-card">
      <div>
        {isImageLike ? <img src={resultUrl} alt={job.label} /> : <video src={resultUrl} muted playsInline />}
      </div>
      <span>{typeLabel(job.kind)}</span>
      <h3>{job.label}</h3>
      <a href={resultUrl}>查看结果</a>
    </article>
  )
}

function buildOverviewSteps({ project, assets, shots, jobs }) {
  const completedJobs = jobs.filter((job) => job.status === 'completed').length
  return [
    {
      id: 'script',
      number: '01',
      title: '剧本',
      icon: BookOpenText,
      done: Boolean(project.script?.trim()),
      status: project.script ? '已输入' : '待输入',
      action: '先输入剧本，保存后拆分成镜头。',
    },
    {
      id: 'assets',
      number: '02',
      title: '资产',
      icon: PackageOpen,
      done: assets.length > 0,
      status: `${assets.length} 项`,
      action: '补齐角色、场景、服装和音频；道具只建关键或多次出现的。',
    },
    {
      id: 'storyboard',
      number: '03',
      title: '分镜',
      icon: Layers3,
      done: shots.length > 0,
      status: `${shots.length} 镜头`,
      action: '确认镜头列表、时长和画面提示词。',
    },
    {
      id: 'generate',
      number: '04',
      title: '生成',
      icon: WandSparkles,
      done: completedJobs > 0,
      status: `${completedJobs} 完成`,
      action: '查看任务状态，处理失败任务并进入结果。',
    },
    {
      id: 'film',
      number: '05',
      title: '成片',
      icon: Clapperboard,
      done: project.status === 'completed',
      status: shots.length ? '可预览' : '待分镜',
      action: '预览当前成片并导出项目包。',
    },
  ]
}

function typeLabel(kind) {
  return { image: '图片', video: '视频', audio: '音频', text: '文本' }[kind] || kind
}
