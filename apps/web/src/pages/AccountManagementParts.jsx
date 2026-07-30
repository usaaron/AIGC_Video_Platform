import { CircleSlash, LoaderCircle, LogOut, Save } from 'lucide-react'

export const roleOptions = ['member', 'admin']
const roleLabels = { member: '普通会员', creator: '普通会员', admin: '管理员', owner: '所有者' }
const statusLabels = { active: '启用', disabled: '禁用' }

export function Metric({ icon: Icon, label, value }) {
  return (
    <div>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function PanelHeading({ title, icon: Icon }) {
  return (
    <div className="account-panel-heading">
      <Icon size={17} />
      <h2>{title}</h2>
    </div>
  )
}

export function MemberAdminTable({
  members,
  currentUserId,
  roleDrafts,
  busy,
  canManage,
  canManageAdminRole,
  sessionStatsByUser,
  onRolesChange,
  onSave,
  onDisable,
  onRevokeSessions,
}) {
  return (
    <div className="account-admin-table-wrap">
      <table className="account-admin-table">
        <thead>
          <tr>
            <th aria-label="选择" />
            <th>用户</th>
            <th>状态</th>
            <th>Workspace</th>
            <th>角色</th>
            <th>创建时间</th>
            <th>最后活跃</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 && (
            <tr>
              <td colSpan={8}>
                <p className="account-table-empty">没有匹配的成员。</p>
              </td>
            </tr>
          )}
          {members.map((member) => {
            const roles = roleDrafts[member.userId] ?? identityRolesFor(member.roles)
            const disabled = member.status !== 'active'
            const isCurrentUser = member.userId === currentUserId
            const isOwner = member.roles.includes('owner')
            const isAdmin = member.roles.includes('admin')
            const canManageRow =
              canManage && !disabled && !isCurrentUser && !isOwner && (canManageAdminRole || !isAdmin)
            const editableRoleOptions = canManageAdminRole ? roleOptions : ['member']
            const changed = !sameRoles(identityRolesFor(member.roles), roles)
            const sessionStats = sessionStatsByUser[member.userId] ?? {
              activeCount: 0,
              lastSeenAt: null,
              revocableCount: 0,
            }

            return (
              <tr key={member.id} className={disabled ? 'is-disabled' : ''}>
                <td>
                  <span className={`account-row-dot ${disabled ? 'muted' : ''}`} />
                </td>
                <td>
                  <div className="account-user-cell">
                    <span>{initialFor(member.name)}</span>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`account-status-badge ${member.status}`}>
                    {statusLabels[member.status] ?? member.status}
                  </span>
                </td>
                <td>
                  <div className="account-workspace-cell">
                    <strong>{member.tenantName}</strong>
                    {member.isPrimary && <span>主 workspace</span>}
                  </div>
                </td>
                <td>
                  <RoleEditor
                    roles={roles}
                    options={editableRoleOptions}
                    disabled={!canManageRow}
                    onChange={(nextRoles) => onRolesChange(member.userId, nextRoles)}
                  />
                </td>
                <td>
                  <span className="account-table-muted">{formatDate(member.createdAt)}</span>
                </td>
                <td>
                  <div className="account-session-cell">
                    <strong>
                      {sessionStats.lastSeenAt ? formatDate(sessionStats.lastSeenAt) : '无记录'}
                    </strong>
                    <span>{sessionStats.activeCount} 个有效 session</span>
                  </div>
                </td>
                <td>
                  <div className="account-admin-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={
                        !canManage ||
                        !canManageRow ||
                        !changed ||
                        roles.length === 0 ||
                        busy === `roles:${member.userId}`
                      }
                      onClick={() => onSave(member)}
                    >
                      {busy === `roles:${member.userId}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      保存
                    </button>
                    <button
                      type="button"
                      className="button secondary danger-inline"
                      disabled={!canManage || !canManageRow || busy === `disable:${member.userId}`}
                      onClick={() => onDisable(member)}
                    >
                      {busy === `disable:${member.userId}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <CircleSlash size={14} />
                      )}
                      移除
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={
                        !canManage ||
                        !canManageRow ||
                        sessionStats.revocableCount === 0 ||
                        busy === `kick:${member.userId}`
                      }
                      onClick={() => onRevokeSessions(member)}
                    >
                      {busy === `kick:${member.userId}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <LogOut size={14} />
                      )}
                      踢下线
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SessionList({ title, sessions, busy, scope, onRevoke }) {
  return (
    <div className="session-block">
      <h3>{title}</h3>
      {sessions.length === 0 && <p className="panel-empty">暂无 session。</p>}
      {sessions.map((session) => (
        <article
          key={`${scope}-${session.sessionId}`}
          className={session.revokedAt ? 'session-row revoked' : 'session-row'}
        >
          <div>
            <strong>{session.current ? '当前 session' : shortId(session.sessionId)}</strong>
            <span>
              {session.tenantName} · {session.roles.map(roleName).join('、')}
            </span>
            <small>
              {formatDate(session.createdAt)} 创建 ·{' '}
              {session.lastSeenAt ? formatDate(session.lastSeenAt) : '未记录活跃'}
            </small>
          </div>
          <button
            className="button secondary"
            disabled={
              session.current || Boolean(session.revokedAt) || busy === `${scope}:${session.sessionId}`
            }
            onClick={() => onRevoke(session, scope)}
          >
            {busy === `${scope}:${session.sessionId}` ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <LogOut size={15} />
            )}
            {session.revokedAt ? '已撤销' : session.current ? '当前' : '踢下线'}
          </button>
        </article>
      ))}
    </div>
  )
}

export function roleName(role) {
  return roleLabels[role] ?? role
}

export function identityRolesFor(roles) {
  if (roles.includes('owner')) return ['owner']
  if (roles.includes('admin')) return ['admin']
  return ['member']
}

function RoleEditor({ roles, options, disabled, onChange }) {
  const lockedRoles = roles.filter((role) => role !== 'owner' && !options.includes(role))
  const visibleOptions = disabled && (roles.includes('owner') || lockedRoles.length > 0) ? [] : options
  const toggleRole = (role) => {
    onChange(roles.includes(role) ? [] : [role])
  }

  return (
    <div className="account-role-editor">
      {roles.includes('owner') && (
        <label className="checked locked">
          <input type="checkbox" checked disabled />
          <span>{roleName('owner')}</span>
        </label>
      )}
      {lockedRoles.map((role) => (
        <label key={role} className="checked locked">
          <input type="checkbox" checked disabled />
          <span>{roleName(role)}</span>
        </label>
      ))}
      {visibleOptions.map((role) => (
        <label key={role} className={roles.includes(role) ? 'checked' : ''}>
          <input
            type="checkbox"
            checked={roles.includes(role)}
            disabled={disabled}
            onChange={() => toggleRole(role)}
          />
          <span>{roleName(role)}</span>
        </label>
      ))}
    </div>
  )
}

function sameRoles(left, right) {
  return left.length === right.length && left.every((role) => right.includes(role))
}

function initialFor(name) {
  return name?.slice(0, 1) || '用'
}

function shortId(id) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function formatDate(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
