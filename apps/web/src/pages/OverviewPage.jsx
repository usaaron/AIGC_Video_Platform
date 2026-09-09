import {
  ArrowRight,
  Check,
  Clapperboard,
  Clock3,
  FileText,
  Layers3,
  LoaderCircle,
  Pencil,
  UsersRound,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { normalizedVideoDuration } from '@seqora/prompting'
import { IconButton, JobRow, PageHeader } from '../components/ui'
import { getAssetPreviewUrl } from '../features/assets/assetPreview'
import { getWorkflowGuide } from '../features/workspace/workflowGuide'

export function OverviewPage({ project, assets, shots, jobs, billing, setActiveStep, onUpdateSynopsis }) {
  const [editingSynopsis, setEditingSynopsis] = useState(false)
  const guide = getWorkflowGuide({ project, assets, shots, tasks: jobs })
  const visibleJobs = jobs.filter((job) => !job.metadata?.queueHiddenAt)
  const totalDuration = shots.reduce(
    (sum, shot) =>
      sum + normalizedVideoDuration(shot.duration, project.contentType === 'short-drama' ? 3 : 4),
    0,
  )
  const stages = [
    {
      id: 'script',
      title: '故事剧本',
      detail: project.script ? '故事已保存，随时可以继续精修' : '从人物、冲突与想法开始',
      icon: FileText,
    },
    {
      id: 'assets',
      title: '人物与场景',
      detail: `${assets.filter((asset) => asset.kind !== 'audio').length} 项视觉资产`,
      icon: UsersRound,
    },
    {
      id: 'storyboard',
      title: '镜头设计',
      detail: `${shots.length} 个镜头 · 预计 ${totalDuration} 秒`,
      icon: Layers3,
    },
    {
      id: 'film',
      title: '影片制作',
      detail: guide.ready.film
        ? '成片已就绪，可以预览与下载'
        : guide.ready.generate
          ? '镜头已就绪，可以合成预览'
          : '镜头确认后生成视频',
      icon: Clapperboard,
    },
  ]
  const visualAssets = assets.filter((asset) => asset.kind !== 'audio')
  const imageForShot = (shot) => shot.imageUrl || null
  return (
    <div className="page overview-page studio-overview">
      <PageHeader
        eyebrow="项目概览"
        title={project.name}
        description={`${project.contentType === 'short-drama' ? '网剧' : project.contentType === 'advertisement' ? '广告' : '短片'} · ${project.aspectRatio} · ${visualStyleLabel(project.visualStyle)}`}
      >
        <button className="button secondary" onClick={() => setEditingSynopsis(true)}>
          <Pencil size={15} /> 编辑简介
        </button>
        <button className="button primary" onClick={() => setActiveStep(guide.step)}>
          {guide.action}
          <ArrowRight size={16} />
        </button>
      </PageHeader>
      <section className={`overview-next-action ${guide.tone}`} aria-label="项目下一步">
        <span className="overview-next-index">下一步</span>
        <div>
          <h2>{guide.title}</h2>
          <p>{guide.detail}</p>
        </div>
        <ArrowRight size={22} />
      </section>
      <section className="overview-story" aria-label="故事简介">
        <span>故事简介</span>
        <p>{project.synopsis || '写下一句话，描述你的主角、目标与故事冲突。'}</p>
        <IconButton label="编辑故事简介" onClick={() => setEditingSynopsis(true)}>
          <Pencil size={15} />
        </IconButton>
      </section>
      <div className="overview-workspace-grid">
        <section className="overview-production">
          <div className="overview-section-title">
            <h2>制作清单</h2>
            <span>按阶段完成，也可随时返回修改</span>
          </div>
          <div className="overview-stage-list">
            {stages.map((stage, index) => {
              const Icon = stage.icon
              const complete = guide.ready[stage.id]
              return (
                <button key={stage.id} onClick={() => setActiveStep(stage.id)}>
                  <span className={`overview-stage-number ${complete ? 'complete' : ''}`}>
                    {complete ? <Check size={15} /> : `0${index + 1}`}
                  </span>
                  <Icon size={19} />
                  <span>
                    <strong>{stage.title}</strong>
                    <small>{stage.detail}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              )
            })}
          </div>
        </section>
        <section className="overview-summary">
          <div className="overview-section-title">
            <h2>项目一览</h2>
          </div>
          <dl>
            <div>
              <dt>角色</dt>
              <dd>
                {assets.filter((asset) => asset.kind === 'character').length}
                <small>位</small>
              </dd>
            </div>
            <div>
              <dt>视觉资产</dt>
              <dd>
                {visualAssets.length}
                <small>项</small>
              </dd>
            </div>
            <div>
              <dt>分镜</dt>
              <dd>
                {shots.length}
                <small>个</small>
              </dd>
            </div>
            <div>
              <dt>预计片长</dt>
              <dd>
                {totalDuration}
                <small>秒</small>
              </dd>
            </div>
          </dl>
          <div className="overview-allowance">
            <Clock3 size={14} />
            <span>{billing.concurrency} 路并发</span>
            <span>{billing.credits} 可用积分</span>
          </div>
        </section>
      </div>
      <section className="overview-shot-section">
        <div className="overview-section-title">
          <h2>镜头预览</h2>
          <button onClick={() => setActiveStep('storyboard')}>
            查看分镜
            <ArrowRight size={14} />
          </button>
        </div>
        {shots.length ? (
          <div className="overview-shot-strip">
            {shots.slice(0, 5).map((shot, index) => (
              <button key={shot.id} onClick={() => setActiveStep('storyboard')}>
                <div>
                  {imageForShot(shot) ? (
                    <img src={imageForShot(shot)} alt={shot.title} />
                  ) : (
                    <Clapperboard size={24} />
                  )}
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <strong>{shot.title}</strong>
                <small>
                  {shot.duration} 秒 · {shot.framing}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="overview-empty">
            <Layers3 size={24} />
            <span>完成剧本后，在这里安排故事的每个镜头。</span>
            <button className="button secondary" onClick={() => setActiveStep('storyboard')}>
              前往分镜
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </section>
      {visualAssets.length > 0 && (
        <section className="overview-asset-section">
          <div className="overview-section-title">
            <h2>项目资产</h2>
            <button onClick={() => setActiveStep('assets')}>
              管理资产
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="overview-asset-strip">
            {visualAssets.slice(0, 8).map((asset) => {
              const image = getAssetPreviewUrl(asset, jobs)
              return (
                <button key={asset.id} onClick={() => setActiveStep('assets')}>
                  <span>{image ? <img src={image} alt={asset.name} /> : <UsersRound size={20} />}</span>
                  <strong>{asset.name}</strong>
                  <small>{asset.status === 'confirmed' ? '已确认' : '待确认'}</small>
                </button>
              )
            })}
          </div>
        </section>
      )}
      <section className="overview-recent">
        <div className="overview-section-title">
          <h2>最近任务</h2>
          <button onClick={() => setActiveStep('generate')}>
            全部任务
            <ArrowRight size={14} />
          </button>
        </div>
        {visibleJobs.slice(0, 4).map((job) => (
          <JobRow
            key={job.id}
            job={{
              ...job,
              type: { text: '文本', image: '图片', video: '视频', audio: '音频' }[job.kind],
              cost: job.estimatedCredits,
            }}
            compact
            onPreviewResult={() => setActiveStep(job.kind === 'video' ? 'film' : 'assets')}
          />
        ))}
        {!visibleJobs.length && <p className="overview-no-jobs">开始生成后，任务进度会出现在这里。</p>}
      </section>
      {editingSynopsis && (
        <SynopsisEditor
          value={project.synopsis}
          onClose={() => setEditingSynopsis(false)}
          onSave={async (value) => {
            await onUpdateSynopsis(value)
            setEditingSynopsis(false)
          }}
        />
      )}
    </div>
  )
}

function visualStyleLabel(value) {
  return (
    {
      photorealistic: '仿真人',
      'cinematic-cg': '电影 CG',
      'chinese-2d': '2D 风格',
      'chinese-3d': '国风 3D',
      anime: '动漫',
      storybook: '绘本',
    }[value] || '电影 CG'
  )
}

function SynopsisEditor({ value, onClose, onSave }) {
  const [synopsis, setSynopsis] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal synopsis-editor"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault()
          setSaving(true)
          setError('')
          try {
            await onSave(synopsis.trim())
          } catch (failure) {
            setError(failure.message)
          } finally {
            setSaving(false)
          }
        }}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">项目概览</span>
            <h2>编辑故事简介</h2>
          </div>
          <IconButton label="关闭" type="button" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        <p className="modal-description">主角是谁，想要什么，又遇到了什么阻碍？</p>
        <textarea
          className="synopsis-textarea"
          aria-label="故事简介"
          value={synopsis}
          maxLength={1000}
          onChange={(event) => setSynopsis(event.target.value)}
          autoFocus
        />
        <div className="synopsis-counter">{synopsis.length}/1000</div>
        {error && (
          <p className="asset-save-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={saving || !synopsis.trim()}>
            {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
            {saving ? '保存中' : '保存简介'}
          </button>
        </div>
      </form>
    </div>
  )
}
