import { FileText, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import {
  assignableRoleOptions,
  canManageMembership,
  formatDate,
  roleName,
  shortId,
  statusName,
} from '../adminConsole'

export const complianceSourceLabels = {
  generation_task: '生成任务',
  ai_job: 'AI Job',
}
export const complianceSeverityLabels = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}
export const complianceCategoryLabels = {
  political_sensitive: '政治敏感',
  terrorism: '涉恐/爆炸物',
  sexual_content: '涉黄/性内容',
  graphic_violence: '极端血腥暴力',
  extremism: '极端主义/仇恨',
  self_harm: '自伤自杀',
  other: '其他违法/高危',
}
export function tooltipProps(hint) {
  if (!hint) return {}
  return {
    title: hint,
    'data-tooltip': hint,
    'aria-label': hint,
  }
}

export function disabledButtonProps(disabled, reason, enabledHint) {
  const hint = disabled ? reason || '当前状态下不可操作' : enabledHint
  return {
    disabled,
    ...tooltipProps(hint),
  }
}

const overlayStack = []
let overlayLockCount = 0
let overlaySavedBodyOverflow = ''
let overlayNextId = 1

export function handleOverlayKeydown(event) {
  if (event.key !== 'Escape') return
  const top = overlayStack[overlayStack.length - 1]
  const close = top?.closeRef.current
  if (typeof close !== 'function') return
  event.preventDefault()
  close()
}

export function useOverlayControls(onClose, active = true) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined

    const entry = { id: overlayNextId++, closeRef }
    overlayStack.push(entry)

    if (overlayLockCount === 0) {
      overlaySavedBodyOverflow = document.body.style.overflow
      document.addEventListener('keydown', handleOverlayKeydown)
    }
    overlayLockCount += 1
    document.body.style.overflow = 'hidden'

    return () => {
      const index = overlayStack.findIndex((item) => item.id === entry.id)
      if (index >= 0) overlayStack.splice(index, 1)
      overlayLockCount = Math.max(0, overlayLockCount - 1)
      if (overlayLockCount === 0) {
        document.body.style.overflow = overlaySavedBodyOverflow
        document.removeEventListener('keydown', handleOverlayKeydown)
      }
    }
  }, [active, closeRef])
}

export function billingAdjustmentDisabledReason({
  canManage,
  selectedAccount,
  canManageTarget,
  validAmount,
  hasReason,
  projectedBalance,
  busy,
}) {
  if (!canManage) return '当前身份不能进行账单调账'
  if (!selectedAccount) return '请先选择调账目标'
  if (!canManageTarget) return '当前身份不能调整该账号归属的账单'
  if (!validAmount) return '积分变化必须是非 0 整数'
  if (!hasReason) return '请填写调账原因'
  if (projectedBalance < 0) return '预计余额不能小于 0'
  if (busy) return '正在提交调账'
  return ''
}

export function compactJson(value) {
  const text = JSON.stringify(value ?? {})
  return text.length > 96 ? `${text.slice(0, 93)}...` : text
}

