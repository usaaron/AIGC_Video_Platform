import { Coins, Images, LoaderCircle, Sparkles, Wallet, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function Image2CreditConfirmDialog({
  open,
  title,
  actionDescription,
  confirmLabel,
  imageCount = 1,
  estimatedCredits,
  availableCredits,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null)
  const [confirming, setConfirming] = useState(false)
  const insufficientCredits = estimatedCredits > availableCredits

  useEffect(() => {
    if (!open) {
      setConfirming(false)
      return undefined
    }
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus())
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.cancelAnimationFrame(frame)
    }
  }, [onCancel, open])

  if (!open) return null

  const handleConfirm = async () => {
    if (confirming || insufficientCredits) return
    setConfirming(true)
    try {
      await onConfirm?.()
      onCancel?.()
    } catch {
      // The caller presents the actionable error in the image studio workspace.
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="modal-backdrop image2-submit-confirm-backdrop" onMouseDown={onCancel}>
      <section
        className="modal image2-submit-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image2-credit-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="image2-submit-confirm-head">
          <div>
            <span className="eyebrow">积分确认</span>
            <h2 id="image2-credit-confirm-title">{title}</h2>
          </div>
          <button
            ref={cancelRef}
            type="button"
            className="button secondary image2-submit-confirm-close"
            aria-label="关闭确认框"
            disabled={confirming}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>

        <div className="image2-submit-confirm-body">
          <p className="image2-submit-confirm-copy">
            本次将{actionDescription}，预计消耗 <strong>{estimatedCredits}</strong> 积分，当前余额{' '}
            <strong>{availableCredits}</strong> 积分。
          </p>
          <div className="image2-submit-confirm-grid">
            <article className="image2-submit-confirm-stat">
              <span>
                <Images size={12} />
                本次生成
              </span>
              <strong>{imageCount} 张</strong>
              <small>会按当前服务端规则创建新的图片任务。</small>
            </article>
            <article className={`image2-submit-confirm-stat ${insufficientCredits ? 'warning' : ''}`}>
              <span>
                <Coins size={12} />
                预计消耗
              </span>
              <strong>{estimatedCredits} 积分</strong>
              <small>
                {insufficientCredits ? '当前余额不足，无法继续操作。' : '最终以服务端实际结算为准。'}
              </small>
            </article>
            <article className="image2-submit-confirm-stat">
              <span>
                <Wallet size={12} />
                当前余额
              </span>
              <strong>{availableCredits} 积分</strong>
              <small>
                {insufficientCredits
                  ? `还差 ${estimatedCredits - availableCredits} 积分`
                  : '余额足够完成本次操作。'}
              </small>
            </article>
          </div>
        </div>

        <div className="modal-actions image2-submit-confirm-actions">
          <button type="button" className="button secondary" disabled={confirming} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="button primary"
            disabled={confirming || insufficientCredits}
            onClick={handleConfirm}
          >
            {confirming ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
            {confirming ? '提交中' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
