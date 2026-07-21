import { useState } from 'react'
import {
  AlertCircle,
  Check,
  Clapperboard,
  Clock3,
  Download,
  LoaderCircle,
  Play,
  RotateCcw,
  Video,
  X,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { downloadNameForTask, isPlayableVideoUrl, resultUrlForTask } from '../features/generation/taskResults'

const statusLabels = {
  queued: '等待中',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function GenerationPage({ jobs, onClear, onRetry, onRerun, onCancel, onNext, pollError, syncMode }) {
  const [previewJob, setPreviewJob] = useState(null)
  const [retryingId, setRetryingId] = useState('')
  const [rerunningId, setRerunningId] = useState('')
  const [cancellingId, setCancellingId] = useState('')
  const [actionError, setActionError] = useState('')
  const runningCount = jobs.filter((job) => job.status === 'running').length
  const queuedCount = jobs.filter((job) => job.status === 'queued').length
  const completedCount = jobs.filter((job) => job.status === 'completed').length
  const failedCount = jobs.filter((job) => job.status === 'failed').length
  const cancelledCount = jobs.filter((job) => job.status === 'cancelled').length
  const activeCount = runningCount + queuedCount
  const lastUpdatedAt = latestUpdatedAt(jobs)

  const handleRetry = async (job) => {
    if (!onRetry) return
    setRetryingId(job.id)
    setActionError('')
    try {
      await onRetry(job)
    } catch (error) {
      setActionError(error.message || '重试失败，请稍后再试')
    } finally {
      setRetryingId('')
    }
  }

  const handleCancel = async (job) => {
    if (!onCancel) return
    setCancellingId(job.id)
    setActionError('')
    try {
      await onCancel(job)
    } catch (error) {
      setActionError(error.message || '取消失败，请稍后再试')
    } finally {
      setCancellingId('')
    }
  }

  const handleRerun = async (job) => {
    if (!onRerun) return
    setRerunningId(job.id)
    setActionError('')
    try {
      await onRerun(job)
    } catch (error) {
      setActionError(error.message || '重生失败，请稍后再试')
    } finally {
      setRerunningId('')
    }
  }

  return (
    <div className="page queue-page">
      <PageHeader
        eyebrow="第 4 步 · 生成"
        title="任务状态"
        description="查看排队、轮询、失败原因和结果入口；单个任务可取消或重试。"
      >
        <button className="button secondary" onClick={onClear}>
          清理已结束
        </button>
        <button className="button primary" onClick={onNext}>
          预览成片 <Play size={15} fill="currentColor" />
        </button>
      </PageHeader>
      <div className="queue-status-summary">
        <span>生成中 {runningCount}</span>
        <span>等待中 {queuedCount}</span>
        <span>已完成 {completedCount}</span>
        <span className={failedCount ? 'bad' : ''}>失败 {failedCount}</span>
        <span>已取消 {cancelledCount}</span>
      </div>
      {(pollError || actionError) && (
        <div className="queue-alert" role="status">
          <AlertCircle size={15} />
          <span>{actionError || pollError}</span>
        </div>
      )}
      <section className="queue-panel">
        <div className="panel-head queue-panel-head">
          <div>
            <h2>任务列表</h2>
            <span>{queueSummary(activeCount, failedCount, cancelledCount)}</span>
          </div>
          <div className="queue-panel-tools">
            <span className={`queue-sync ${pollError ? 'failed' : ''}`}>
              {pollError
                ? '状态同步失败'
                : `${syncMode || '自动轮询'} · 最近同步 ${formatTime(lastUpdatedAt)}`}
            </span>
          </div>
        </div>
        <div className="jobs-list">
          {jobs.length ? (
            jobs.map((job) => (
              <GenerationJobRow
                job={job}
                key={job.id}
                isRetrying={retryingId === job.id}
                isRerunning={rerunningId === job.id}
                isCancelling={cancellingId === job.id}
                onPreview={setPreviewJob}
                onRetry={handleRetry}
                onRerun={handleRerun}
                onCancel={handleCancel}
              />
            ))
          ) : (
            <div className="empty-state">
              <Clapperboard size={28} />
              <h3>还没有任务</h3>
              <p>从资产或分镜页开始生成。</p>
            </div>
          )}
        </div>
      </section>
      {previewJob && <VideoPreviewModal job={previewJob} onClose={() => setPreviewJob(null)} />}
    </div>
  )
}

function GenerationJobRow({
  job,
  isRetrying,
  isRerunning,
  isCancelling,
  onPreview,
  onRetry,
  onRerun,
  onCancel,
}) {
  const resultUrl = resultUrlForTask(job)
  const canPreview = job.status === 'completed' && Boolean(resultUrl)
  const canDownload = job.status === 'completed' && Boolean(resultUrl)
  const canRetry = job.status === 'failed' || job.status === 'cancelled'
  const canRerun = job.status === 'completed' && canRerunTask(job) && Boolean(onRerun)
  const canCancel = job.status === 'queued' || job.status === 'running'
  const progress = Math.min(100, Math.max(0, job.progress ?? 0))

  return (
    <div className={`job-row generation-job ${job.status}`}>
      <div className={`job-icon ${job.status}`}>{statusIcon(job.status)}</div>
      <div className="job-main">
        <div className="job-title-line">
          <strong>{job.label}</strong>
          <span>
            {jobTypeLabel(job)} · {job.estimatedCredits} 积分
          </span>
        </div>
        {job.status === 'running' && (
          <>
            <div className="job-progress">
              <span style={{ width: `${progress}%` }} />
            </div>
            <span className="job-poll-note">轮询中 · 更新于 {formatTime(job.updatedAt)}</span>
          </>
        )}
        {job.status === 'queued' && <span className="job-poll-note">等待并发空位</span>}
        {job.status === 'cancelled' && <span className="job-poll-note">任务已取消，可按退款策略重试</span>}
        {job.status === 'failed' && (
          <div className="job-error">
            <AlertCircle size={14} />
            <span>{job.error || '任务处理失败，请检查服务配置后重试。'}</span>
          </div>
        )}
      </div>
      <div className="job-side">
        <span className={`job-state ${job.status}`}>
          {job.status === 'running' ? `${progress}%` : statusLabels[job.status] || job.status}
        </span>
        {(canRetry || canCancel || canPreview || canDownload || canRerun) && (
          <div className="job-actions">
            {canCancel && (
              <button
                className="job-action"
                type="button"
                onClick={() => onCancel(job)}
                disabled={isCancelling}
              >
                <X size={13} /> {isCancelling ? '取消中' : '取消'}
              </button>
            )}
            {canRetry && (
              <button className="job-action" type="button" onClick={() => onRetry(job)} disabled={isRetrying}>
                <RotateCcw size={13} /> {isRetrying ? '重试中' : '重试'}
              </button>
            )}
            {canRerun && (
              <button
                className="job-action"
                type="button"
                onClick={() => onRerun(job)}
                disabled={isRerunning}
              >
                <RotateCcw size={13} /> {isRerunning ? '重生中' : '重生'}
              </button>
            )}
            {canPreview && (
              <button className="job-action" type="button" onClick={() => onPreview(job)}>
                <Video size={13} /> 查看结果
              </button>
            )}
            {canDownload && (
              <a className="job-action" href={resultUrl} download={downloadNameForTask(job)}>
                <Download size={13} /> 下载
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function VideoPreviewModal({ job, onClose }) {
  const resultUrl = resultUrlForTask(job)
  const isPlayable = job.kind === 'video' && isPlayableVideoUrl(resultUrl)
  const isAudio = job.kind === 'audio'

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal video-result-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">生成结果</span>
            <h2>{job.label}</h2>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="video-result-body">
          {isAudio ? (
            <audio className="audio-result-player" src={resultUrl} controls autoPlay />
          ) : isPlayable ? (
            <video className="video-result-player" src={resultUrl} controls autoPlay />
          ) : (
            <img className="video-result-player" src={resultUrl} alt={job.label} />
          )}
          {!isPlayable && !isAudio && <p>当前结果不是可直接播放的视频文件，可先下载或查看图片预览。</p>}
        </div>
        <div className="modal-actions">
          <a className="button secondary" href={resultUrl} download={downloadNameForTask(job)}>
            <Download size={16} /> 下载结果
          </a>
          <button className="button primary" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

function queueSummary(activeCount, failedCount, cancelledCount) {
  if (activeCount) return `${activeCount} 项正在处理`
  if (failedCount || cancelledCount) return `${failedCount + cancelledCount} 项需要处理`
  return '所有任务已结束'
}

function typeLabel(kind) {
  return { text: '文本', image: '图片', video: '视频', audio: '音频' }[kind] || kind
}

function jobTypeLabel(job) {
  if (job.kind === 'audio') return '音频'
  if (job.kind === 'video' && job.provider === 'film-export') return '成片'
  if (job.kind === 'image' && job.metadata?.generationStage === 'turnaround') return '三视图'
  if (job.kind === 'image' && job.metadata?.generationStage === 'face') return '面部'
  if (job.kind === 'image' && job.metadata?.generationStage === 'body') return '全身'
  return typeLabel(job.kind)
}

function canRerunTask(job) {
  return job.kind === 'audio' || (job.kind === 'image' && job.metadata?.generationStage === 'turnaround')
}

function statusIcon(status) {
  if (status === 'completed') return <Check size={15} />
  if (status === 'running') return <LoaderCircle size={15} className="spin" />
  if (status === 'failed') return <AlertCircle size={15} />
  if (status === 'cancelled') return <X size={15} />
  return <Clock3 size={15} />
}

function latestUpdatedAt(jobs) {
  return jobs.reduce((latest, job) => {
    if (!job.updatedAt) return latest
    if (!latest || new Date(job.updatedAt).getTime() > new Date(latest).getTime()) return job.updatedAt
    return latest
  }, '')
}

function formatTime(value) {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
