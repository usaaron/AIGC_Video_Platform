import {
  DELIVERY_PROVIDER_COMPLETION_REQUIREMENT,
  deliveryContractRequiresProviderCompletion,
} from '@seqora/contracts'
import {
  PROVIDER_COMPLETION_EXPLANATION,
  PROVIDER_COMPLETION_LEGACY_NOTICE,
  providerCompletionReceiptView,
} from './providerCompletionView'
import './ProviderCompletionReceipt.css'

const statusLabels = {
  passed: '服务端完成回执已核验',
  pending: '完成回执待补证据',
  failed: '完成回执核验失败',
  observed: '已观察到 Provider 状态，完成回执待补',
}

export function ProviderCompletionReceipt({ snapshot, enabled = false }) {
  const view = providerCompletionReceiptView(snapshot, enabled)
  if (!view) return null
  return (
    <section
      className={`provider-completion-receipt ${view.status}`}
      aria-label="Provider 完成回执"
      data-testid="provider-completion-receipt"
      data-status={view.status}
    >
      <div className="provider-completion-head">
        <span>Provider 完成回执</span>
        <strong>{statusLabels[view.status]}</strong>
      </div>
      {view.contractRequirement === 'legacy' ? (
        <p>此冻结合同未纳入 Provider 完成回执要求；回执信息仅供查看，整体交付以服务器门禁为准。</p>
      ) : view.contractRequirement === 'required' ? (
        <p>此冻结合同已将 Provider 完成回执列为必备要求。</p>
      ) : (
        <p>当前尚无有效冻结合同，回执信息仅供查看。</p>
      )}
      {view.mediaStatus === 'failed' && (
        <p className="provider-completion-media-state">
          当前主视频媒体核验失败，已记录回执不能替代本次媒体核验。
        </p>
      )}
      {view.mediaStatus === 'pending' && (
        <p className="provider-completion-media-state">
          当前主视频媒体仍待核验，已记录回执不能替代本次媒体核验。
        </p>
      )}
      {view.receipt && (
        <dl>
          <div>
            <dt>Provider 适配器</dt>
            <dd>{view.receipt.providerLabel}</dd>
          </div>
          <div>
            <dt>生成尝试</dt>
            <dd>第 {view.receipt.attempts} 次</dd>
          </div>
          <div>
            <dt>完成时间</dt>
            <dd>{view.receipt.completedAt}</dd>
          </div>
          <div>
            <dt>主视频大小</dt>
            <dd>{view.receipt.size}</dd>
          </div>
          <div>
            <dt>SHA-256 摘要</dt>
            <dd>{view.receipt.hashSummary}</dd>
          </div>
        </dl>
      )}
      <p>{PROVIDER_COMPLETION_EXPLANATION}</p>
      {['invalid-receipt', 'receipt-mismatch'].includes(view.missingReason) && (
        <p>回执无效或与当前任务媒体不一致，请重新读取服务端核验结果。</p>
      )}
      {view.missingReason === 'task-not-completed' && <p>任务尚未完成，等待服务端观察完成并保存主视频。</p>}
      {!view.receipt && <p>{PROVIDER_COMPLETION_LEGACY_NOTICE}</p>}
    </section>
  )
}

export function ProviderCompletionRequirement({ job }) {
  if (!deliveryContractRequiresProviderCompletion(job ?? {})) return null
  return (
    <>
      <label>
        <input type="checkbox" checked disabled readOnly data-testid="provider-completion-required" />
        <span>{DELIVERY_PROVIDER_COMPLETION_REQUIREMENT.statement}（必选）</span>
      </label>
      <p className="provider-completion-freeze-note">{PROVIDER_COMPLETION_EXPLANATION}</p>
      <p className="provider-completion-freeze-note">{PROVIDER_COMPLETION_LEGACY_NOTICE}</p>
    </>
  )
}
