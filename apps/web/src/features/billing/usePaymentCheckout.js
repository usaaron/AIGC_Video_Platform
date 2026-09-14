import { useEffect, useRef, useState } from 'react'
import { buildPaymentRequest, paymentClient } from './paymentClient'

export function usePaymentCheckout() {
  const [payment, setPayment] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const pendingRef = useRef(null)

  useEffect(() => () => pendingRef.current?.abort(), [])

  const openPayment = async (input) => {
    if (pendingRef.current || payment) return
    const controller = new AbortController()
    pendingRef.current = controller
    setSubmitting(true)
    setNotice('')
    try {
      const request = buildPaymentRequest(input)
      const result = await paymentClient.createPayment(request, { signal: controller.signal })
      if (!controller.signal.aborted) {
        // A real order must never be rendered using the mock confirmation workflow.
        if (result.mode !== 'mock') throw new Error('正式支付尚未启用，请前往账单确认账户状态。')
        setPayment(result)
      }
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error.message || '支付窗口加载失败，请重试。')
    } finally {
      if (!controller.signal.aborted) {
        setSubmitting(false)
        pendingRef.current = null
      }
    }
  }

  const closePayment = () => {
    setPayment(null)
    setNotice('已关闭支付窗口。')
  }

  return { payment, submitting, notice, setNotice, openPayment, closePayment }
}