export function Modal({ title, children, onClose, wide = false, titleId = undefined }) {
  const generatedTitleId = useId()
  const resolvedTitleId = titleId ?? generatedTitleId
  useOverlayControls(onClose)
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className={wide ? 'modal wide-modal' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id={resolvedTitleId}>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

export function ModalActions({ busy, valid, onClose, submitLabel }) {
  return (
    <div className="modal-actions">
      <button
        className="row-button"
        type="button"
        {...disabledButtonProps(busy, '正在提交，暂不能取消', '关闭弹窗')}
        onClick={onClose}
      >
        取消
      </button>
      <button
        className="primary-button"
        type="submit"
        {...disabledButtonProps(
          busy || !valid,
          busy ? '正在提交，请稍候' : '请先补齐必填项再提交',
          submitLabel,
        )}
      >
        {busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}
        {submitLabel}
      </button>
    </div>
  )
}

export function DataSection({ title, count, children }) {
  return (
    <section className="data-section">
      <header>
        <h2>{title}</h2>
        <span>{count}</span>
      </header>
      <div className="table-scroll">{children}</div>
    </section>
  )
}

export function DrawerSection({ title, count, children }) {
  return (
    <section className="drawer-section">
      <header>
        <h3>{title}</h3>
        <span>{count}</span>
      </header>
      <div className="drawer-section-body">{children}</div>
    </section>
  )
}

export function AuditActivityList({ entries }) {
  return (
    <div className="drawer-activity-list">
      {entries.slice(0, 8).map((entry) => (
        <article key={entry.id} className="drawer-activity">
          <div>
            <strong>{entry.action}</strong>
            <small>
              {entry.resourceType} · {entry.resourceId ? shortId(entry.resourceId) : '-'}
            </small>
            <small>{compactJson(entry.metadata)}</small>
          </div>
          <span>{formatDate(entry.createdAt)}</span>
        </article>
      ))}
      {!entries.length && <p className="panel-empty">暂无审计记录。</p>}
    </div>
  )
}

export function IdentityCell({ name, detail, compact = false }) {
  return (
    <div className={compact ? 'identity-cell compact' : 'identity-cell'}>
      <span>{name?.slice(0, 1) || '用'}</span>
      <div>
        <strong>{name || '-'}</strong>
        <small>{detail || '-'}</small>
      </div>
    </div>
  )
}

export function ComplianceRiskTags({ tags, expanded = false }) {
  if (!tags.length) return <span className="compliance-risk-empty">未命中</span>
  return (
    <div className={expanded ? 'compliance-risk-tags expanded' : 'compliance-risk-tags'}>
      {tags.map((tag) => {
        const matches = tag.matches ?? []
        const firstMatch = matches[0] ?? null
        const hiddenMatchCount = Math.max(0, matches.length - 1)
        const tagTitle = complianceRiskMatchTitle(tag)
        return expanded ? (
          <article
            key={tag.category}
            className={`compliance-risk-tag detail ${tag.severity}`}
            title={tagTitle}
          >
            <div className="compliance-risk-tag-head">
              <strong>{tag.label}</strong>
              <small>
                {complianceSeverityName(tag.severity)} · {tag.hits}
              </small>
            </div>
            {matches.length ? (
              <ul className="compliance-risk-matches">
                {matches.map((match, index) => (
                  <li key={`${tag.category}:${match.term}:${index}`}>
                    <span>命中：{match.term}</span>
                    <small>{match.reason}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="compliance-risk-match-empty">暂无命中详情</p>
            )}
          </article>
        ) : (
          <span key={tag.category} className={`compliance-risk-tag ${tag.severity}`} title={tagTitle}>
            {tag.label}
            <small>
              {complianceSeverityName(tag.severity)} · {tag.hits}
            </small>
            {firstMatch && (
              <small className="compliance-risk-term">
                命中：{firstMatch.term}
                {hiddenMatchCount ? ` +${hiddenMatchCount}` : ''}
              </small>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function ComplianceRuleEngineExplanation({ item }) {
  const policies = item.riskPolicyMatches ?? []
  const suppressedTags = item.suppressedRiskTags ?? []
  if (!policies.length && !suppressedTags.length) {
    return <p className="panel-empty compact">未应用特殊语境策略，也没有被降噪的命中。</p>
  }
  return (
    <div className="compliance-rule-explanation">
      {policies.length > 0 && (
        <div className="compliance-policy-list">
          <strong>已应用策略</strong>
          {policies.map((policy) => (
            <article key={policy.id}>
              <span>{policy.label}</span>
              <small>{policy.reason}</small>
            </article>
          ))}
        </div>
      )}
      {suppressedTags.length > 0 && (
        <div className="compliance-policy-list">
          <strong>已降噪命中</strong>
          <ComplianceRiskTags tags={suppressedTags} expanded />
        </div>
      )}
    </div>
  )
}

export function complianceRiskMatchTitle(tag) {
  const matches = tag.matches ?? []
  if (!matches.length) return `${tag.label} · ${complianceSeverityName(tag.severity)} · ${tag.hits}`
  return matches.map((match) => `命中：${match.term}\n原因：${match.reason}`).join('\n\n')
}

export function ComplianceReviewBadge({ item }) {
  const status = item.userStatus !== 'active' ? 'disabled' : (item.reviewStatus ?? 'pending')
  return (
    <span className={`compliance-review-badge ${status}`} title={complianceReviewHint(item)}>
      {complianceReviewStatusName(status)}
    </span>
  )
}

export function complianceReviewStatusName(status) {
  const labels = {
    pending: '待审查',
    warned: '已警告',
    reviewed: '已审查',
    disabled: '已封号',
  }
  return labels[status] ?? status
}

export function complianceReviewActionName(action) {
  return action === 'warned' ? '发送警告' : '标记已审查'
}

export function complianceReviewHint(item) {
  if (item.userStatus !== 'active') return '账号已禁用'
  const action = item.lastReviewAction
  if (!action) return '暂无人工审查动作'
  return `${complianceReviewActionName(action.action)} · ${formatDate(action.createdAt)}`
}

export function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}>{statusName(status)}</span>
}

export function paymentStatusName(status) {
  const labels = {
    processed: '已处理',
    ignored: '已忽略',
    failed: '失败',
  }
  return labels[status] ?? status
}

export function PaymentStatusBadge({ status }) {
  return <span className={`payment-status-badge ${status}`}>{paymentStatusName(status)}</span>
}

export function AlertStatusBadge({ status }) {
  return <span className={`alert-status-badge ${status}`}>{reconciliationAlertStatusName(status)}</span>
}

export function alertSeverityName(severity) {
  const labels = {
    warning: '警告',
    critical: '严重',
  }
  return labels[severity] ?? severity
}

export function AlertSeverityBadge({ severity }) {
  return <span className={`alert-severity-badge ${severity}`}>{alertSeverityName(severity)}</span>
}

export function complianceSourceName(source) {
  return complianceSourceLabels[source] ?? source
}

export function complianceSeverityName(severity) {
  return complianceSeverityLabels[severity] ?? severity
}

export function reconciliationAlertStatusName(status) {
  const labels = {
    open: '未处理',
    acknowledged: '已确认',
    resolved: '已解决',
  }
  return labels[status] ?? status
}

export function PasswordResetBadge({ required }) {
  return (
    <span
      className={required ? 'security-badge required' : 'security-badge'}
      title={required ? '账号状态：用户需使用管理员设置的临时密码登录并修改密码' : '密码状态正常'}
    >
      {required ? '首次登录需改密' : '正常'}
    </span>
  )
}

export function StatusPair({ primary, secondary }) {
  return (
    <div className="status-pair">
      <StatusBadge status={primary} />
      {secondary && secondary !== primary && <small>{statusName(secondary)}</small>}
    </div>
  )
}

export function RolePills({ roles }) {
  return (
    <div className="role-pills">
      {roles.map((role) => (
        <span key={role}>{roleName(role)}</span>
      ))}
    </div>
  )
}

export function RoleEditor({ membership, session, busy, onUpdateRole }) {
  const options = assignableRoleOptions(session, membership)
  const currentRole = membership.roles[0] ?? 'member'
  const editable = canManageMembership(session, membership) && !membership.roles.includes('owner')
  const visibleOptions = options.includes(currentRole) ? options : [currentRole, ...options]

  if (!editable || visibleOptions.length < 2) return <RolePills roles={membership.roles} />

  return (
    <label className={busy ? 'role-editor loading' : 'role-editor'}>
      <select
        value={currentRole}
        disabled={busy}
        onChange={(event) => onUpdateRole(membership, event.target.value)}
      >
        {visibleOptions.map((role) => (
          <option key={role} value={role}>
            {roleName(role)}
          </option>
        ))}
      </select>
      {busy && <LoaderCircle size={14} className="spin" />}
    </label>
  )
}

export function OrganizationTypeBadge({ organizationType }) {
  return (
    <span className={`organization-type-badge ${organizationType.type}`} title={organizationType.description}>
      {organizationType.label}
    </span>
  )
}

export function EmptyRow({ visible, columns }) {
  if (!visible) return null
  return (
    <tr>
      <td colSpan={columns}>
        <div className="empty-table">
          <FileText size={15} />
          <div>
            <strong>没有匹配的数据。</strong>
            <span>调整筛选条件后再试，或先创建一条记录。</span>
          </div>
        </div>
      </td>
    </tr>
  )
}
