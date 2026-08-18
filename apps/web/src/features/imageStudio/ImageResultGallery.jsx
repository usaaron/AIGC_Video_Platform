import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ImagePreviewModal } from '../../components/ImagePreviewModal'
import { imageUrlForTask } from './image2Results'

const RESULT_PAGE_SIZE = 10
const BATCH_PAGE_SIZE = 5

export function ImageResultGallery({
  batch,
  batches = [],
  selectedBatchId = null,
  onSelectBatch,
  refreshing = false,
  onRefresh,
  onRedo,
  onEdit,
  onUseAsReference,
  onDelete,
  onRetryFailed,
  retryingTaskId = null,
}) {
  const [previewTaskId, setPreviewTaskId] = useState(null)
  const [page, setPage] = useState(1)
  const [batchPage, setBatchPage] = useState(1)
  const tasks = batch?.tasks ?? []
  const pageCount = Math.max(1, Math.ceil(tasks.length / RESULT_PAGE_SIZE))
  const pageStart = (page - 1) * RESULT_PAGE_SIZE
  const pageTasks = tasks.slice(pageStart, pageStart + RESULT_PAGE_SIZE)
  const batchPageCount = Math.max(1, Math.ceil(batches.length / BATCH_PAGE_SIZE))
  const batchPageStart = (batchPage - 1) * BATCH_PAGE_SIZE
  const pageBatches = batches.slice(batchPageStart, batchPageStart + BATCH_PAGE_SIZE)
  const selectedBatchIndex = batches.findIndex((item) => item.batchId === selectedBatchId)
  const completedImages = tasks.flatMap((task, index) => {
    const imageUrl = imageUrlForTask(task)
    if (task.status !== 'completed' || !imageUrl) return []
    const batchIndex = Number(task.metadata?.batchIndex) || index + 1
    return [
      {
        task,
        url: imageUrl,
        alt: `${batch.label} ${batchIndex}`,
        fileName: `生图大师-结果-${batchIndex}.png`,
      },
    ]
  })
  const previewIndex = completedImages.findIndex((image) => image.task.id === previewTaskId)

  useEffect(() => {
    setPage(1)
    setPreviewTaskId(null)
  }, [batch?.batchId])

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), pageCount))
  }, [pageCount])

  useEffect(() => {
    setBatchPage((current) => Math.min(Math.max(current, 1), batchPageCount))
  }, [batchPageCount])

  useEffect(() => {
    if (selectedBatchIndex >= 0) {
      setBatchPage(Math.floor(selectedBatchIndex / BATCH_PAGE_SIZE) + 1)
    }
  }, [selectedBatchId, selectedBatchIndex])

  return (
    <section className="image2-panel image2-result-gallery" aria-label="结果画廊">
      <div className="image2-panel-head">
        <div>
          <span className="eyebrow">生成结果</span>
          <strong>{batch ? batch.label : '暂无结果'}</strong>
        </div>
        <div className="image2-result-actions">
          {batch && (
            <span className="image2-result-count">
              {batch.completedCount} / {batch.totalCount} · 每页 {RESULT_PAGE_SIZE} 张
            </span>
          )}
          {onRefresh && (
            <button className="image2-icon-button" type="button" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              <span>刷新</span>
            </button>
          )}
        </div>
      </div>

      {batches.length > 0 && (
        <section className="image2-batch-history" aria-label="批次记录">
          <div className="image2-batch-history-head">
            <span>
              <History size={13} />
              批次记录
            </span>
            <div>
              <small>共 {batches.length} 批</small>
              {batchPageCount > 1 && (
                <nav className="image2-batch-pagination" aria-label="批次记录分页">
                  <button
                    type="button"
                    aria-label="上一页批次"
                    title="上一页批次"
                    disabled={batchPage <= 1}
                    onClick={() => setBatchPage((current) => Math.max(1, current - 1))}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span>
                    {batchPage} / {batchPageCount}
                  </span>
                  <button
                    type="button"
                    aria-label="下一页批次"
                    title="下一页批次"
                    disabled={batchPage >= batchPageCount}
                    onClick={() => setBatchPage((current) => Math.min(batchPageCount, current + 1))}
                  >
                    <ChevronRight size={14} />
                  </button>
                </nav>
              )}
            </div>
          </div>
          <div className="image2-batch-history-list">
            {pageBatches.map((item) => (
              <button
                key={item.batchId}
                className={`image2-batch-history-item ${item.batchId === selectedBatchId ? 'selected' : ''}`}
                type="button"
                aria-pressed={item.batchId === selectedBatchId}
                onClick={() => onSelectBatch?.(item.batchId)}
              >
                <span>
                  <strong>{item.label}</strong>
                  <time dateTime={item.updatedAt}>{formatBatchTimestamp(item.updatedAt)}</time>
                </span>
                <span className="image2-batch-history-prompt" title={item.prompt || ''}>
                  {item.prompt || '暂无提示词'}
                </span>
                <span>
                  <small>
                    完成 {item.completedCount}/{item.totalCount}
                  </small>
                  {item.failedCount > 0 && <small className="failed">失败 {item.failedCount}</small>}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="image2-result-grid">
        {pageTasks.map((task, index) => {
          const imageUrl = imageUrlForTask(task)
          const completed = task.status === 'completed' && Boolean(imageUrl)
          const failed = task.status === 'failed'
          const retrying = failed && retryingTaskId === task.id
          const retryable = failed && Boolean(onRetryFailed) && !retrying
          const interactive = completed || retryable
          const tileClassName = [
            'image2-result-tile',
            task.status,
            retryable ? 'retryable' : '',
            retrying ? 'retrying' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const resultIndex = Number(task.metadata?.batchIndex) || pageStart + index + 1
          return (
            <button
              key={task.id}
              className={tileClassName}
              type="button"
              disabled={!interactive}
              aria-label={
                completed ? `预览第 ${resultIndex} 张图片` : retryable ? `重试失败图片 ${resultIndex}` : undefined
              }
              title={completed ? '预览图片' : retryable ? '重试失败图片' : undefined}
              onClick={() => {
                if (completed) {
                  setPreviewTaskId(task.id)
                  return
                }
                if (retryable) onRetryFailed(task)
              }}
            >
              {completed ? (
                <img src={imageUrl} alt={`${batch.label} ${resultIndex}`} />
              ) : (
                <span className="image2-result-placeholder">
                  {retrying ? (
                    <LoaderCircle size={22} className="spin" />
                  ) : task.status === 'failed' ? (
                    <AlertTriangle size={22} />
                  ) : task.status === 'completed' ? (
                    <Check size={22} />
                  ) : task.status === 'running' ? (
                    <LoaderCircle size={22} className="spin" />
                  ) : (
                    <ImageIcon size={22} />
                  )}
                  {retryable && <small>点击重试</small>}
                </span>
              )}
              <span className="image2-result-state">{retrying ? '重试中' : resultStateLabel(task)}</span>
            </button>
          )
        })}
        {!tasks.length && (
          <div className="image2-gallery-empty">
            <ImageIcon size={20} />
            <span>提交后在这里显示生成结果</span>
          </div>
        )}
      </div>
      {pageCount > 1 && (
        <nav className="image2-pagination image2-result-pagination" aria-label="生成结果分页">
          <button
            type="button"
            aria-label="上一页"
            title="上一页"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            type="button"
            aria-label="下一页"
            title="下一页"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            <ChevronRight size={15} />
          </button>
        </nav>
      )}
      {previewIndex >= 0 && (
        <ImagePreviewModal
          images={completedImages}
          currentIndex={previewIndex}
          groupFileName={`${batch.label}-结果`}
          batchPrompt={batch.prompt}
          batchOriginalPrompt={batch.originalPrompt}
          onNavigate={(index) => setPreviewTaskId(completedImages[index]?.task.id ?? null)}
          onRedo={onRedo ? (image) => onRedo(image.task, image) : undefined}
          onEdit={onEdit ? (image) => onEdit(image.task, image) : undefined}
          onUseAsReference={onUseAsReference ? (image) => onUseAsReference(image.task, image) : undefined}
          onDelete={onDelete ? (image) => onDelete(image.task, image) : undefined}
          onClose={() => setPreviewTaskId(null)}
        />
      )}
    </section>
  )
}

function resultStateLabel(task) {
  if (task.status === 'completed') return '完成'
  if (task.status === 'failed') return '失败'
  if (task.status === 'running') return `${task.progress || 0}%`
  if (task.status === 'cancelled') return '取消'
  return '排队'
}

function formatBatchTimestamp(value) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}
