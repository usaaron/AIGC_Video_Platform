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

export function GenerationPage({ jobs, onClear, onRetry, onNext, pollError }) {
  const [previewJob, setPreviewJob] = useState(null)
  const [retryingId, setRetryingId] = useState('')
  const [actionError, setActionError] = useState('')
  const runningCount = jobs.filter((job) => job.status === 'running').length
  const queuedCount = jobs.filter((job) => job.status === 'queued').length
  const completedCount = jobs.filter((job) => job.status === 'completed').length
  const failedCount = jobs.filter((job) => job.status === 'failed').length
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

  return (
    <div className="page queue-page">
      <PageHeader
        eyebrow="第 4 步 · 生成"
        title="任务状态"
        description="只看任务是否完成、为什么失败，以及结果在哪里。"
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
            <span>{queueSummary(activeCount, failedCount)}</span>
          </div>
          <div className="queue-panel-tools">
            <span className={`queue-sync ${pollError ? 'failed' : ''}`}>
              {pollError ? '状态同步失败' : `自动轮询 · 最近同步 ${formatTime(lastUpdatedAt)}`}
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
                onPreview={setPreviewJob}
                onRetry={handleRetry}
              />
            ))
          ) : (
            <div className="empty-state">
              <Clapperboard size={28} />
              <h3>还没有任务</h3>
              <p>从资产或分镜页面开始生成。</p>
            </div>
          )}
        </div>
      </section>
      {previewJob && <VideoPreviewModal job={previewJob} onClose={() => setPreviewJob(null)} />}
    </div>
  )
}

function GenerationJobRow({ job, isRetrying, onPreview, onRetry }) {
  const resultUrl = resultUrlForTask(job)
  const canPreview = job.status === 'completed' && Boolean(resultUrl)
  const canDownload = job.status === 'completed' && Boolean(resultUrl)
  const progress = Math.min(100, Math.max(0, job.progress ?? 0))

  return (
    <div className={`job-row generation-job ${job.status}`}>
      <div className={`job-icon ${job.status}`}>{statusIcon(job.status)}</div>
      <div className="job-main">
        <div className="job-title-line">
          <strong>{job.label}</strong>
          <span>
            {typeLabel(job.kind)} · {job.estimatedCredits} 积分
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
        {(job.status === 'failed' || canPreview || canDownload) && (
          <div className="job-actions">
            {job.status === 'failed' && (
              <button className="job-action" type="button" onClick={() => onRetry(job)} disabled={isRetrying}>
                <RotateCcw size={13} /> {isRetrying ? '重试中' : '重试'}
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
            <span className="eyebrow">视频结果</span>
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
          {!isPlayable && <p>当前结果为本地演示占位，真实视频完成后会在这里播放。</p>}
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

function queueSummary(activeCount, failedCount) {
  if (activeCount) return `${activeCount} 项正在处理`
  if (failedCount) return `${failedCount} 项需要处理`
  return '所有任务已结束'
}

function typeLabel(kind) {
  return { text: '文本', image: '图片', video: '视频', audio: '音频' }[kind] || kind
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
