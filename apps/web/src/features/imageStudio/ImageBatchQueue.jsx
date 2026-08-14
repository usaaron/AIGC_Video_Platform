import { AlertTriangle, Check, Clock3, LoaderCircle, RefreshCw } from 'lucide-react'

export function ImageBatchQueue({ batches, selectedBatchId, refreshing, onRefresh, onSelectBatch }) {
  return (
    <section className="image2-panel image2-batch-queue" aria-label="生成队列">
      <div className="image2-panel-head">
        <div>
          <span className="eyebrow">批次</span>
          <strong>{batches.length} 组</strong>
        </div>
        <button className="image2-icon-button" type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          <span>刷新</span>
        </button>
      </div>

      <div className="image2-batch-list">
        {batches.map((batch) => (
          <button
            key={batch.batchId}
            className={`image2-batch-item ${selectedBatchId === batch.batchId ? 'active' : ''}`}
            type="button"
            onClick={() => onSelectBatch(batch.batchId)}
          >
            <div className="image2-batch-row">
              <strong>{batch.label}</strong>
              <span>{batch.estimatedCredits} 积分</span>
            </div>
            <div className="image2-clapper" aria-hidden="true">
              <i className="queued" style={{ flexGrow: Math.max(batch.queuedCount, 1) }} />
              <i className="running" style={{ flexGrow: Math.max(batch.runningCount, 1) }} />
              <i className="completed" style={{ flexGrow: Math.max(batch.completedCount, 1) }} />
            </div>
            <div className="image2-batch-meta">
              <span>
                <Clock3 size={12} /> {batch.queuedCount}
              </span>
              <span>
                <LoaderCircle size={12} /> {batch.runningCount}
              </span>
              <span>
                <Check size={12} /> {batch.completedCount}
              </span>
              {batch.failedCount > 0 && (
                <span className="failed">
                  <AlertTriangle size={12} /> {batch.failedCount}
                </span>
              )}
            </div>
          </button>
        ))}
        {!batches.length && (
          <div className="image2-queue-empty">
            <Clock3 size={18} />
            <span>等待第一个 image2 批次</span>
          </div>
        )}
      </div>
    </section>
  )
}
