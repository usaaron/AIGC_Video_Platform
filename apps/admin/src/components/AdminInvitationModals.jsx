import { Check, Copy, LoaderCircle, MailPlus, RefreshCw } from 'lucide-react'
import { formatDate, roleName, statusName } from '../adminConsole'
import { disabledButtonProps, Modal, ModalActions, IdentityCell, StatusBadge } from './AdminUi'
import { parseEmailLines } from './adminViewHelpers'
import { organizationInvitationRoleOptions, invitationScopeName, invitationUrlFor } from './adminDomain'
import { InvitationCards } from './AdminOperationPages'
import { LoadingScreen } from './AppChrome'

export function BatchOrganizationInvitationModal({
  form,
  organizations,
  session,
  busy,
  result,
  onChange,
  onClose,
  onSubmit,
  onCopy,
}) {
  const selectedOrganization =
    organizations.find((organization) => organization.id === form.organizationId) ?? organizations[0] ?? null
  const roles = organizationInvitationRoleOptions(session, selectedOrganization)
  const emails = parseEmailLines(form.emails)
  const valid =
    Boolean(selectedOrganization) &&
    roles.includes(form.role) &&
    emails.valid.length > 0 &&
    emails.valid.length <= 100

  const selectOrganization = (organizationId) => {
    const organization = organizations.find((item) => item.id === organizationId)
    const nextRoles = organizationInvitationRoleOptions(session, organization)
    onChange({
      ...form,
      organizationId,
      role: nextRoles.includes(form.role) ? form.role : (nextRoles[0] ?? 'organization_member'),
    })
  }

  return (
    <Modal title="批量邀请组织成员" onClose={onClose} wide>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>企业组织</span>
          <select
            value={form.organizationId}
            onChange={(event) => selectOrganization(event.target.value)}
            disabled={!organizations.length}
            required
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>邀请身份</span>
          <select
            value={form.role}
            onChange={(event) => onChange({ ...form, role: event.target.value })}
            disabled={!roles.length}
            required
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>邮箱列表</span>
          <textarea
            value={form.emails}
            onChange={(event) => onChange({ ...form, emails: event.target.value })}
            placeholder="每行一个邮箱，最多 100 个"
            rows={8}
            required
          />
        </label>
        <div className="batch-summary">
          <span>有效 {emails.valid.length}</span>
          <span>格式错误 {emails.invalid.length}</span>
          <span>去重后邀请 {emails.valid.length}</span>
        </div>
        <p className="modal-hint">批量邀请不会直接创建账号密码；受邀人通过注册链接完成注册并进入企业组织。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="开始批量邀请" />
      </form>
      {result && <BatchInvitationResult result={result} onCopy={onCopy} />}
    </Modal>
  )
}

export function BatchInvitationResult({ result, onCopy }) {
  const successfulText = result.created
    .map((invitation) => `${invitation.email} ${invitationUrlFor(invitation.token)}`)
    .join('\n')
  return (
    <section className="batch-result">
      <header>
        <div>
          <strong>{result.organization.name}</strong>
          <span>
            {roleName(result.role)} · 成功 {result.created.length} · 失败 {result.failed.length}
          </span>
        </div>
        <button
          className="row-button"
          type="button"
          {...disabledButtonProps(!result.created.length, '没有成功生成的邀请码')}
          onClick={() => onCopy(successfulText, '已复制批量邀请链接')}
        >
          <Copy size={14} />
          复制成功链接
        </button>
      </header>
      <div className="batch-result-list">
        {result.created.map((invitation) => (
          <article key={invitation.id}>
            <strong>{invitation.email}</strong>
            <code>{invitationUrlFor(invitation.token)}</code>
          </article>
        ))}
        {result.failed.map((item) => (
          <article key={`failed:${item.email}`} className="failed">
            <strong>{item.email}</strong>
            <span>{item.message}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

export function InvitationResultModal({ invitation, onClose, onCopy }) {
  const invitationUrl = invitationUrlFor(invitation.token)
  const organizationName = invitation.organizationName ?? invitation.tenantName
  const organizationId = invitation.organizationId ?? invitation.tenantId

  return (
    <Modal title="邀请码已创建" onClose={onClose}>
      <div className="invitation-result">
        <IdentityCell name={organizationName} detail={organizationId} />
        <dl className="invitation-meta">
          <div>
            <dt>受邀邮箱</dt>
            <dd>{invitation.email}</dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>{invitationScopeName(invitation.scope)}</dd>
          </div>
          <div>
            <dt>身份</dt>
            <dd>{invitation.roles.map(roleName).join('、')}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{statusName(invitation.status)}</dd>
          </div>
          <div>
            <dt>过期时间</dt>
            <dd>{formatDate(invitation.expiresAt)}</dd>
          </div>
        </dl>
        <label className="copy-field">
          <span>注册链接</span>
          <div>
            <input value={invitationUrl} readOnly onFocus={(event) => event.target.select()} />
            <button
              type="button"
              className="row-button"
              onClick={() => onCopy(invitationUrl, '注册链接已复制')}
            >
              <Copy size={14} />
              复制链接
            </button>
          </div>
        </label>
        <label className="copy-field">
          <span>邀请码</span>
          <div>
            <input value={invitation.token} readOnly onFocus={(event) => event.target.select()} />
            <button
              type="button"
              className="row-button"
              onClick={() => onCopy(invitation.token, '邀请码已复制')}
            >
              <Copy size={14} />
              复制邀请码
            </button>
          </div>
        </label>
        <p className="modal-hint">明文邀请码关闭后不能从数据库还原；需要再次展示时请重新创建邀请。</p>
        <div className="modal-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            <Check size={15} />
            完成
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function OrganizationInvitationsModal({
  organization,
  invitations,
  loading,
  error,
  session,
  busy,
  onCreate,
  onRefresh,
  onReissue,
  onRevoke,
  onClose,
}) {
  const organizationRoles = organizationInvitationRoleOptions(session, organization)
  const canCreate = organization.status === 'active' && organizationRoles.includes('organization_member')
  const pendingCount = invitations.filter((invitation) => invitation.status === 'pending').length

  return (
    <Modal title="组织详情 / 邀请管理" wide onClose={onClose}>
      <div className="organization-invitations">
        <section className="organization-detail-head">
          <IdentityCell name={organization.name} detail={organization.id} />
          <div>
            <span>成员</span>
            <strong>
              {organization.activeMembershipCount} / {organization.membershipCount}
            </strong>
          </div>
          <div>
            <span>待接受邀请</span>
            <strong>{pendingCount}</strong>
          </div>
          <StatusBadge status={organization.status} />
        </section>
        <div className="invitation-toolbar">
          <button className="primary-button" type="button" disabled={!canCreate} onClick={onCreate}>
            <MailPlus size={14} />
            邀请组织成员
          </button>
          <button className="row-button" type="button" disabled={loading} onClick={onRefresh}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新列表
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {loading && !invitations.length ? (
          <LoadingScreen compact label="正在读取邀请列表" />
        ) : (
          <InvitationCards
            invitations={invitations}
            canReissueInvitation={(invitation) =>
              organization.status === 'active' &&
              invitation.roles.every((role) => organizationRoles.includes(role))
            }
            busy={busy}
            onReissue={onReissue}
            onRevoke={onRevoke}
          />
        )}
        <p className="modal-hint">历史邀请只显示状态；明文邀请码只会在创建或重新生成后显示一次。</p>
      </div>
    </Modal>
  )
}
