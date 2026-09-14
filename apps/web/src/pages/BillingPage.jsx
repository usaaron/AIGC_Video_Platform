import {
  Building2,
  CalendarClock,
  Check,
  Crown,
  Gauge,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui'
import './BillingPage.css'

export function BillingPage({ billing, onRefreshBilling, onOpenRecharge, onOpenMembership }) {
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const member = billing.plan === 'member'
  const organizationScoped = billing.billingScope === 'organization'
  const credits = organizationScoped
    ? (billing.organizationPool?.credits ?? billing.credits)
    : billing.credits

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setMessage('')
    try {
      await onRefreshBilling()
      setMessage('账单已刷新')
    } catch {
      setMessage('账单刷新失败，请稍后重试。')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="page billing-page">
      <PageHeader eyebrow="账户 / 积分" title="用量与套餐">
        {!organizationScoped && (
          <button className="button secondary" type="button" onClick={onOpenMembership}>
            <Crown size={15} />
            会员中心
          </button>
        )}
        {!organizationScoped && (
          <button className="button primary" type="button" onClick={onOpenRecharge}>
            <Zap size={15} />
            积分充值
          </button>
        )}
      </PageHeader>
      <section className="billing-summary" aria-label="账户概览">
        <div>
          <span className="stat-icon amber">
            <Zap size={19} />
          </span>
          <p>
            {organizationScoped ? '组织共享积分' : '可用积分'}
            <strong>{credits.toLocaleString('zh-CN')}</strong>
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
            <span className="eyebrow">当前套餐</span>
            <h2>{organizationScoped ? '组织统一结算' : member ? '创作会员' : '免费版'}</h2>
            <p>
              {organizationScoped
                ? '使用组织共享积分，额度由组织统一管理。'
                : member
                  ? '每月 500 积分，最多 3 路并发。'
                  : '按实际生成任务扣除积分。'}{' '}
              本月 {billing.monthlyUsage.generationCount} 个任务。
            </p>
          </div>
        </div>
      </section>
      {organizationScoped && (
        <p className="billing-account-note">
          <Building2 size={15} />
          组织池由后台充值
        </p>
      )}
      <section className="ledger-panel">
        <div className="panel-head">
          <div>
            <h2>
              <ReceiptText size={16} />
              积分明细
            </h2>
            <span>最近 30 条变动</span>
          </div>
          <button className="button secondary" type="button" disabled={refreshing} onClick={refresh}>
            {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}刷新账单
          </button>
        </div>
        <p className="billing-refresh-message" role="status">
          {message}
        </p>
        <div className="ledger-list">
          {billing.entries.map((entry) => (
            <div className="ledger-row" key={entry.id}>
              <span className={'ledger-sign ' + (entry.amount > 0 ? 'positive' : '')}>
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
