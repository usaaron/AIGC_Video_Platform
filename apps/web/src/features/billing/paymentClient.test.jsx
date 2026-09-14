import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPaymentRequest, paymentClient } from './paymentClient'
import { MockPaymentDialog } from './MockPaymentDialog'

afterEach(() => vi.unstubAllGlobals())

describe('payment adapter boundary', () => {
  it('passes identifiers only, excluding caller-supplied prices, credits and identity', () => {
    expect(
      buildPaymentRequest({
        productType: 'credits',
        productId: 'credits-500',
        paymentMethod: 'alipay',
        amountFen: 1,
        credits: 999999,
        accountId: 'other-account',
        channel: 'jsapi',
      }),
    ).toEqual({
      productType: 'credits',
      productId: 'credits-500',
      paymentMethod: 'alipay',
      channel: 'qr',
    })
  })

  it.each([
    ['credits', 'credits-500', 'wechat', '充值 500 积分', 4500, '微信支付'],
    ['credits', 'credits-500', 'alipay', '充值 500 积分', 4500, '支付宝'],
    ['subscription', 'member-quarter', 'wechat', '季度会员', 12900, '微信支付'],
    ['subscription', 'member-year', 'alipay', '年度会员', 45900, '支付宝'],
  ])(
    'preserves product and provider for %s %s %s without payment writes',
    async (productType, productId, paymentMethod, title, amountFen, providerLabel) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const input = { productType, productId, paymentMethod }
      const payment = await paymentClient.createPayment(input)
      input.paymentMethod = 'changed-after-submit'
      expect(payment).toMatchObject({
        mode: 'mock',
        status: 'preview',
        orderId: null,
        amountFen,
        request: { productType, productId, paymentMethod, channel: 'qr' },
      })
      const html = renderToStaticMarkup(<MockPaymentDialog payment={payment} />)
      expect(html).toContain(title)
      expect(html).toContain(`id="recharge-dialog-title">${providerLabel}`)
      expect(html).toContain('payment-qr-placeholder.png')
      expect(await paymentClient.queryPayment(payment)).toMatchObject({ mode: 'mock', status: 'preview' })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('rejects unsupported providers and mismatched products', async () => {
    expect(() =>
      buildPaymentRequest({ productType: 'credits', productId: 'credits-100', paymentMethod: 'stripe' }),
    ).toThrow()
    await expect(
      paymentClient.createPayment({
        productType: 'subscription',
        productId: 'credits-100',
        paymentMethod: 'wechat',
      }),
    ).rejects.toThrow('商品暂不可用')
  })

  it('does not turn a real order into a mock confirmation', async () => {
    await expect(paymentClient.queryPayment({ mode: 'live', orderId: 'server-order' })).rejects.toThrow(
      '支付查询尚未接入',
    )
  })

  it('honors aborted requests when leaving the account or page', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      paymentClient.createPayment(
        {
          productType: 'credits',
          productId: 'credits-100',
          paymentMethod: 'alipay',
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
