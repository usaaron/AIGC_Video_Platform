import { Building2, CalendarClock, Check, Crown, Gauge, LoaderCircle, ReceiptText, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui'
import { api } from '../services/apiClient'

export function BillingPage({ billing }) {
  const member = billing.plan === 'member'
  const organizationScoped = billing.billingScope === 'organization'
  const availableCredits = organizationScoped
    ? (billing.organizationPool?.credits ?? billing.credits)
    : billing.credits
  const [paymentConfig, setPaymentConfig] = useState(null)
  const [paymentBusy, setPaymentBusy] = useState('')
  const [paymentMessage, setPaymentMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .billingPaymentConfiguration()
      .then((configuration) => {
        if (!cancelled) setPaymentConfig(configuration)
      })
      .catch((error) => {
        if (!cancelled) {
          setPaymentConfig({
            provider: null,
            enabled: false,
            memberSubscriptionEnabled: false,
            creditPurchaseEnabled: false,
            creditPackCredits: null,
          })
          setPaymentMessage(error.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const paymentEnabled = paymentConfig?.enabled === true
  const subscribeEnabled =
    paymentEnabled && paymentConfig.memberSubscriptionEnabled && !member && !organizationScoped
  const creditPurchaseEnabled = paymentEnabled && paymentConfig.creditPurchaseEnabled && !organizationScoped

  const startCheckout = async (type) => {
    setPaymentBusy(type)
    setPaymentMessage('')
    try {
      const checkout =
        type === 'subscription'
          ? await api.createMemberSubscriptionCheckout()
          : await api.createCreditCheckout({ credits: paymentConfig?.creditPackCredits ?? undefined })
      window.location.assign(checkout.url)
    } catch (error) {
      setPaymentMessage(error.message)
      setPaymentBusy('')
    }
  }

  return (
    <div className="page billing-page">
      <PageHeader
        eyebrow="账户 / 积分"
        title="用量与套餐"
        description="每次生成都会进入积分账本；订阅、充值和退款由支付回调自动入账。"
      />
      <section className="billing-summary">
        <div>
          <span className="stat-icon amber">
            <Zap size={19} />
          </span>
          <p>
            {organizationScoped ? '组织共享积分' : '可用积分'}
            <strong>{availableCredits}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon mint">
            <Gauge size={19} />
          </span>
          <p>
            任务并发<strong>{billing.concurrency}</strong>
          </p>
        </div>
        <div>
          <span className="stat-icon blue">
            <CalendarClock size={19} />
          </span>
          <p>
            本月净消耗<strong>{billing.monthlyUsage.netCredits}</strong>
          </p>
        </div>
        <div className="plan-summary">
          <span className="membership-icon">
            {organizationScoped ? <Building2 size={19} /> : <Crown size={19} />}
          </span>
          <div>
            <span className="eyebrow">{organizationScoped ? '组织共享池' : '当前套餐'}</span>
            <h2>{organizationScoped ? '组织统一结算' : member ? '创作会员' : '免费版'}</h2>
            <p>
              {member ? '每月 500 积分，最多 3 路并发。' : '逐个生成任务，按实际生成扣积分。'}
              本月 {billing.monthlyUsage.generationCount} 个任务
              {billing.monthlyUsage.refundedCredits
                ? `，已退 ${billing.monthlyUsage.refundedCredits} 积分`
                : ''}
              。
            </p>
          </div>
          <div className="billing-actions">
            {organizationScoped ? (
              <button className="button" disabled>
                <Building2 size={15} />
                组织池由后台充值
              </button>
            ) : (
              <>
                <button
                  className="button primary"
                  disabled={!subscribeEnabled || paymentBusy === 'subscription'}
                  onClick={() => startCheckout('subscription')}
                >
                  {paymentBusy === 'subscription' ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Crown size={15} />
                  )}
                  {member ? '会员已开通' : '订阅会员'}
                </button>
                <button
                  className="button"
                  disabled={!creditPurchaseEnabled || paymentBusy === 'credits'}
                  onClick={() => startCheckout('credits')}
                >
                  {paymentBusy === 'credits' ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Zap size={15} />
                  )}
                  充值 {paymentConfig?.creditPackCredits ?? '-'} 积分
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      {paymentMessage && <p className="payment-notice">{paymentMessage}</p>}
      {!paymentConfig && <p className="payment-notice">正在读取支付配置...</p>}
      {paymentConfig && !paymentEnabled && (
        <p className="payment-notice">当前环境未启用支付沙箱，订阅和充值入口暂不可用。</p>
      )}
      <section className="ledger-panel">
        <div className="panel-head">
          <div>
            <h2>积分明细</h2>
            <span>最近 30 条变动</span>
          </div>
          <ReceiptText size={18} />
        </div>
        <div className="ledger-list">
          {billing.entries.map((entry) => (
            <div className="ledger-row" key={entry.id}>
              <span className={`ledger-sign ${entry.amount > 0 ? 'positive' : ''}`}>
                {entry.amount > 0 ? '+' : ''}
                {entry.amount}
              </span>
              <div>
                <strong>{entry.description}</strong>
                <span>{new Date(entry.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              <span>余额 {entry.balance}</span>
            </div>
          ))}
          {!billing.entries.length && (
            <div className="empty-state">
              <Check size={24} />
              <h3>暂无积分变动</h3>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
