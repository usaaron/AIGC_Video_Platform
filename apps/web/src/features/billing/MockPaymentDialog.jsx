import { CircleAlert, LoaderCircle, ScanLine, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/ui'
import { formatRechargePrice } from './rechargeProducts'
import { PAYMENT_METHODS, paymentClient } from './paymentClient'
import { PaymentMethodIcon } from './PaymentMethodSelector'

export function MockPaymentDialog({ payment, onClose, returnFocusRef }) {
  const dialogRef = useRef(null)
  const queryRef = useRef(null)
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState(false)
  const method = PAYMENT_METHODS.find((item) => item.id === payment.request.paymentMethod)

  const checkPayment = async () => {
    if (queryRef.current) return
    const controller = new AbortController()
    queryRef.current = controller
    setChecking(true)
    try {
      const result = await paymentClient.queryPayment(payment, { signal: controller.signal })
      if (!controller.signal.aborted) setMessage(result.message)
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error.message || '查询失败，请重试。')
    } finally {
      if (!controller.signal.aborted) {
        setChecking(false)
        queryRef.current = null
      }
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = returnFocusRef.current
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      queryRef.current?.abort()
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [returnFocusRef])

  return (
    <dialog
      ref={dialogRef}
      className="recharge-dialog"
      aria-labelledby="recharge-dialog-title"
      aria-describedby="recharge-dialog-description"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
        const first = buttons[0]
        const last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="recharge-dialog-heading">
        <span className={`payment-provider ${method.id}`}>
          <PaymentMethodIcon method={method.id} size={21} />
          <h2 id="recharge-dialog-title">{method.label}</h2>
        </span>
        <IconButton label="关闭支付窗口" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      <div className="recharge-dialog-content">
        <span className="recharge-dialog-product">{payment.title}</span>
        <div className="recharge-dialog-amount">
          <small>¥</small>
          {formatRechargePrice(payment.amountFen)}
        </div>
        <div className="recharge-qr-frame">
          <img src={payment.qrImageUrl} width="200" height="200" alt="支付二维码占位图，不可用于付款" />
          <span>二维码占位图</span>
        </div>
        <p id="recharge-dialog-description" className="recharge-dialog-caption">
          <ScanLine size={16} />
          模拟支付 · 当前不可扫码付款
        </p>
        <div className="recharge-dialog-result" aria-live="polite">
          {message && (
            <>
              <CircleAlert size={16} />
              <span>{message}</span>
            </>
          )}
        </div>
        <div className="recharge-dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            返回修改
          </button>
          <button type="button" className="button primary" disabled={checking} onClick={checkPayment}>
            {checking && <LoaderCircle size={15} className="spin" />}
            {checking ? '查询中' : '我已支付'}
          </button>
        </div>
        <p className="recharge-dialog-note">实际到账以账户积分明细为准</p>
      </div>
    </dialog>
  )
}
