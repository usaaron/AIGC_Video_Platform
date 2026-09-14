import { MEMBERSHIP_PLANS } from './membershipProducts'
import { RECHARGE_PACKS } from './rechargeProducts'

export const PAYMENT_METHODS = [
  { id: 'wechat', label: '微信支付' },
  { id: 'alipay', label: '支付宝' },
]

// This request is the integration boundary. Prices and entitlements must be resolved by the server.
export function buildPaymentRequest({ productType, productId, paymentMethod }) {
  if (!['credits', 'subscription'].includes(productType)) throw new Error('商品类型不可用。')
  if (typeof productId !== 'string' || !productId.trim()) throw new Error('请选择商品。')
  if (!PAYMENT_METHODS.some((method) => method.id === paymentMethod)) {
    throw new Error('请选择有效的支付方式。')
  }
  return { productType, productId, paymentMethod, channel: 'qr' }
}

/**
 * Frontend-only adapter, intentionally independent of the existing Stripe checkout API.
 * Replace these methods via services/apiClient.js after shared contracts and server routes exist.
 * createPayment(input, { signal }) -> { mode, request, title, amountFen, qrImageUrl, orderId, status }
 * queryPayment(payment, { signal }) -> { mode, status, message }
 * No mock order IDs, ledger writes, or client-confirmed success.
 */
export const paymentClient = {
  async createPayment(input, { signal } = {}) {
    signal?.throwIfAborted()
    const request = buildPaymentRequest(input)
    const products = request.productType === 'credits' ? RECHARGE_PACKS : MEMBERSHIP_PLANS
    const product = products.find((item) => item.id === request.productId)
    if (!product) throw new Error('该商品暂不可用，请重新选择。')
    return {
      mode: 'mock',
      request,
      orderId: null,
      status: 'preview',
      title:
        request.productType === 'credits'
          ? `充值 ${product.credits.toLocaleString('zh-CN')} 积分`
          : `开通创作会员 · ${product.title}（${product.months} 个月）`,
      amountFen: product.amountFen,
      qrImageUrl: '/images/payment-qr-placeholder.png',
    }
  },

  async queryPayment(payment, { signal } = {}) {
    signal?.throwIfAborted()
    if (payment.mode !== 'mock' || payment.orderId !== null) {
      throw new Error('支付查询尚未接入，请前往账单确认账户状态。')
    }
    return {
      mode: 'mock',
      status: 'preview',
      message: '真实支付尚未接入，本次未扣款，积分和会员权益未变动。',
    }
  },
}
