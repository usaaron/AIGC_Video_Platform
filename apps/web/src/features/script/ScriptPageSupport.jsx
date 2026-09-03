import { CircleHelp } from 'lucide-react'

export function ScriptHelp({ label, children }) {
  return (
    <span className="script-inline-help" tabIndex={0} aria-label={label}>
      <CircleHelp size={14} />
      <span role="tooltip">{children}</span>
    </span>
  )
}

export function TextTimingSummary({ timing }) {
  const firstTokenWaitMs = numberOrNull(timing.firstTokenWaitMs)
  const responseHeadersMs = numberOrNull(timing.responseHeadersMs)
  const providerMs = numberOrNull(timing.providerMs ?? timing.generationMs)
  const appProcessingMs = numberOrNull(timing.appProcessingMs)
  const queueWaitMs = numberOrNull(timing.queueWaitMs)
  const totalMs = numberOrNull(timing.totalMs)
  const extraModelCalls = Math.max(0, Number(timing.extraModelCalls) || 0)
  return (
    <section className="script-timing-summary" aria-label="最近一次剧本生成耗时">
      <div>
        <span className="eyebrow">最近一次生成</span>
        <strong>总耗时 {formatMilliseconds(totalMs)}</strong>
      </div>
      <dl>
        <div>
          <dt>排队</dt>
          <dd>{formatMilliseconds(queueWaitMs)}</dd>
        </div>
        <div>
          <dt>连接响应</dt>
          <dd>{formatMilliseconds(responseHeadersMs)}</dd>
        </div>
        <div>
          <dt>响应后首字</dt>
          <dd>{formatMilliseconds(firstTokenWaitMs)}</dd>
        </div>
        <div>
          <dt>模型总耗时</dt>
          <dd>{formatMilliseconds(providerMs)}</dd>
        </div>
        <div>
          <dt>校验与写回</dt>
          <dd>{formatMilliseconds(appProcessingMs)}</dd>
        </div>
      </dl>
      {extraModelCalls > 0 && <small>本次触发 {extraModelCalls} 次额外修复模型调用</small>}
    </section>
  )
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function formatMilliseconds(value) {
  if (value === null) return '未记录'
  if (value < 1_000) return `${Math.round(value)}ms`
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s`
}
