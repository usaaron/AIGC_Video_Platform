import { useEffect, useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { createDeliveryDownloadAction, deliveryDownloadInput } from './deliveryDownloadAction'
import './DeliveryDownload.css'

export function DeliveryDownload({ job, snapshot, gate, onDownload, onRefresh }) {
  const [state, setState] = useState({ status: 'idle' })
  const [action] = useState(() => createDeliveryDownloadAction({ download: onDownload, onState: setState }))
  useEffect(() => () => action.cancel(), [action])
  const input = deliveryDownloadInput(job, snapshot, gate)
  const busy = state.status === 'loading'
  return (
    <section className="delivery-download" aria-label="正式下载" aria-busy={busy}>
      <p>正式下载时，服务器将重新核验当前合同、验收证据和媒体文件，并生成下载回执。</p>
      <div className="delivery-download-actions">
        <button
          className="button primary"
          type="button"
          disabled={!input || busy || state.needsRefresh}
          onClick={() => {
            if (input && !state.needsRefresh) void action.run(job.id, input)
          }}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
          {busy ? '正在核验并下载…' : '正式下载'}
        </button>
        {onRefresh && (
          <button className="button secondary" type="button" disabled={busy} onClick={onRefresh}>
            <RefreshCw size={15} /> 重新核验
          </button>
        )}
      </div>
      {!input && <p>当前交付证据尚未全部通过，暂不可正式下载。</p>}
      {state.status === 'error' && (
        <p className="delivery-download-error" role="alert">
          {state.message}
          {state.needsRefresh && '。任务或交付条件可能已变化，请重新核验。'}
        </p>
      )}
      {state.status === 'success' && (
        <>
          <p className="delivery-download-success" role="status">
            服务器已核验并发送下载。回执 ID：{state.receiptId}
          </p>
          <p>再次下载前，请重新核验当前交付证据。</p>
        </>
      )}
    </section>
  )
}
