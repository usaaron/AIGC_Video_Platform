import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RechargePage } from './RechargePage'

const billing = { billingScope: 'membership', plan: 'free', credits: 120, monthlyUsage: { netCredits: 12 } }

describe('recharge preview', () => {
  it('offers six priced choices without showing a QR image before checkout', () => {
    const html = renderToStaticMarkup(<RechargePage billing={billing} />)
    expect(html.match(/name="recharge-pack"/g)).toHaveLength(6)
    expect(html.match(/name="recharge-payment-method"/g)).toHaveLength(2)
    expect(html).toContain('支付宝')
    expect(html).toContain('1,000 积分，88 元')
    expect(html).toContain('10,000 积分，768 元')
    expect(html).toContain('模拟价格')
    expect(html).not.toContain('payment-qr-placeholder.png')
    expect(html).not.toContain('<dialog')
  })

  it('does not offer personal payment for an organization pool', () => {
    const html = renderToStaticMarkup(
      <RechargePage
        billing={{ ...billing, billingScope: 'organization', organizationPool: { credits: 321 } }}
      />,
    )
    expect(html).toContain('组织池由后台充值')
    expect(html).toContain('321')
    expect(html).not.toContain('立即充值')
    expect(html).not.toContain('type="radio"')
  })

  it('disables both package selection and checkout without a loaded billing account', () => {
    const html = renderToStaticMarkup(<RechargePage billing={null} />)
    expect(html).toMatch(/<fieldset[^>]+disabled/)
    expect(html).toMatch(/<button[^>]+disabled[^>]*>.*立即充值/)
    expect(html).toContain('账户积分暂不可用')
  })

  it('handles an empty catalog without a selectable or payable product', () => {
    const html = renderToStaticMarkup(<RechargePage billing={billing} products={[]} />)
    expect(html).toContain('暂无可用充值档位')
    expect(html).toMatch(/<button[^>]+disabled[^>]*>.*立即充值/)
  })

  it('falls back to the first product when fewer than three packs remain', () => {
    const html = renderToStaticMarkup(
      <RechargePage billing={billing} products={[{ id: 'credits-100', credits: 100, amountFen: 1000 }]} />,
    )
    expect(html).toMatch(/name="recharge-pack"[^>]*checked=""[^>]*value="credits-100"/)
    expect(html).not.toContain('暂无可用充值档位')
  })
})
