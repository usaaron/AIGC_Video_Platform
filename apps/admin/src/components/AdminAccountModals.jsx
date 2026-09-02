import {
  assignableRoleOptions,
  addExistingOrganizationMemberRoleOptions,
  canAddExistingOrganizationMember,
  roleName,
} from '../adminConsole'
import { Modal, ModalActions, IdentityCell } from './AdminUi'
import {
  roleRequiresOrganization,
  personalAccountRoleOptions,
  systemAccountRoleOptions,
  accountScopeDescription,
  canCreatePlatformInvitation,
  organizationInvitationRoleOptions,
} from './adminDomain'

export function RenameOrganizationModal({ organization, form, busy, onChange, onClose, onSubmit }) {
  const valid = form.name.trim().length > 0 && form.name.trim() !== organization.name
  return (
    <Modal title="重命名企业组织" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <IdentityCell name={organization.name} detail={organization.id} />
        <label>
          <span>新组织名称</span>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <p className="modal-hint">组织名称会影响运营检索和客户后台显示，不会改变组织 ID。</p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="重命名组织" />
      </form>
    </Modal>
  )
}

export function CreateOrganizationModal({ form, busy, onChange, onClose, onSubmit }) {
  const valid = form.name.trim().length > 0
  return (
    <Modal title="创建企业组织" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>组织名称</span>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <p className="modal-hint">
          后台创建企业组织不会切换当前登录 session；创建后可加入已有账号或直接创建组织账号。
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建企业组织" />
      </form>
    </Modal>
  )
}

