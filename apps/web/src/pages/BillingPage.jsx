import { CalendarClock, Check, Crown, Gauge, ReceiptText, Zap } from 'lucide-react'
import { PageHeader } from '../components/ui'

export function BillingPage({ billing }) {
  const member = billing.plan === 'member'
  return (
    <div className="page billing-page">
      <PageHeader
        eyebrow="账户 · 积分"
        title="用量与套餐"
        description="每次生成都进入积分账本，会员只提升并发与月度额度。"
      />
      <section className="billing-summary">
        <div>
          <span className="stat-icon amber">
            <Zap size={19} />
          </span>
          <p>
            可用积分<strong>{billing.credits}</strong>
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
            <Crown size={19} />
          </span>
          <div>
            <span className="eyebrow">当前套餐</span>
            <h2>{member ? '创作会员' : '免费版'}</h2>
            <p>
              {member ? '每月 500 积分，最多 3 路并发。' : '逐个生成任务，按实际生成扣积分。'}
              本月 {billing.monthlyUsage.generationCount} 个任务
              {billing.monthlyUsage.refundedCredits
                ? `，已退 ${billing.monthlyUsage.refundedCredits} 积分`
                : ''}
              。
            </p>
          </div>
          <button className="button primary" disabled>
            {member ? '会员已开通' : '联系管理员开通'}
          </button>
        </div>
      </section>
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
