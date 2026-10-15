import { useEffect, useRef } from 'react'
import { LoaderCircle, RefreshCw, X } from 'lucide-react'
import { parseTextCompletionSnapshot } from './textCompletionInspection'
import './TextCompletionDialog.css'

const SOURCE_LABELS = {
  'provider-derived': '模型输出',
  mixed: '混合生成',
  'retained-input': '保留原文',
  'local-derived': '本地处理',
  'reused-episode': '复用剧集',
}
const OPERATION_LABELS = { generate: '文本生成', enrich: '文本润色', 'suggest-assets': '资产建议' }
const REASON_VIEW = {
  verified: {
    status: 'verified',
    title: '来源记录已核验',
    message: '服务器已核对任务保存结果与来源回执一致。',
  },
  'task-not-completed': {
    status: 'pending',
    title: '任务尚未完成',
    message: '本次查询未采信完成回执，请在任务完成后重新查看。',
  },
  'missing-receipt': {
    status: 'pending',
    title: '未记录来源回执',
    message: '历史任务可能没有来源回执，无法据此确认本次文本来源。',
  },
  'invalid-receipt': {
    status: 'failed',
    title: '来源记录核验失败',
    message: '保存的回执格式无效，未展示或采信其中的来源信息。',
  },
  'receipt-mismatch': {
    status: 'failed',
    title: '来源记录与任务不一致',
    message: '回执与任务保存结果或范围不一致，未采信其中的来源信息。',
  },
}

export function TextCompletionDialog({ dialog, onClose, onRetry }) {
  const modalRef = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previousFocus = document.activeElement
    closeRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const targets = [
        ...(modalRef.current?.querySelectorAll('button:not([disabled]), summary, [tabindex="0"]') || []),
      ].filter((node) => node.getClientRects().length)
      const first = targets[0]
      const last = targets.at(-1)
      if (!first) return
      if (
        event.shiftKey &&
        (document.activeElement === first || !modalRef.current.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !modalRef.current.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  let snapshot = null
  let displayError = dialog.error
  if (dialog.status === 'ready') {
    try {
      snapshot = parseTextCompletionSnapshot(dialog.snapshot, dialog.scope)
    } catch (error) {
      displayError = error.message
    }
  }
  const view = snapshot ? REASON_VIEW[snapshot.reason] : null
  const receipt = snapshot?.reason === 'verified' ? snapshot.receipt : null
  const loading = dialog.status === 'loading'
  const callCount = receipt?.units.reduce((sum, unit) => sum + unit.providerCalls.length, 0) || 0
  const sourceCounts =
    receipt?.units.reduce(
      (counts, unit) => ({ ...counts, [unit.source]: (counts[unit.source] || 0) + 1 }),
      {},
    ) || {}

  return (
    <div className="modal-backdrop text-completion-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        className="modal text-completion-modal"
        role="dialog"
        aria-modal="true"
        aria-label="文本结果来源"
        aria-describedby="text-completion-boundary"
        aria-busy={loading}
        data-testid="text-completion-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">任务结果的历史来源</span>
            <h2>文本结果来源</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="text-completion-task">{dialog.job?.label || '文本任务'}</p>
        <p id="text-completion-boundary" className="text-completion-boundary">
          这是任务完成时保存的历史结果快照，当前可编辑剧本可能已变化。来源记录不等于上游认证、内容质量验收或正式交付授权。
        </p>
        {loading && (
          <p className="text-completion-loading" role="status">
            <LoaderCircle size={16} className="spin" />
            正在核验文本来源…
          </p>
        )}
        {displayError && (
          <p className="text-completion-error" role="alert">
            {displayError}
          </p>
        )}
        {view && (
          <section
            className={'text-completion-result ' + view.status}
            data-testid="text-completion-receipt"
            data-reason={snapshot.reason}
            data-status={view.status}
            aria-label="文本来源核验结果"
          >
            <strong>{view.title}</strong>
            <p>{view.message}</p>
            <p className="text-completion-time">
              查询时间：<time dateTime={snapshot.checkedAt}>{formatTime(snapshot.checkedAt)}</time>
            </p>
          </section>
        )}
        {receipt && (
          <section
            className="text-completion-receipt"
            data-testid="text-completion-details"
            aria-label="已核验来源记录"
          >
            <dl>
              <Field name="任务操作">{OPERATION_LABELS[receipt.operation]}</Field>
              <Field name="来源分类">
                {Object.entries(sourceCounts)
                  .map(([source, count]) => SOURCE_LABELS[source] + ' ' + count + ' 项')
                  .join('；')}
              </Field>
              <Field name="结果单元">{receipt.units.length} 项</Field>
              <Field name="已返回调用">{callCount} 次</Field>
              <Field name="完成时间">
                <time dateTime={receipt.completedAt}>{formatTime(receipt.completedAt)}</time>
              </Field>
              <Field name="结果大小">{formatBytes(receipt.resultBytes)}</Field>
              <Field name="结果 SHA-256">
                <code>{receipt.resultSha256}</code>
              </Field>
            </dl>
            <p>
              摘要对应任务保存的规范 JSON 结果；字节数按 UTF-8
              计算。已返回调用可能包含未采用的候选或空响应，次数不代表最终采用数量。
              逻辑模型是请求使用的模型标识，不代表上游实际模型认证。
            </p>
            <details className="text-completion-details">
              <summary>查看 {receipt.units.length} 个结果单元与调用详情</summary>
              <ol className="text-completion-units">
                {receipt.units.map((unit) => (
                  <li key={unit.unitId}>
                    <strong>{unit.unitId}</strong>
                    <span>
                      {SOURCE_LABELS[unit.source]} · {formatBytes(unit.resultBytes)} · 已返回调用{' '}
                      {unit.providerCalls.length} 次
                    </span>
                    <code>{unit.resultSha256}</code>
                    {unit.providerCalls.length > 0 && (
                      <details>
                        <summary>查看 {unit.providerCalls.length} 次调用记录</summary>
                        <ol className="text-completion-calls">
                          {unit.providerCalls.map((call) => (
                            <li key={call.sequence}>
                              <strong>调用 {call.sequence}</strong>
                              <span>
                                逻辑模型：{call.model || '未记录'} · 阶段：{call.stage || '未记录'}
                              </span>
                              <span>返回文本 {formatBytes(call.responseBytes)}</span>
                              <code>{call.responseSha256}</code>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          </section>
        )}
        <div className="text-completion-actions">
          <button className="button secondary" type="button" onClick={onRetry}>
            <RefreshCw size={15} />
            重新核验
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ name, children }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  )
}
function formatBytes(value) {
  return value.toLocaleString('zh-CN') + ' 字节'
}
function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
