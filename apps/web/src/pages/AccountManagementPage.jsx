import {
  Check,
  Crown,
  DoorOpen,
  KeyRound,
  LoaderCircle,
  Pencil,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../components/AuthProvider'
import { IconButton, PageHeader } from '../components/ui'
import { canOpenAccountAdmin } from '../features/account/access'
import { api, AUTH_EXPIRED_EVENT } from '../services/apiClient'
import {
  assignableRoleOptions,
  identityRolesFor,
  MemberAdminTable,
  Metric,
  PanelHeading,
  roleFilterOptions,
  roleName,
  SessionList,
} from './AccountManagementParts'

const createUserInitialState = { email: '', name: '', password: '', role: 'member' }

export function AccountManagementPage({ embedded = false, onWorkspaceChanged }) {
  const { session, refresh } = useAuth()
  const [workspaces, setWorkspaces] = useState([])
  const [members, setMembers] = useState([])
  const [ownSessions, setOwnSessions] = useState([])
  const [tenantSessions, setTenantSessions] = useState([])
  const [roleDrafts, setRoleDrafts] = useState({})
  const [memberQuery, setMemberQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createUserForm, setCreateUserForm] = useState(createUserInitialState)
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('')
  const [ownerTransferTarget, setOwnerTransferTarget] = useState('')

  const tenantId = session.account.tenantId
  const canReadMembers = hasPermission(session, 'user.read') || hasPermission(session, 'user.manage')
  const canManageMembers = hasPermission(session, 'user.manage')
  const canAccessAdminConsole = canOpenAccountAdmin(session)
  const canManageSuperAdminRole = session.account.roles.includes('owner')
  const canManageAdminRole = canManageSuperAdminRole || session.account.roles.includes('super_admin')
  const createUserRoleOptions = assignableRoleOptions({ canManageAdminRole, canManageSuperAdminRole })
  const currentWorkspaceItem = workspaces.find((item) => item.workspace.id === tenantId)
  const currentWorkspace = currentWorkspaceItem?.workspace ?? null
  const ownerTransferCandidates = members.filter(
    (member) =>
      member.status === 'active' && member.userId !== session.account.id && !member.roles.includes('owner'),
  )
  const filteredMembers = members.filter((member) =>
    matchesMember(member, memberQuery, statusFilter, roleFilter),
  )
  const activeMemberCount = members.filter((member) => member.status === 'active').length
  const sessionStatsByUser = buildSessionStats(tenantSessions)

  const load = async (targetTenantId = tenantId, permissions = session.permissions) => {
    setLoading(true)
    setError('')
    const canRead = permissions.includes('user.read') || permissions.includes('user.manage')
    const canManage = permissions.includes('user.manage')
    try {
      const [workspaceList, sessionList, memberList, tenantSessionList] = await Promise.all([
        api.workspaces(),
        api.authSessions(),
        canRead ? api.tenantMembers(targetTenantId) : Promise.resolve([]),
        canManage ? api.tenantSessions(targetTenantId) : Promise.resolve([]),
      ])
      setWorkspaces(workspaceList)
      setOwnSessions(sessionList)
      setMembers(memberList)
      setTenantSessions(tenantSessionList)
      setRoleDrafts(
        Object.fromEntries(memberList.map((member) => [member.userId, identityRolesFor(member.roles)])),
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await load()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [tenantId])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 2_800)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    setWorkspaceNameDraft(currentWorkspace?.name ?? '')
    setOwnerTransferTarget('')
  }, [currentWorkspace?.id, currentWorkspace?.name])

  const switchWorkspace = async (nextTenantId) => {
    if (nextTenantId === tenantId) return
    await runAction(`switch:${nextTenantId}`, async () => {
      await api.switchWorkspace(nextTenantId)
      const nextSession = await refresh()
      await load(nextSession.account.tenantId, nextSession.permissions)
      await onWorkspaceChanged?.(nextSession)
      setNotice('Workspace 已切换')
    })
  }

  const saveWorkspaceName = async (event) => {
    event.preventDefault()
    const name = workspaceNameDraft.trim()
    if (!name || !currentWorkspace || name === currentWorkspace.name) return
    const confirmed = window.confirm(
      `确认将当前 workspace 改名为「${name}」？\n\n改名后当前 workspace 的所有成员都会看到新名称。`,
    )
    if (!confirmed) return
    await runAction('workspace:rename', async () => {
      const updated = await api.updateWorkspace(tenantId, { name })
      setWorkspaces((items) =>
        items.map((item) =>
          item.workspace.id === tenantId ? { ...item, workspace: { ...item.workspace, ...updated } } : item,
        ),
      )
      setNotice('Workspace 已改名')
    })
  }

  const transferOwner = async () => {
    const target = ownerTransferCandidates.find((member) => member.userId === ownerTransferTarget)
    if (!target) return
    const confirmed = window.confirm(
      `确认将 workspace 所有者转让给 ${target.name}？\n\n转让后你会保留管理员身份，新所有者可以继续管理管理员、账单和 workspace 设置。`,
    )
    if (!confirmed) return
    await runAction('workspace:transfer-owner', async () => {
      await api.transferWorkspaceOwner(tenantId, {
        targetUserId: target.userId,
        previousOwnerRole: 'admin',
      })
      const nextSession = await refresh()
      await load(nextSession.account.tenantId, nextSession.permissions)
      await onWorkspaceChanged?.(nextSession)
      setNotice('Workspace 所有者已转让')
    })
  }

  const leaveWorkspace = async () => {
    const confirmed = window.confirm(
      '确认退出当前 workspace？\n\n退出后你将失去当前 workspace 的访问权限，当前 workspace 的登录 session 会被撤销。',
    )
    if (!confirmed) return
    await runAction('workspace:leave', async () => {
      const nextAccountSession = await api.leaveWorkspace(tenantId)
      if (!nextAccountSession?.account) {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
        return
      }
      const nextSession = await refresh()
      await load(nextSession.account.tenantId, nextSession.permissions)
      await onWorkspaceChanged?.(nextSession)
      setNotice('已退出 workspace')
    })
  }

  const disableWorkspace = async () => {
    const confirmed = window.confirm(
      '确认禁用当前 workspace？\n\n禁用后所有成员都会失去访问权限，当前 workspace 的 session 会被撤销。该操作需要数据库层面恢复或后续专门启用接口。',
    )
    if (!confirmed) return
    await runAction('workspace:disable', async () => {
      const nextAccountSession = await api.disableWorkspace(tenantId)
      if (!nextAccountSession?.account) {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
        return
      }
      const nextSession = await refresh()
      await load(nextSession.account.tenantId, nextSession.permissions)
      await onWorkspaceChanged?.(nextSession)
      setNotice('Workspace 已禁用')
    })
  }

  const openCreateUser = () => {
    setCreateUserForm({ ...createUserInitialState, role: createUserRoleOptions[0] ?? 'member' })
    setCreateUserOpen(true)
  }

  const createTenantUser = async (event) => {
    event.preventDefault()
    const role = createUserRoleOptions.includes(createUserForm.role) ? createUserForm.role : 'member'
    const email = createUserForm.email.trim()
    const name = createUserForm.name.trim()
    const roleNotice =
      role === 'super_admin'
        ? `确认创建超级管理员账号？\n\n账号：${email}\n显示名称：${name}\n该账号将获得接近 owner 的平台管理权限，但不能任命 owner。`
        : role === 'admin'
          ? `确认创建管理员账号？\n\n账号：${email}\n显示名称：${name}\n该账号将获得当前 workspace 的管理员权限。`
          : `确认创建普通会员账号？\n\n账号：${email}\n显示名称：${name}`
    const confirmed = window.confirm(roleNotice)
    if (!confirmed) return
    await runAction('create-user', async () => {
      await api.createTenantUser(tenantId, {
        email,
        name,
        password: createUserForm.password,
        role,
      })
      setCreateUserOpen(false)
      setCreateUserForm({ ...createUserInitialState })
      await load()
      setNotice(`${roleName(role)}账号已创建`)
    })
  }

  const saveRoles = async (member) => {
    const roles = roleDrafts[member.userId] ?? identityRolesFor(member.roles)
    const confirmed = window.confirm(
      `确认修改 ${member.name} 的角色权限？\n\n当前角色：${formatRoles(member.roles)}\n修改为：${formatRoles(roles)}`,
    )
    if (!confirmed) return
    await runAction(`roles:${member.userId}`, async () => {
      await api.updateMemberRoles(tenantId, member.userId, roles)
      await load()
      setNotice('成员角色已更新')
    })
  }

  const disableMember = async (member) => {
    const confirmed = window.confirm(
      `确认移除 ${member.name} 在当前 workspace 的成员身份？\n\n移除后该成员将失去当前 workspace 的访问权限。`,
    )
    if (!confirmed) return
    await runAction(`disable:${member.userId}`, async () => {
      await api.disableMember(tenantId, member.userId)
      await load()
      setNotice('成员已移除')
    })
  }

  const revokeMemberSessions = async (member) => {
    const sessions = tenantSessions.filter(
      (targetSession) =>
        targetSession.userId === member.userId && !targetSession.current && !targetSession.revokedAt,
    )
    if (!sessions.length) return
    const confirmed = window.confirm(
      `确认踢下线 ${member.name} 的 ${sessions.length} 个有效 session？\n\n该成员需要重新登录后才能继续访问。`,
    )
    if (!confirmed) return
    await runAction(`kick:${member.userId}`, async () => {
      await Promise.all(
        sessions.map((targetSession) => api.revokeTenantSession(tenantId, targetSession.sessionId)),
      )
      await load()
      setNotice('成员 session 已撤销')
    })
  }

  const revokeSession = async (targetSession, scope) => {
    const confirmed = window.confirm(
      scope === 'tenant'
        ? `确认撤销这个租户 session？\n\n用户 ID：${targetSession.userId}`
        : '确认撤销这个登录 session？',
    )
    if (!confirmed) return
    await runAction(`${scope}:${targetSession.sessionId}`, async () => {
      if (scope === 'tenant') await api.revokeTenantSession(tenantId, targetSession.sessionId)
      else await api.revokeAuthSession(targetSession.sessionId)
      await load()
      setNotice('Session 已撤销')
    })
  }

  const runAction = async (id, action) => {
    setBusy(id)
    setError('')
    try {
      await action()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy('')
    }
  }

  const Wrapper = embedded ? 'section' : 'div'

  if (!canAccessAdminConsole) {
    return (
      <Wrapper className={`account-management-page ${embedded ? 'embedded' : 'page'} admin-mode`}>
        <PageHeader eyebrow="账号" title="个人资料" description="管理员端只对所有者和管理员开放。" />
        <div className="account-denied-panel">
          <ShieldAlert size={22} />
          <div>
            <strong>当前账号没有管理员端入口权限</strong>
            <p>请在个人资料中管理自己的账号信息；成员、角色和租户 session 由所有者或管理员处理。</p>
          </div>
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper className={`account-management-page ${embedded ? 'embedded' : 'page'} admin-mode`}>
      <PageHeader
        eyebrow="管理员端"
        title="用户与权限"
        description="管理当前 workspace 的成员、角色边界和登录 session。"
      >
        <button className="button primary" onClick={openCreateUser} disabled={!canManageMembers}>
          <UserPlus size={15} /> 新建用户
        </button>
        <button className="button secondary" onClick={() => load()} disabled={loading}>
          {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} 刷新
        </button>
      </PageHeader>

      {error && <div className="account-alert error">{error}</div>}
      {notice && <div className="account-alert success">{notice}</div>}
      {createUserOpen && (
        <CreateTenantUserModal
          busy={busy === 'create-user'}
          selectableRoles={createUserRoleOptions}
          form={createUserForm}
          onChange={setCreateUserForm}
          onClose={() => setCreateUserOpen(false)}
          onSubmit={createTenantUser}
        />
      )}

      <section className="account-overview-strip">
        <Metric icon={Workflow} label="Workspace" value={workspaces.length} />
        <Metric icon={UsersRound} label="启用成员" value={activeMemberCount || '-'} />
        <Metric icon={KeyRound} label="我的 Session" value={ownSessions.length} />
        <Metric icon={ShieldCheck} label="租户 Session" value={tenantSessions.length || '-'} />
      </section>

      <section className="account-panel account-workspace-panel">
        <PanelHeading title="Workspace 切换" icon={Workflow} />
        <div className="workspace-switch-list compact">
          {workspaces.map((item) => (
            <button
              key={item.workspace.id}
              type="button"
              className={item.workspace.id === tenantId ? 'active' : ''}
              disabled={busy === `switch:${item.workspace.id}` || item.workspace.id === tenantId}
              onClick={() => switchWorkspace(item.workspace.id)}
            >
              <div>
                <strong>{item.workspace.name}</strong>
                <span>{item.membership.roles.map(roleName).join('、')}</span>
              </div>
              {item.workspace.id === tenantId ? <Check size={16} /> : <span>切换</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="account-panel account-workspace-settings">
        <PanelHeading title="Workspace 管理" icon={Pencil} />
        <div className="workspace-management-grid">
          <form className="workspace-management-row" onSubmit={saveWorkspaceName}>
            <label>
              <span>Workspace 名称</span>
              <input
                className="text-input"
                value={workspaceNameDraft}
                onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                maxLength={80}
                disabled={!canManageMembers || busy === 'workspace:rename'}
              />
            </label>
            <button
              className="button secondary"
              type="submit"
              disabled={
                !canManageMembers ||
                busy === 'workspace:rename' ||
                !workspaceNameDraft.trim() ||
                workspaceNameDraft.trim() === currentWorkspace?.name
              }
            >
              {busy === 'workspace:rename' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Pencil size={15} />
              )}
              保存名称
            </button>
          </form>

          <div className="workspace-management-row">
            <label>
              <span>转让所有者</span>
              <select
                value={ownerTransferTarget}
                onChange={(event) => setOwnerTransferTarget(event.target.value)}
                disabled={!canManageAdminRole || busy === 'workspace:transfer-owner'}
              >
                <option value="">选择新的所有者</option>
                {ownerTransferCandidates.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name} · {member.email}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={!canManageAdminRole || !ownerTransferTarget || busy === 'workspace:transfer-owner'}
              onClick={transferOwner}
            >
              {busy === 'workspace:transfer-owner' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Crown size={15} />
              )}
              转让 owner
            </button>
          </div>

          <div className="workspace-management-row danger">
            <div>
              <span>退出与禁用</span>
              <strong>{currentWorkspace?.name ?? '当前 workspace'}</strong>
            </div>
            <div className="workspace-danger-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy === 'workspace:leave'}
                onClick={leaveWorkspace}
              >
                {busy === 'workspace:leave' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <DoorOpen size={15} />
                )}
                退出
              </button>
              <button
                className="button secondary danger-inline"
                type="button"
                disabled={!canManageAdminRole || busy === 'workspace:disable'}
                onClick={disableWorkspace}
              >
                {busy === 'workspace:disable' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Power size={15} />
                )}
                禁用
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="account-admin-console">
        <div className="account-admin-toolbar">
          <div>
            <span className="eyebrow">成员列表</span>
            <h2>用户</h2>
          </div>
          <label className="account-search-field">
            <Search size={15} />
            <input
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="搜索姓名、邮箱或用户 ID"
            />
          </label>
          <div className="account-filter-group">
            <select
              aria-label="筛选成员状态"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">禁用</option>
            </select>
            <select
              aria-label="筛选成员角色"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="all">全部角色</option>
              {roleFilterOptions.map((role) => (
                <option key={role} value={role}>
                  {roleName(role)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!canReadMembers && <p className="account-table-empty">当前账号没有成员读取权限。</p>}
        {canReadMembers && (
          <MemberAdminTable
            members={filteredMembers}
            currentUserId={session.account.id}
            roleDrafts={roleDrafts}
            busy={busy}
            canManage={canManageMembers}
            canManageAdminRole={canManageAdminRole}
            canManageSuperAdminRole={canManageSuperAdminRole}
            sessionStatsByUser={sessionStatsByUser}
            onRolesChange={(userId, roles) => setRoleDrafts((drafts) => ({ ...drafts, [userId]: roles }))}
            onSave={saveRoles}
            onDisable={disableMember}
            onRevokeSessions={revokeMemberSessions}
          />
        )}
      </section>

      <section className="account-session-grid">
        <div className="account-panel">
          <PanelHeading title="我的 Session" icon={KeyRound} />
          <SessionList
            title="我的登录"
            sessions={ownSessions}
            busy={busy}
            scope="self"
            onRevoke={revokeSession}
          />
        </div>
        <div className="account-panel">
          <PanelHeading title="租户 Session" icon={ShieldCheck} />
          {canManageMembers ? (
            <SessionList
              title="当前 workspace"
              sessions={tenantSessions}
              busy={busy}
              scope="tenant"
              onRevoke={revokeSession}
            />
          ) : (
            <p className="panel-empty">当前账号没有租户 session 管理权限。</p>
          )}
        </div>
      </section>
    </Wrapper>
  )
}

function CreateTenantUserModal({ busy, selectableRoles, form, onChange, onClose, onSubmit }) {
  const selectedRole = selectableRoles.includes(form.role) ? form.role : selectableRoles[0]
  const canSubmit = form.email.trim() && form.name.trim() && form.password.length >= 12

  const update = (field, value) => {
    onChange({ ...form, [field]: value })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal account-user-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">账号管理</span>
            <h2>新建用户</h2>
          </div>
          <IconButton type="button" label="关闭" onClick={onClose} disabled={busy}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="field-grid account-create-user-grid">
          <label>
            <span>登录邮箱 / 用户名</span>
            <input
              className="text-input"
              type="email"
              value={form.email}
              onChange={(event) => update('email', event.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            <span>显示名称</span>
            <input
              className="text-input"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              required
              maxLength={80}
              autoComplete="name"
            />
          </label>
          <label>
            <span>身份</span>
            <select
              value={selectedRole}
              onChange={(event) => update('role', event.target.value)}
              disabled={selectableRoles.length <= 1}
            >
              {selectableRoles.map((role) => (
                <option key={role} value={role}>
                  {roleName(role)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>初始密码</span>
            <input
              className="text-input"
              type="password"
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={busy || !canSubmit}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <UserPlus size={15} />} 创建用户
          </button>
        </div>
      </form>
    </div>
  )
}

function hasPermission(session, permission) {
  return session.permissions.includes(permission)
}

function formatRoles(roles) {
  return roles.map(roleName).join('、')
}

function matchesMember(member, query, statusFilter, roleFilter) {
  const normalizedQuery = query.trim().toLowerCase()
  const matchesQuery =
    !normalizedQuery ||
    [member.name, member.email, member.userId, member.id].some((value) =>
      String(value ?? '')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  const matchesStatus = statusFilter === 'all' || member.status === statusFilter
  const matchesRole = roleFilter === 'all' || identityRolesFor(member.roles).includes(roleFilter)
  return matchesQuery && matchesStatus && matchesRole
}

function buildSessionStats(sessions) {
  return sessions.reduce((stats, session) => {
    const current = stats[session.userId] ?? {
      activeCount: 0,
      revocableCount: 0,
      lastSeenAt: null,
    }
    if (!session.revokedAt) current.activeCount += 1
    if (!session.revokedAt && !session.current) current.revocableCount += 1

    const lastSeenAt = session.lastSeenAt || session.createdAt
    if (lastSeenAt && (!current.lastSeenAt || new Date(lastSeenAt) > new Date(current.lastSeenAt))) {
      current.lastSeenAt = lastSeenAt
    }
    stats[session.userId] = current
    return stats
  }, {})
}
