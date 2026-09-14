import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MembershipPage } from './MembershipPage'

const billing = {
  billingScope: 'membership',
  plan: 'free',
  credits: 120,
  concurrency: 1,
  monthlyUsage: { netCredits: 12 },
}

describe('membership preview', () => {
  it('offers three membership durations without opening payment before selection', () => {
    const html = renderToStaticMarkup(<MembershipPage billing={billing} />)
    expect(html.match(/name="membership-plan"/g)).toHaveLength(3)
    expect(html.match(/name="membership-payment-method"/g)).toHaveLength(2)
    expect(html).toContain('支付宝')
    expect(html).toContain('月度会员')
    expect(html).toContain('季度会员')
    expect(html).toContain('年度会员')
    expect(html).toContain('每月 500 积分')
    expect(html).toContain('最多 3 路并发')
    expect(html).not.toContain('<dialog')
  })

  it('marks an existing member as active and keeps the upgrade action disabled', () => {
    const html = renderToStaticMarkup(<MembershipPage billing={{ ...billing, plan: 'member' }} />)
    expect(html).toContain('会员已开通')
    expect(html).toMatch(/<button[^>]+disabled[^>]*>.*会员已开通/)
    expect(html).toContain('积分充值')
    expect(html).toMatch(/<fieldset class="payment-method-options" disabled=""/)
  })

  it('does not offer a personal membership purchase to organization accounts', () => {
    const html = renderToStaticMarkup(
      <MembershipPage
        billing={{ ...billing, billingScope: 'organization', organizationPool: { credits: 321 } }}
      />,
    )
    expect(html).toContain('会员权益由组织统一管理')
    expect(html).not.toContain('立即开通')
  })

  it('disables purchase when billing has not loaded', () => {
    const html = renderToStaticMarkup(<MembershipPage billing={null} />)
    expect(html).toMatch(/<button[^>]+disabled[^>]*>.*立即开通/)
    expect(html).toContain('账户信息暂不可用')
  })

  it('handles an empty membership catalog', () => {
    const html = renderToStaticMarkup(<MembershipPage billing={billing} plans={[]} />)
    expect(html).toContain('暂无可用会员方案')
    expect(html).toMatch(/<button[^>]+disabled[^>]*>.*立即开通/)
  })
})
