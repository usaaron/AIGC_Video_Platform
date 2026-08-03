import { Check, ExternalLink, KeyRound, LoaderCircle, LogOut, RefreshCw, Save, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui'

export function SettingsPage({
  project,
  account,
  canEditProject = false,
  canOpenAdminConsole = false,
  adminConsoleUrl,
  organizations = [],
  sessions = [],
  onLoadAccountScope,
  onSwitchOrganization,
  onRevokeSession,
  onSave,
  onChangePassword,
  onRequestEmailVerification,
  onLogout,
}) {
  const canEditCurrentProject = canEditProject && Boolean(project)
  const [name, setName] = useState(project?.name ?? '')
  const [synopsis, setSynopsis] = useState(project?.synopsis ?? '')
  const [status, setStatus] = useState(project?.status ?? 'draft')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordState, setPasswordState] = useState({ status: 'idle', message: '' })
  const [accountBusy, setAccountBusy] = useState('')
  const [accountMessage, setAccountMessage] = useState({ status: 'idle', message: '' })
  const [verificationState, setVerificationState] = useState({ status: 'idle', message: '' })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!onLoadAccountScope) return
      setAccountBusy('load')
      setAccountMessage({ status: 'idle', message: '' })
      try {
        await onLoadAccountScope()
      } catch (error) {
        if (!cancelled) setAccountMessage({ status: 'error', message: error.message })
      } finally {
        if (!cancelled) setAccountBusy('')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [account.tenantId, onLoadAccountScope])

  const changePassword = async (event) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setPasswordState({ status: 'error', message: '两次输入的新密码不一致' })
      return
    }
    setPasswordState({ status: 'saving', message: '' })
    try {
      await onChangePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordState({ status: 'success', message: '密码已更新，下次登录请使用新密码' })
    } catch (error) {
      setPasswordState({ status: 'error', message: error.message })
    }
  }

  const switchOrganization = async (organizationId) => {
    if (
      organizationId === account.organizationId ||
      organizationId === account.tenantId ||
      !onSwitchOrganization
    )
      return
    setAccountBusy(`organization:${organizationId}`)
    setAccountMessage({ status: 'idle', message: '' })
    try {
      await onSwitchOrganization(organizationId)
      setAccountMessage({ status: 'success', message: '组织已切换' })
    } catch (error) {
      setAccountMessage({ status: 'error', message: error.message })
    } finally {
      setAccountBusy('')
    }
  }

  const revokeSession = async (session) => {
    if (session.current || !onRevokeSession) return
    const confirmed = window.confirm(
      `确认撤销这个登录 session？\n\n设备：${session.deviceLabel ?? deviceLabel(session)}\n创建时间：${formatDate(session.createdAt)}`,
    )
    if (!confirmed) return
    setAccountBusy(`session:${session.sessionId}`)
    setAccountMessage({ status: 'idle', message: '' })
    try {
      await onRevokeSession(session.sessionId)
      setAccountMessage({ status: 'success', message: 'Session 已撤销' })
    } catch (error) {
      setAccountMessage({ status: 'error', message: error.message })
    } finally {
      setAccountBusy('')
    }
  }

  const refreshAccountScope = async () => {
    if (!onLoadAccountScope) return
    setAccountBusy('load')
    setAccountMessage({ status: 'idle', message: '' })
    try {
      await onLoadAccountScope()
    } catch (error) {
      setAccountMessage({ status: 'error', message: error.message })
    } finally {
      setAccountBusy('')
    }
  }

  const requestEmailVerification = async () => {
    if (!onRequestEmailVerification) return
    setVerificationState({ status: 'saving', message: '' })
    try {
      await onRequestEmailVerification()
      setVerificationState({ status: 'success', message: '验证邮件已发送，请检查收件箱' })
    } catch (error) {
      setVerificationState({ status: 'error', message: error.message })
    }
  }

  return (
    <div className="page settings-page">
      <PageHeader eyebrow="账号" title="个人资料" description="查看当前登录账号，并管理自己的登录安全。">
        {canOpenAdminConsole && (
          <a className="button primary" href={adminConsoleUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> 管理后台
          </a>
        )}
        {canEditCurrentProject && (
          <button className="button primary" onClick={() => onSave({ name, synopsis, status })}>
            <Save size={16} /> 保存设置
          </button>
        )}
      </PageHeader>
      <div className={`settings-layout ${canEditCurrentProject ? '' : 'profile-only'}`}>
        {canEditCurrentProject && (
          <section className="settings-section">
            <h2>项目资料</h2>
            <label>
              <span>项目名称</span>
              <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>故事简介</span>
              <textarea value={synopsis} onChange={(event) => setSynopsis(event.target.value)} />
            </label>
            <label>
              <span>制作状态</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="draft">草稿</option>
                <option value="producing">制作中</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </label>
          </section>
        )}
        <section className="account-section">
          <span className="account-avatar">
            <UserRound size={22} />
          </span>
          <h2>{account.name}</h2>
          <p>{account.email}</p>
          {account.emailVerified === false && (
            <div className="verification-notice">
              <strong>邮箱尚未验证</strong>
              <span>验证邮箱后才能进入创作工作台和使用计费功能。</span>
              {verificationState.message && (
                <small className={verificationState.status}>{verificationState.message}</small>
              )}
              <button
                className="button secondary"
                type="button"
                onClick={requestEmailVerification}
                disabled={verificationState.status === 'saving'}
              >
                {verificationState.status === 'saving' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                重新发送验证邮件
              </button>
            </div>
          )}
          <dl>
            <div>
              <dt>角色</dt>
              <dd>{account.roles.join(', ')}</dd>
            </div>
            <div>
              <dt>账号 ID</dt>
              <dd>{account.id}</dd>
            </div>
          </dl>
          {canOpenAdminConsole && (
            <a className="admin-console-card" href={adminConsoleUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              <div>
                <strong>管理后台</strong>
                <span>用户、组织、账单、审计和 session 风险统一在 5174 管理</span>
              </div>
            </a>
          )}
          <form className="password-form" onSubmit={changePassword}>
            <div className="password-form-heading">
              <KeyRound size={16} />
              <strong>账号安全</strong>
            </div>
            <label>
              <span>当前密码</span>
              <input
                className="text-input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label>
              <span>新密码</span>
              <input
                className="text-input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <label>
              <span>确认新密码</span>
              <input
                className="text-input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            {passwordState.message && (
              <p className={`password-message ${passwordState.status}`} role="status">
                {passwordState.message}
              </p>
            )}
            <button className="button secondary full" disabled={passwordState.status === 'saving'}>
              {passwordState.status === 'saving' ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <KeyRound size={16} />
              )}
              {passwordState.status === 'saving' ? '正在更新' : '更新密码'}
            </button>
          </form>
          <button className="button secondary full" onClick={onLogout}>
            <LogOut size={16} /> 退出登录
          </button>
        </section>
        <section className="account-self-management">
          <div className="self-management-head">
            <div>
              <h2>组织与 Session</h2>
              <p>切换当前创作组织，并管理自己的登录设备。</p>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={refreshAccountScope}
              disabled={accountBusy === 'load'}
            >
              {accountBusy === 'load' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              刷新
            </button>
          </div>
          {accountMessage.message && (
            <p className={`account-self-message ${accountMessage.status}`} role="status">
              {accountMessage.message}
            </p>
          )}
          <div className="self-management-grid">
            <div className="self-panel">
              <h3>组织切换</h3>
              <div className="workspace-switch-list self">
                {organizations.map((item) => {
                  const organization = item.organization ?? item.workspace
                  const organizationId = organization.id
                  const currentOrganizationId = account.organizationId ?? account.tenantId
                  return (
                    <button
                      key={organizationId}
                      type="button"
                      className={organizationId === currentOrganizationId ? 'active' : ''}
                      disabled={
                        organizationId === currentOrganizationId ||
                        accountBusy === `organization:${organizationId}`
                      }
                      onClick={() => switchOrganization(organizationId)}
                    >
                      <div>
                        <strong>{organization.name}</strong>
                        <span>{item.membership.roles.map(roleName).join('、')}</span>
                      </div>
                      {organizationId === currentOrganizationId ? (
                        <Check size={16} />
                      ) : accountBusy === `organization:${organizationId}` ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <span>切换</span>
                      )}
                    </button>
                  )
                })}
                {!organizations.length && <p className="panel-empty">暂无可切换组织。</p>}
              </div>
            </div>
            <div className="self-panel">
              <h3>我的 Session</h3>
              <div className="self-session-list">
                {sessions.map((session) => (
                  <article
                    key={session.sessionId}
                    className={session.revokedAt ? 'session-row revoked' : 'session-row'}
                  >
                    <div>
                      <strong>{session.current ? '当前 session' : shortId(session.sessionId)}</strong>
                      <span>{deviceLabel(session)}</span>
                      <small>
                        {formatDate(session.createdAt)} 创建 ·{' '}
                        {session.lastSeenAt ? formatDate(session.lastSeenAt) : '未记录活跃'}
                      </small>
                    </div>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={
                        session.current ||
                        Boolean(session.revokedAt) ||
                        accountBusy === `session:${session.sessionId}`
                      }
                      onClick={() => revokeSession(session)}
                    >
                      {accountBusy === `session:${session.sessionId}` ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <LogOut size={15} />
                      )}
                      {session.revokedAt ? '已撤销' : session.current ? '当前' : '撤销'}
                    </button>
                  </article>
                ))}
                {!sessions.length && <p className="panel-empty">暂无 session。</p>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function roleName(role) {
  return (
    {
      owner: '所有者',
      super_admin: '超级管理员',
      admin: '管理员',
      member: '普通成员',
      organization_admin: '组织管理员',
      organization_member: '组织成员',
    }[role] ?? role
  )
}

function shortId(id) {
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id
}

function formatDate(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function deviceLabel(session) {
  if (session.deviceLabel) return session.deviceLabel
  if (session.userAgent?.includes('Chrome')) return 'Chrome'
  if (session.userAgent?.includes('Firefox')) return 'Firefox'
  if (session.userAgent?.includes('Safari')) return 'Safari'
  return session.ipAddress ?? '未记录设备'
}
