import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { useId } from 'react'
import { shortId } from '../adminConsole'
import {
  complianceCategoryLabels,
  disabledButtonProps,
  Modal,
  ModalActions,
  IdentityCell,
  alertSeverityName,
  reconciliationAlertStatusName,
} from './AdminUi'
import { organizationAdminTransferCandidates } from './adminDataHelpers'

export function OrganizationAdminTransferModal({
  organization,
  memberships,
  form,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const candidates = organizationAdminTransferCandidates(memberships, organization.id)
  const current = memberships.find(
    (membership) =>
      membership.tenantId === organization.id && membership.userId === form.currentOrganizationAdminUserId,
  )
  const valid = Boolean(form.currentOrganizationAdminUserId && form.targetUserId)
  return (
    <Modal title="更换组织负责人" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={organization.name} detail={organization.id} />
        <label>
          <span>当前负责人</span>
          <select
            value={form.currentOrganizationAdminUserId}
            onChange={(event) => onChange({ ...form, currentOrganizationAdminUserId: event.target.value })}
            disabled={!current}
            required
          >
            {current && (
              <option value={current.userId}>
                {current.name} · {current.email ?? current.userId}
              </option>
            )}
          </select>
        </label>
        <label>
          <span>新负责人</span>
          <select
            value={form.targetUserId}
            onChange={(event) => onChange({ ...form, targetUserId: event.target.value })}
            disabled={!candidates.length}
            required
          >
            {candidates.map((membership) => (
              <option key={membership.id} value={membership.userId}>
                {membership.name} · {membership.email ?? membership.userId}
              </option>
            ))}
          </select>
        </label>
        <p className="modal-hint">当前负责人将降为组织成员，平台所有者不会变化。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="确认更换" />
      </form>
    </Modal>
  )
}

export function ReconciliationAlertActionModal({
  alert,
  status,
  message,
  organizationName,
  busy,
  onMessageChange,
  onClose,
  onSubmit,
}) {
  const actionLabel = status === 'acknowledged' ? '确认告警' : '解决告警'
  const valid = message.trim().length > 0 && message.trim().length <= 200
  return (
    <Modal title={actionLabel} onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <dl className="invitation-meta">
          <div>
            <dt>组织</dt>
            <dd>{organizationName}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{reconciliationAlertStatusName(alert.status)}</dd>
          </div>
          <div>
            <dt>严重性</dt>
            <dd>{alertSeverityName(alert.severity)}</dd>
          </div>
          <div>
            <dt>事件</dt>
            <dd>{alert.eventType}</dd>
          </div>
        </dl>
        <div className="alert-action-summary">
          <strong>{alert.alertType}</strong>
          <span>
            {alert.provider} · {shortId(alert.providerEventId)}
          </span>
          <p>{alert.message}</p>
        </div>
        <label>
          <span>处理备注</span>
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            maxLength={200}
            rows={4}
            required
          />
        </label>
        <p className="modal-hint">备注会写回对账告警记录，便于后续审计和复盘。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel={actionLabel} />
      </form>
    </Modal>
  )
}

export function CompliancePromptActionModal({ item, form, busy, onChange, onClose, onSubmit }) {
  const actionLabel = form.action === 'warned' ? '发送警告' : '标记已审查'
  const valid = form.reason.trim().length > 0
  return (
    <Modal title={actionLabel} onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>处理动作</span>
          <select value={form.action} onChange={(event) => onChange({ ...form, action: event.target.value })}>
            <option value="reviewed">标记已审查</option>
            <option value="warned">发送警告</option>
          </select>
        </label>
        <label>
          <span>风险类别</span>
          <select
            value={form.category}
            onChange={(event) => onChange({ ...form, category: event.target.value })}
          >
            <option value="">不指定</option>
            {Object.entries(complianceCategoryLabels).map(([category, label]) => (
              <option key={category} value={category}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>备注</span>
          <textarea
            value={form.reason}
            onChange={(event) => onChange({ ...form, reason: event.target.value })}
            placeholder="记录人工审查结论或警告原因"
            required
          />
        </label>
        <p className="modal-hint">
          处理记录会写入审计日志；当前阶段不会自动发送站内信。目标账号：{item.email ?? item.userId}
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel={actionLabel} />
      </form>
    </Modal>
  )
}

export function ActionConfirmModal({ request, busy, onCancel, onConfirm }) {
  const details = request.details ?? []
  const titleId = useId()
  return (
    <Modal title={request.title} onClose={busy ? () => {} : onCancel} titleId={titleId}>
      <div className={`confirm-panel ${request.tone ?? 'default'}`} aria-labelledby={titleId}>
        {request.summary && <p>{request.summary}</p>}
        {request.message && <pre>{request.message}</pre>}
        {details.length > 0 && (
          <dl>
            {details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd className={detail.tone ?? ''}>{detail.value ?? '-'}</dd>
              </div>
            ))}
          </dl>
        )}
        {request.impact && <p className="confirm-impact">{request.impact}</p>}
      </div>
      <div className="modal-actions">
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(busy, '正在处理，暂不能取消', '关闭确认弹窗')}
          onClick={onCancel}
        >
          {request.cancelLabel ?? '取消'}
        </button>
        <button
          className={request.tone === 'danger' ? 'row-button danger solid' : 'primary-button'}
          type="button"
          {...disabledButtonProps(busy, '正在处理，请稍候', request.confirmLabel ?? '确认')}
          onClick={onConfirm}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}
          {request.confirmLabel ?? '确认'}
        </button>
      </div>
    </Modal>
  )
}