export function CreateOrganizationWithAdminModal({ form, busy, onChange, onClose, onSubmit }) {
  const valid =
    form.organizationName.trim().length > 0 &&
    form.adminEmail.trim().includes('@') &&
    form.adminName.trim().length > 0 &&
    form.adminPassword.length >= 8

  return (
    <Modal title="创建企业组织+首个管理员" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>企业组织名称</span>
          <input
            value={form.organizationName}
            onChange={(event) => onChange({ ...form, organizationName: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label>
          <span>管理员邮箱</span>
          <input
            type="email"
            value={form.adminEmail}
            onChange={(event) => onChange({ ...form, adminEmail: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>管理员姓名</span>
          <input
            value={form.adminName}
            onChange={(event) => onChange({ ...form, adminName: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label>
          <span>初始临时密码</span>
          <input
            type="password"
            value={form.adminPassword}
            onChange={(event) => onChange({ ...form, adminPassword: event.target.value })}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <small>管理员首次登录后仍会被要求设置自己的新密码。</small>
        </label>
        <p className="modal-hint">
          该向导会先创建企业组织，再直接创建 organization_admin 账号；如果第二步失败，已创建的企业组织会保留。
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="创建组织和管理员" />
      </form>
    </Modal>
  )
}

export function CreateOrganizationUserModal({
  form,
  organizations,
  roleOptions,
  session,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const isOrganizationScope = form.scope === 'organization'
  const isSystemScope = form.scope === 'system'
  const organizationOptions = organizations.filter(
    (organization) =>
      organization.status === 'active' &&
      assignableRoleOptions(session, organization).some(roleRequiresOrganization),
  )
  const scopeOptions = [
    personalAccountRoleOptions(session).length
      ? { value: 'personal', label: '个人空间', description: accountScopeDescription('personal') }
      : null,
    systemAccountRoleOptions(session).length
      ? { value: 'system', label: '系统组织', description: accountScopeDescription('system') }
      : null,
    organizationOptions.length
      ? { value: 'organization', label: '企业组织', description: accountScopeDescription('organization') }
      : null,
  ].filter(Boolean)
  const valid =
    scopeOptions.some((option) => option.value === form.scope) &&
    (!isOrganizationScope || form.organizationId) &&
    form.email.trim().includes('@') &&
    form.name.trim().length > 0 &&
    form.password.length >= 8 &&
    roleOptions.includes(form.role)

  const selectScope = (scope) => {
    if (scope === 'organization') {
      const organization =
        organizationOptions.find((item) => item.id === form.organizationId) ?? organizationOptions[0]
      const roles = organization
        ? assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
        : []
      onChange({
        ...form,
        scope,
        organizationId: organization?.id ?? '',
        role: roles.includes(form.role) ? form.role : (roles[0] ?? form.role),
      })
      return
    }
    const roles = scope === 'system' ? systemAccountRoleOptions(session) : personalAccountRoleOptions(session)
    onChange({
      ...form,
      scope,
      organizationId: '',
      role: roles.includes(form.role) ? form.role : (roles[0] ?? form.role),
    })
  }

  const selectRole = (role) => {
    if (!isOrganizationScope) {
      onChange({ ...form, role, organizationId: '' })
      return
    }
    const nextOrganizations = organizationOptions.filter(
      (organization) =>
        organization.status === 'active' && assignableRoleOptions(session, organization).includes(role),
    )
    onChange({
      ...form,
      role,
      organizationId: roleRequiresOrganization(role)
        ? (nextOrganizations.find((organization) => organization.id === form.organizationId)?.id ??
          nextOrganizations[0]?.id ??
          '')
        : '',
    })
  }

  const selectOrganization = (organizationId) => {
    const organization = organizationOptions.find((item) => item.id === organizationId)
    const roles = organization
      ? assignableRoleOptions(session, organization).filter(roleRequiresOrganization)
      : []
    onChange({
      ...form,
      organizationId,
      role: roles.includes(form.role) ? form.role : (roles[0] ?? form.role),
    })
  }

  return (
    <Modal
      title={
        isOrganizationScope ? '直接创建组织账号' : isSystemScope ? '直接创建系统账号' : '直接创建个人账号'
      }
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>姓名</span>
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label>
          <span>初始临时密码</span>
          <input
            type="password"
            value={form.password}
            onChange={(event) => onChange({ ...form, password: event.target.value })}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <small>至少 8 位。创建后交给用户首次登录；系统会立即要求用户设置自己的新密码。</small>
        </label>
        <label>
          <span>账号范围</span>
          <select value={form.scope} onChange={(event) => selectScope(event.target.value)} required>
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>{accountScopeDescription(form.scope)}</small>
        </label>
        <label>
          <span>身份</span>
          <select value={form.role} onChange={(event) => selectRole(event.target.value)} required>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </select>
        </label>
        {isOrganizationScope ? (
          <label>
            <span>企业组织</span>
            <select
              value={form.organizationId}
              onChange={(event) => selectOrganization(event.target.value)}
              disabled={!organizationOptions.length}
              required
            >
              {organizationOptions.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="modal-hint">范围：{accountScopeDescription(form.scope)}</p>
        )}
        <ModalActions
          busy={busy}
          valid={valid}
          onClose={onClose}
          submitLabel={
            isOrganizationScope ? '直接创建组织账号' : isSystemScope ? '直接创建系统账号' : '直接创建个人账号'
          }
        />
      </form>
    </Modal>
  )
}

export function AddExistingMemberModal({
  form,
  organizations,
  roleOptions,
  session,
  busy,
  onChange,
  onClose,
  onSubmit,
}) {
  const organizationOptions = organizations.filter((organization) =>
    canAddExistingOrganizationMember(session, organization),
  )
  const selectedOrganization =
    organizationOptions.find((organization) => organization.id === form.organizationId) ?? null
  const roles = roleOptions.length
    ? roleOptions
    : addExistingOrganizationMemberRoleOptions(session, selectedOrganization)
  const valid = Boolean(selectedOrganization) && form.email.trim().includes('@') && roles.includes(form.role)

  const selectOrganization = (organizationId) => {
    const organization = organizationOptions.find((item) => item.id === organizationId)
    const nextRoles = addExistingOrganizationMemberRoleOptions(session, organization)
    onChange({
      ...form,
      organizationId,
      role: nextRoles.includes(form.role) ? form.role : (nextRoles[0] ?? form.role),
    })
  }

  return (
    <Modal title="加入已有账号" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>组织</span>
          <select
            value={form.organizationId}
            onChange={(event) => selectOrganization(event.target.value)}
            disabled={!organizationOptions.length}
            required
          >
            {organizationOptions.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>已有账号邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>加入后的身份</span>
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
        <p className="modal-hint">
          该账号必须已经存在且未被禁用；加入组织不会重置密码或切换当前后台 session。
        </p>
        <ModalActions busy={busy} valid={valid} onClose={onClose} submitLabel="加入组织" />
      </form>
    </Modal>
  )
}

export function CreateInvitationModal({ form, organizations, session, busy, onChange, onClose, onSubmit }) {
  const needsOrganization = form.kind === 'organization'
  const roleLabel = roleName(form.role)
  const canInvitePlatformMember = canCreatePlatformInvitation(session)
  const organizationScopeOptions = organizations.filter(
    (organization) => organizationInvitationRoleOptions(session, organization).length > 0,
  )
  const selectedOrganization =
    organizationScopeOptions.find((organization) => organization.id === form.organizationId) ??
    organizationScopeOptions[0] ??
    null
  const organizationRoleOptions = selectedOrganization
    ? organizationInvitationRoleOptions(session, selectedOrganization)
    : []
  const valid =
    form.email.trim().includes('@') &&
    (needsOrganization
      ? Boolean(selectedOrganization) && organizationRoleOptions.includes(form.role)
      : canInvitePlatformMember)

  const selectKind = (kind) => {
    if (kind === 'organization') {
      const organization = selectedOrganization ?? organizationScopeOptions[0]
      const roles = organization ? organizationInvitationRoleOptions(session, organization) : []
      onChange({
        ...form,
        kind,
        organizationId: organization?.id ?? '',
        role: roles.includes(form.role) ? form.role : (roles[0] ?? 'organization_member'),
      })
      return
    }
    onChange({ ...form, kind, organizationId: '', role: 'member' })
  }

  const selectOrganization = (organizationId) => {
    const organization = organizationScopeOptions.find((item) => item.id === organizationId)
    const roles = organization ? organizationInvitationRoleOptions(session, organization) : []
    onChange({
      ...form,
      organizationId,
      role: roles.includes(form.role) ? form.role : (roles[0] ?? form.role),
    })
  }

  return (
    <Modal title="创建邀请" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          <span>受邀邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>邀请范围</span>
          <select value={form.kind} onChange={(event) => selectKind(event.target.value)} required>
            {canInvitePlatformMember && <option value="platform">个人空间</option>}
            {organizationScopeOptions.length > 0 && <option value="organization">企业组织</option>}
          </select>
          <small>
            {needsOrganization ? '受邀人注册后进入指定企业组织。' : '受邀人注册后自动创建自己的个人空间。'}
          </small>
        </label>
        {needsOrganization ? (
          <>
            <label>
              <span>企业组织</span>
              <select
                value={form.organizationId}
                onChange={(event) => selectOrganization(event.target.value)}
                disabled={!organizationScopeOptions.length}
                required
              >
                {organizationScopeOptions.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name} · {organization.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>身份</span>
              <select
                value={form.role}
                onChange={(event) => onChange({ ...form, role: event.target.value })}
                disabled={!organizationRoleOptions.length}
                required
              >
                {organizationRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {roleName(role)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <p className="modal-hint">身份：普通成员。注册后会自动创建个人空间。</p>
        )}
        <p className="modal-hint">邀请码只在创建后显示一次，同时会按邮件配置发送邀请邮件。</p>
        <ModalActions
          busy={busy}
          valid={valid}
          onClose={onClose}
          submitLabel={needsOrganization ? `邀请${roleLabel}` : '邀请成员'}
        />
      </form>
    </Modal>
  )
}
