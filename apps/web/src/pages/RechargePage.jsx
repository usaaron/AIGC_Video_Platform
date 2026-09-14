import {
  ArrowRight,
  Building2,
  Check,
  Coins,
  LoaderCircle,
  ReceiptText,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { PageHeader } from '../components/ui'
import { MockPaymentDialog } from '../features/billing/MockPaymentDialog'
import { PaymentMethodSelector } from '../features/billing/PaymentMethodSelector'
import { usePaymentCheckout } from '../features/billing/usePaymentCheckout'
import { formatRechargePrice, RECHARGE_PACKS } from '../features/billing/rechargeProducts'
import './RechargePage.css'

export function RechargePage({ billing, onOpenBilling, products = RECHARGE_PACKS }) {
  const rechargeButtonRef = useRef(null)
  const [selectedId, setSelectedId] = useState(products[2]?.id ?? products[0]?.id)
  const [paymentMethod, setPaymentMethod] = useState('wechat')
  const { payment, submitting, notice, setNotice, openPayment, closePayment } = usePaymentCheckout()
  const organizationScoped = billing?.billingScope === 'organization'
  const availableCredits = organizationScoped
    ? (billing.organizationPool?.credits ?? billing.credits)
    : billing?.credits
  const product = products.find((pack) => pack.id === selectedId) ?? products[0]
  const canRecharge = Boolean(billing && product) && !organizationScoped
  const busy = submitting || Boolean(payment)

  return (
    <div className="page recharge-page">
      <PageHeader eyebrow="账户 / 积分充值" title="积分充值">
        <button className="button secondary" type="button" onClick={onOpenBilling}>
          <ReceiptText size={15} />
          积分账单
        </button>
      </PageHeader>

      <section className="recharge-account" aria-label="积分账户">
        <div className="recharge-balance">
          <span className="recharge-wallet">
            <Wallet size={23} />
          </span>
          <div>
            <span>{organizationScoped ? '组织共享积分' : '当前可用积分'}</span>
            <strong>
              {availableCredits?.toLocaleString('zh-CN') ?? '--'}
              <small>积分</small>
            </strong>
          </div>
        </div>
        <div className="recharge-account-plan">
          <span>当前套餐</span>
          <strong>
            {!billing
              ? '账户未加载'
              : organizationScoped
                ? '组织统一结算'
                : billing.plan === 'member'
                  ? '创作会员'
                  : '免费版'}
          </strong>
        </div>
        <div className="recharge-account-usage">
          <span>本月净消耗</span>
          <strong>
            {billing?.monthlyUsage?.netCredits?.toLocaleString('zh-CN') ?? '--'}
            <small>积分</small>
          </strong>
        </div>
      </section>

      {organizationScoped ? (
        <div className="recharge-unavailable" role="status">
          <Building2 size={20} />
          <div>
            <strong>组织池由后台充值</strong>
            <p>当前账户使用组织共享积分，请联系组织管理员。</p>
          </div>
        </div>
      ) : (
        <>
          <section className="recharge-selection" aria-labelledby="recharge-selection-heading">
            <div className="recharge-section-title">
              <h2 id="recharge-selection-heading">选择充值额度</h2>
              <span className="recharge-demo-label">模拟价格 · 待确认</span>
            </div>
            <fieldset className="recharge-pack-grid" disabled={!canRecharge || busy}>
              <legend className="recharge-sr-only">充值档位</legend>
              {products.map((pack) => (
                <label className="recharge-pack" key={pack.id}>
                  <input
                    type="radio"
                    name="recharge-pack"
                    value={pack.id}
                    checked={product?.id === pack.id}
                    onChange={() => {
                      setSelectedId(pack.id)
                      setNotice('')
                    }}
                    aria-label={`${pack.credits.toLocaleString('zh-CN')} 积分，${formatRechargePrice(pack.amountFen)} 元`}
                  />
                  <span className="recharge-pack-content">
                    <span className="recharge-pack-top">
                      <span>{pack.label}</span>
                      <span className="recharge-pack-check">
                        <Check size={12} />
                      </span>
                    </span>
                    <span className="recharge-pack-credits">
                      <Coins size={19} />
                      <strong>{pack.credits.toLocaleString('zh-CN')}</strong>
                      <small>积分</small>
                    </span>
                    <span className="recharge-pack-price">
                      <span>¥</span>
                      <strong>{formatRechargePrice(pack.amountFen)}</strong>
                      <small>一次性</small>
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>

          <PaymentMethodSelector
            name="recharge-payment-method"
            value={paymentMethod}
            onChange={(method) => {
              setPaymentMethod(method)
              setNotice('')
            }}
            disabled={!canRecharge || busy}
            note="一次性充值，不自动续费"
          />

          <section className="recharge-checkout" aria-label="充值确认">
            <div className="recharge-purchase-summary" aria-live="polite">
              <span>已选额度</span>
              <strong>
                {product?.credits.toLocaleString('zh-CN') ?? '--'}
                <small>积分</small>
              </strong>
            </div>
            <div className="recharge-pay-total" aria-live="polite">
              <span>应付金额</span>
              <strong>
                <small>¥</small>
                {product ? formatRechargePrice(product.amountFen) : '--'}
              </strong>
            </div>
            <button
              ref={rechargeButtonRef}
              className="button primary recharge-submit"
              type="button"
              disabled={!canRecharge || busy}
              onClick={() => {
                if (canRecharge && !busy) {
                  void openPayment({ productType: 'credits', productId: product.id, paymentMethod })
                }
              }}
            >
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Zap size={16} />}
              {submitting ? '正在加载' : '立即充值'}
              <ArrowRight size={16} />
            </button>
          </section>
          <p className="recharge-feedback" role="status">
            {!billing ? '账户积分暂不可用，请返回账单重新加载。' : !product ? '暂无可用充值档位。' : notice}
          </p>
          <div className="recharge-footnote">
            <ShieldCheck size={15} />
            <span>当前为模拟支付，暂不扣款或增加积分。</span>
          </div>
        </>
      )}

      {payment && canRecharge && (
        <MockPaymentDialog payment={payment} onClose={closePayment} returnFocusRef={rechargeButtonRef} />
      )}
    </div>
  )
}
