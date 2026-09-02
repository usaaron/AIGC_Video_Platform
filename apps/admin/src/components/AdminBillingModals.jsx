import { LoaderCircle, RefreshCw } from 'lucide-react'
import { formatDate, formatSignedAmount, ledgerTypeName, planName, shortId } from '../adminConsole'
import { Modal, ModalActions, DataSection, IdentityCell, EmptyRow } from './AdminUi'
import { BillingOwnershipHint } from './AdminBillingPages'

export function AdjustmentModal({ target, form, busy, onChange, onClose, onSubmit }) {
  const amount = Number(form.amount)
  const valid = Number.isInteger(amount) && amount !== 0 && form.reason.trim().length > 0
  return (
    <Modal title="后台调账" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={target.name} detail={`${target.tenantName} · ${target.email ?? target.userId}`} />
        <BillingOwnershipHint target={target} />
        <label>
          <span>积分变化</span>
          <input
            type="number"
            value={form.amount}
            onChange={(event) => onChange({ ...form, amount: event.target.value })}
            min="-1000000"
            max="1000000"
            required
          />
        </label>
        <label>
          <span>原因</span>
          <input
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            maxLength={200}
            required
          />
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="提交调账" />
      </form>
    </Modal>
  )
}

export function GrantModal({ form, busy, onChange, onClose, onSubmit }) {
  const amount = Number(form.amount)
  const valid = Number.isInteger(amount) && amount > 0 && form.reason.trim().length > 0
  return (
    <Modal title="当前账号充值" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>积分</span>
          <input
            type="number"
            value={form.amount}
            onChange={(event) => onChange({ ...form, amount: event.target.value })}
            min="1"
            max="1000000"
            required
          />
        </label>
        <label>
          <span>原因</span>
          <input
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            maxLength={200}
            required
          />
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="提交充值" />
      </form>
    </Modal>
  )
}

export function OrganizationBillingModal({
  organization,
  summary,
  loading,
  error,
  form,
  canManage,
  busy,
  onChange,
  onRefresh,
  onClose,
  onSubmit,
}) {
  const amount = Number(form.amount)
  const validAmount = Number.isInteger(amount) && amount !== 0
  const currentCredits = summary?.credits ?? null
  const projectedBalance = currentCredits !== null && validAmount ? currentCredits + amount : null
  const valid =
    canManage &&
    Boolean(summary) &&
    validAmount &&
    form.reason.trim().length > 0 &&
    projectedBalance !== null &&
    projectedBalance >= 0
  const entries = summary?.entries ?? []

  return (
    <Modal title="组织共享积分池" onClose={onClose} wide>
      <div className="modal-form">
        <div className="section-actions">
          <IdentityCell name={organization.name} detail={organization.id} />
          <button className="row-button" type="button" disabled={loading} onClick={onRefresh}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新余额
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <BillingOwnershipHint target={organization} scope="organization" />
        <div className="drawer-summary-grid">
          <div>
            <span>当前组织余额</span>
            <strong>{loading && !summary ? '读取中' : (summary?.credits ?? '-')}</strong>
          </div>
          <div>
            <span>预计余额</span>
            <strong>{projectedBalance === null ? '-' : projectedBalance}</strong>
          </div>
          <div>
            <span>本月净消耗</span>
            <strong>{summary?.monthlyUsage?.netCredits ?? '-'}</strong>
          </div>
          <div>
            <span>本月任务</span>
            <strong>{summary?.monthlyUsage?.generationCount ?? '-'}</strong>
          </div>
        </div>
      </div>
      <form className="modal-form" onSubmit={onSubmit}>
        <div className="adjustment-fields">
          <label>
            <span>组织积分变化</span>
            <input
              type="number"
              value={form.amount}
              onChange={(event) => onChange({ ...form, amount: event.target.value })}
              min="-1000000"
              max="1000000"
              disabled={!canManage || loading}
              required
            />
          </label>
          <label>
            <span>调账原因</span>
            <input
              value={form.reason}
              onChange={(event) => onChange({ ...form, reason: event.target.value })}
              maxLength={200}
              disabled={!canManage || loading}
              required
            />
          </label>
        </div>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="提交组织调账" />
      </form>
      <DataSection title="组织池最近流水" count={entries.length}>
        <table className="data-table ledger">
          <thead>
            <tr>
              <th>类型</th>
              <th>金额</th>
              <th>余额</th>
              <th>Membership</th>
              <th>描述</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 12).map((entry) => (
              <tr key={entry.id}>
                <td>{ledgerTypeName(entry.type)}</td>
                <td className={entry.amount >= 0 ? 'amount positive' : 'amount negative'}>
                  {formatSignedAmount(entry.amount)}
                </td>
                <td>{entry.balance}</td>
                <td>{shortId(entry.membershipId)}</td>
                <td>{entry.description}</td>
                <td>{formatDate(entry.createdAt)}</td>
              </tr>
            ))}
            <EmptyRow visible={!entries.length} columns={6} />
          </tbody>
        </table>
      </DataSection>
    </Modal>
  )
}

export function MembershipPlanModal({ membership, form, busy, onChange, onClose, onSubmit }) {
  const valid = form.plan === 'free' || form.plan === 'member'
  const nextGrantMonthlyCredits = form.plan === 'member' && form.grantMonthlyCredits

  return (
    <Modal title="改套餐 / 冲会员" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell
          name={membership.name}
          detail={`${membership.tenantName ?? membership.tenantId} · ${membership.email ?? membership.userId}`}
        />
        <BillingOwnershipHint target={membership} />
        <div className="drawer-summary-grid">
          <div>
            <span>当前套餐</span>
            <strong>{planName(membership.plan)}</strong>
          </div>
          <div>
            <span>当前积分</span>
            <strong>{membership.credits}</strong>
          </div>
        </div>
        <label>
          <span>目标套餐</span>
          <select
            value={form.plan}
            onChange={(event) =>
              onChange({
                ...form,
                plan: event.target.value,
                grantMonthlyCredits: event.target.value === 'member',
              })
            }
            required
          >
            <option value="free">{planName('free')}</option>
            <option value="member">{planName('member')}</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={nextGrantMonthlyCredits}
            disabled={form.plan !== 'member'}
            onChange={(event) => onChange({ ...form, grantMonthlyCredits: event.target.checked })}
          />
          <span>升级/续费会员时发放本月会员积分</span>
        </label>
        <label>
          <span>备注</span>
          <input
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            maxLength={200}
            placeholder="可选"
          />
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="保存套餐" />
      </form>
    </Modal>
  )
}

export function PasswordResetModal({ target, form, busy, onChange, onClose, onSubmit }) {
  const passwordLength = form.newPassword.length
  const valid = passwordLength >= 8 && passwordLength <= 128
  return (
    <Modal title="设置临时密码" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={target.name} detail={target.email ?? target.id} />
        <label>
          <span>临时密码</span>
          <input
            type="password"
            value={form.newPassword}
            onChange={(event) => onChange({ ...form, newPassword: event.target.value })}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.requireChange}
            onChange={(event) => onChange({ ...form, requireChange: event.target.checked })}
          />
          <span>要求用户登录后再次修改密码</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.revokeSessions}
            onChange={(event) => onChange({ ...form, revokeSessions: event.target.checked })}
          />
          <span>撤销该账号现有 session</span>
        </label>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="设置临时密码" />
      </form>
    </Modal>
  )
}
