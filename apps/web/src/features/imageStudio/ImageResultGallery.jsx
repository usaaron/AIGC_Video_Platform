import { AlertTriangle, Check, ImageIcon, LoaderCircle, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ImagePreviewModal } from '../../components/ImagePreviewModal'

export function ImageResultGallery({ batch, refreshing = false, onRefresh }) {
  const [preview, setPreview] = useState(null)
  const tasks = batch?.tasks ?? []

  return (
    <section className="image2-panel image2-result-gallery" aria-label="结果画廊">
      <div className="image2-panel-head">
        <div>
          <span className="eyebrow">生成结果</span>
          <strong>{batch ? batch.label : '暂无结果'}</strong>
        </div>
        <div className="image2-result-actions">
          {batch && <span className="image2-result-count">{batch.completedCount} / {batch.totalCount}</span>}
          {onRefresh && (
            <button className="image2-icon-button" type="button" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              <span>刷新</span>
            </button>
          )}
        </div>
      </div>

      <div className="image2-result-grid">
        {tasks.map((task, index) => {
          const imageUrl = task.outputs?.find((output) => output.mediaType === 'image')?.url || task.resultUrl
          const completed = task.status === 'completed' && imageUrl
          return (
            <button
              key={task.id}
              className={`image2-result-tile ${task.status}`}
              type="button"
              disabled={!completed}
              onClick={() =>
                setPreview({
                  url: imageUrl,
                  alt: `${batch.label} ${index + 1}`,
                  fileName: `${batch.batchId}-${index + 1}.png`,
                })
              }
            >
              {completed ? (
                <img src={imageUrl} alt={`${batch.label} ${index + 1}`} />
              ) : (
                <span className="image2-result-placeholder">
                  {task.status === 'failed' ? (
                    <AlertTriangle size={22} />
                  ) : task.status === 'completed' ? (
                    <Check size={22} />
                  ) : task.status === 'running' ? (
                    <LoaderCircle size={22} className="spin" />
                  ) : (
                    <ImageIcon size={22} />
                  )}
                </span>
              )}
              <span className="image2-result-state">{resultStateLabel(task)}</span>
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
      {preview && <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />}
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
