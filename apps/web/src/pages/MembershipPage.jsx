import {
  ArrowRight,
  Building2,
  Check,
  Crown,
  Gauge,
  LoaderCircle,
  ReceiptText,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { PageHeader } from '../components/ui'
import { MockPaymentDialog } from '../features/billing/MockPaymentDialog'
import { PaymentMethodSelector } from '../features/billing/PaymentMethodSelector'
import { usePaymentCheckout } from '../features/billing/usePaymentCheckout'
import { MEMBER_BENEFITS, MEMBERSHIP_PLANS } from '../features/billing/membershipProducts'
import { formatRechargePrice } from '../features/billing/rechargeProducts'
import './RechargePage.css'
import './MembershipPage.css'

export function MembershipPage({ billing, onOpenBilling, onOpenRecharge, plans = MEMBERSHIP_PLANS }) {
  const [selectedId, setSelectedId] = useState(plans[0]?.id)
  const [paymentMethod, setPaymentMethod] = useState('wechat')
  const { payment, submitting, notice, setNotice, openPayment, closePayment } = usePaymentCheckout()
  const openButtonRef = useRef(null)
  const member = billing?.plan === 'member'
  const organizationScoped = billing?.billingScope === 'organization'
  const selected = plans.find((plan) => plan.id === selectedId) ?? plans[0]
  const canSubscribe = Boolean(billing && selected) && !member && !organizationScoped
  const busy = submitting || Boolean(payment)
  const credits = organizationScoped
    ? (billing.organizationPool?.credits ?? billing.credits)
    : billing?.credits

  return (
    <div className="page recharge-page membership-page">
      <PageHeader eyebrow="账户 / 会员中心" title="创作会员">
        <button className="button secondary" type="button" onClick={onOpenBilling}>
          <ReceiptText size={15} />
          积分账单
        </button>
      </PageHeader>

      <section className="recharge-account" aria-label="会员账户">
        <div className="recharge-balance">
          <span className="recharge-wallet membership-crown">
            <Crown size={24} />
          </span>
          <div>
            <span>当前套餐</span>
            <strong className="membership-current-plan">
              {!billing ? '账户未加载' : organizationScoped ? '组织统一结算' : member ? '创作会员' : '免费版'}
            </strong>
          </div>
        </div>
        <div className="recharge-account-plan">
          <span>{organizationScoped ? '组织共享积分' : '可用积分'}</span>
          <strong>
            {credits?.toLocaleString('zh-CN') ?? '--'}
            <small>积分</small>
          </strong>
        </div>
        <div className="recharge-account-usage">
          <span>当前任务并发</span>
          <strong>
            {billing?.concurrency ?? '--'}
            <small>路</small>
          </strong>
        </div>
      </section>

      {organizationScoped ? (
        <div className="recharge-unavailable" role="status">
          <Building2 size={20} />
          <div>
            <strong>会员权益由组织统一管理</strong>
            <p>组织池由后台充值，请联系组织管理员。</p>
          </div>
        </div>
      ) : (
        <>
          <section className="membership-benefits" aria-label="会员权益">
            <div>
              <span className="membership-benefit-icon">
                <Zap size={21} />
              </span>
              <div>
                <h2>每月 {MEMBER_BENEFITS.monthlyCredits} 积分</h2>
                <p>会员期内按月发放，用于创作任务</p>
              </div>
            </div>
            <div>
              <span className="membership-benefit-icon concurrency">
                <Gauge size={21} />
              </span>
              <div>
                <h2>最多 {MEMBER_BENEFITS.concurrency} 路并发</h2>
                <p>同时处理多个图片或视频任务</p>
              </div>
            </div>
          </section>

          {member && (
            <div className="membership-active-notice" role="status">
              <ShieldCheck size={17} />
              <div>
                <strong>会员已开通</strong>
                <span>当前权益已生效，可前往充值补充创作积分。</span>
              </div>
              <button type="button" className="button secondary" onClick={onOpenRecharge}>
                <Zap size={15} />
                积分充值
              </button>
            </div>
          )}

          <section aria-labelledby="membership-plans-title">
            <div className="recharge-section-title">
              <h2 id="membership-plans-title">{member ? '会员方案' : '选择会员时长'}</h2>
              <span className="recharge-demo-label">模拟价格 · 待确认</span>
            </div>
            <fieldset className="recharge-pack-grid membership-plan-grid" disabled={!billing || busy}>
              <legend className="recharge-sr-only">会员方案</legend>
              {plans.map((plan) => (
                <label className="recharge-pack membership-plan" key={plan.id}>
                  <input
                    type="radio"
                    name="membership-plan"
                    value={plan.id}
                    checked={selected?.id === plan.id}
                    aria-label={`${plan.title}，${plan.months} 个月，${formatRechargePrice(plan.amountFen)} 元`}
                    onChange={() => {
                      setSelectedId(plan.id)
                      setNotice('')
                    }}
                  />
                  <span className="recharge-pack-content">
                    <span className="recharge-pack-top">
                      <strong>{plan.title}</strong>
                      <span className="recharge-pack-check">
                        <Check size={12} />
                      </span>
                    </span>
                    <span className="membership-plan-price">
                      <small>¥</small>
                      <strong>{formatRechargePrice(plan.amountFen)}</strong>
                      <span>/ {plan.months} 个月</span>
                    </span>
                    <span className="membership-plan-period">会员时长 {plan.months} 个月</span>
                    <span className="membership-plan-detail">
                      <Check size={13} />
                      每月 {MEMBER_BENEFITS.monthlyCredits} 积分
                    </span>
                    <span className="membership-plan-detail">
                      <Check size={13} />
                      最多 {MEMBER_BENEFITS.concurrency} 路并发
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>

          <PaymentMethodSelector
            name="membership-payment-method"
            value={paymentMethod}
            onChange={(method) => {
              setPaymentMethod(method)
              setNotice('')
            }}
            disabled={!canSubscribe || busy}
            note="一次性购买，不自动续费"
          />

          <section className="recharge-checkout membership-checkout" aria-label="会员开通确认">
            <div className="recharge-purchase-summary" aria-live="polite">
              <span>已选方案</span>
              <strong>
                {selected?.title ?? '--'}
                {selected && <small>{selected.months} 个月</small>}
              </strong>
            </div>
            <div className="recharge-pay-total" aria-live="polite">
              <span>应付金额</span>
              <strong>
                <small>¥</small>
                {selected ? formatRechargePrice(selected.amountFen) : '--'}
              </strong>
            </div>
            <button
              ref={openButtonRef}
              className="button primary recharge-submit"
              type="button"
              disabled={!canSubscribe || busy}
              onClick={() => {
                if (canSubscribe && !busy) {
                  void openPayment({ productType: 'subscription', productId: selected.id, paymentMethod })
                }
              }}
            >
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Crown size={16} />}
              {member ? '会员已开通' : submitting ? '正在加载' : '立即开通'}
              {!member && <ArrowRight size={16} />}
            </button>
          </section>
          <p className="recharge-feedback" role="status">
            {!billing ? '账户信息暂不可用，请返回账单重新加载。' : !selected ? '暂无可用会员方案。' : notice}
          </p>
          <div className="recharge-footnote">
            <ShieldCheck size={15} />
            <span>当前为模拟支付，暂不扣款或开通会员。</span>
          </div>
        </>
      )}

      {payment && canSubscribe && (
        <MockPaymentDialog payment={payment} onClose={closePayment} returnFocusRef={openButtonRef} />
      )}
    </div>
  )
}
