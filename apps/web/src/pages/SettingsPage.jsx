import {
  BadgeCheck,
  Building2,
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui'

export function SettingsPage({
  account,
  billing,
  canOpenAdminConsole = false,
  adminConsoleUrl,
  organizations = [],
  sessions = [],
  onLoadAccountScope,
  onSwitchOrganization,
  onRevokeSession,
  onInviteOrganizationMember,
  onOpenBilling,
  onChangePassword,
  onRequestEmailVerification,
  onLogout,
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordState, setPasswordState] = useState({ status: 'idle', message: '' })
  const [accountBusy, setAccountBusy] = useState('')
  const [accountMessage, setAccountMessage] = useState({ status: 'idle', message: '' })
  const [verificationState, setVerificationState] = useState({ status: 'idle', message: '' })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteState, setInviteState] = useState({ status: 'idle', message: '' })

  const currentOrganizationId = account.organizationId ?? account.tenantId
  const organizationMemberships = Array.isArray(organizations) ? organizations : []
  const currentOrganization = useMemo(
    () =>
      organizationMemberships.find((item) => {
        const organization = item.organization ?? item.workspace
        return organization?.id === currentOrganizationId
      }) ?? null,
    [currentOrganizationId, organizationMemberships],
  )
  const isOrganizationAdmin = account.roles.includes('organization_admin')
  const personalSpace = !isOrganizationAdmin && account.roles.includes('member')
  const organizationName =
    currentOrganization?.organization?.name ??
    currentOrganization?.workspace?.name ??
    (personalSpace ? '个人创作空间' : '当前创作组织')
  const membershipRoles = currentOrganization?.membership?.roles ?? account.roles
  const usage = billing?.monthlyUsage
  const availableCredits = billing?.credits ?? account.credits ?? 0

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!onLoadAccountScope) return
      setAccountBusy('load')
      setAccountMessage({ status: 'idle', message: '' })
      try {
        await onLoadAccountScope()
      } catch (error) {
        if (!cancelled) {
          setAccountMessage({
            status: 'error',
            message: error.message || '部分账户信息暂时无法同步，请稍后刷新。',
          })
        }
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
      setPasswordState({ status: 'error', message: '两次输入的新密码不一致。' })
      return
    }
    setPasswordState({ status: 'saving', message: '' })
    try {
      await onChangePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordState({ status: 'success', message: '密码已更新，下次登录请使用新密码。' })
    } catch (error) {
      setPasswordState({ status: 'error', message: error.message })
    }
  }

  const switchOrganization = async (organizationId) => {
    if (organizationId === currentOrganizationId || !onSwitchOrganization) return
    setAccountBusy(`organization:${organizationId}`)
    setAccountMessage({ status: 'idle', message: '' })
    try {
      await onSwitchOrganization(organizationId)
      setAccountMessage({ status: 'success', message: '已切换创作组织。' })
    } catch (error) {
      setAccountMessage({ status: 'error', message: error.message })
    } finally {
      setAccountBusy('')
    }
  }

  const revokeSession = async (session) => {
    if (session.current || !onRevokeSession) return
    const confirmed = window.confirm(
      `确认退出这个登录设备？\n\n设备：${session.deviceLabel ?? deviceLabel(session)}\n登录时间：${formatDate(session.createdAt)}`,
    )
    if (!confirmed) return
    setAccountBusy(`session:${session.sessionId}`)
    setAccountMessage({ status: 'idle', message: '' })
    try {
      await onRevokeSession(session.sessionId)
      setAccountMessage({ status: 'success', message: '该登录设备已退出。' })
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
      setVerificationState({ status: 'success', message: '验证邮件已发送，请检查收件箱。' })
    } catch (error) {
      setVerificationState({ status: 'error', message: error.message })
    }
  }

  const inviteOrganizationMember = async (event) => {
    event.preventDefault()
    if (!onInviteOrganizationMember || !inviteEmail.trim()) return
    setInviteState({ status: 'saving', message: '' })
    try {
      await onInviteOrganizationMember(currentOrganizationId, inviteEmail.trim())
      setInviteEmail('')
      setInviteState({ status: 'success', message: '邀请已发送，对方完成邮箱验证后即可加入。' })
    } catch (error) {
      setInviteState({ status: 'error', message: error.message })
    }
  }

  return (
    <div className="page account-center-page">
      <PageHeader eyebrow="账号" title="账号中心" description="管理身份、积分、创作组织和登录安全。">
        {canOpenAdminConsole && (
          <a className="button secondary" href={adminConsoleUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> 管理后台
          </a>
        )}
      </PageHeader>

      <div className="account-center-top">
        <section className="account-center-panel account-identity-panel">
          <div className="account-panel-heading">
            <span className="account-avatar">
              <UserRound size={22} />
            </span>
            <div>
              <p>当前账号</p>
              <h2>{account.name}</h2>
              <span>{account.email}</span>
            </div>
          </div>

          <div className="account-status-line">
            {account.emailVerified === false ? (
              <span className="account-state pending">邮箱待验证</span>
            ) : (
              <span className="account-state verified">
                <BadgeCheck size={14} /> 邮箱已验证
              </span>
            )}
            {membershipRoles.map((role) => (
              <span key={role} className="account-role-chip">
                {roleName(role)}
              </span>
            ))}
          </div>

          {account.emailVerified === false && (
            <div className="account-verification-notice">
              <div>
                <strong>完成邮箱验证后即可正常使用创作与计费功能</strong>
                {verificationState.message && (
                  <small className={verificationState.status}>{verificationState.message}</small>
                )}
              </div>
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
                发送验证邮件
              </button>
            </div>
          )}

          <details className="account-id-disclosure">
            <summary>账户编号</summary>
            <code>{account.id}</code>
          </details>
        </section>

        <section className="account-center-panel account-billing-panel">
          <div className="account-panel-topline">
            <div>
              <p>积分与用量</p>
              <h2>当前创作额度</h2>
            </div>
            <span className="account-plan-chip">{billing?.plan === 'member' ? '会员版' : '基础版'}</span>
          </div>
          <div className="account-credit-total">
            <Wallet size={20} />
            <strong>{formatNumber(availableCredits)}</strong>
            <span>可用积分</span>
          </div>
          <div className="account-usage-grid">
            <div>
              <span>本月消耗</span>
              <strong>{formatNumber(usage?.consumedCredits ?? 0)}</strong>
            </div>
            <div>
              <span>本月生成</span>
              <strong>{formatNumber(usage?.generationCount ?? 0)}</strong>
            </div>
            <div>
              <span>可用并发</span>
              <strong>{billing?.unlimitedConcurrency ? '不限' : (billing?.concurrency ?? 1)}</strong>
            </div>
          </div>
          <p className="account-refund-note">本月已退回 {formatNumber(usage?.refundedCredits ?? 0)} 积分</p>
          <button className="button primary account-billing-action" type="button" onClick={onOpenBilling}>
            查看账单与积分明细
          </button>
        </section>
      </div>

      <section className="account-center-panel account-organization-panel">
        <div className="account-panel-topline">
          <div>
            <p>创作组织</p>
            <h2>组织：{personalSpace ? '个人' : organizationName}</h2>
          </div>
          <span className={personalSpace ? 'organization-type personal' : 'organization-type team'}>
            {personalSpace ? '个人空间' : '组织空间'}
          </span>
        </div>

        <div className="organization-current-row">
          <span className="organization-icon">
            <Building2 size={20} />
          </span>
          <div>
            <strong>{organizationName}</strong>
            <span>
              {personalSpace
                ? '项目、资产和积分仅归当前账号使用。'
                : '项目和成员都归属于当前组织，切换组织后数据范围会同步切换。'}
            </span>
          </div>
          <span className="organization-role-label">{organizationRoleLabel(membershipRoles)}</span>
        </div>

        {organizationMemberships.length > 1 && (
          <div className="organization-switch-list">
            {organizationMemberships.map((item) => {
              const organization = item.organization ?? item.workspace
              const organizationId = organization?.id
              if (!organizationId) return null
              const active = organizationId === currentOrganizationId
              return (
                <button
                  key={organizationId}
                  type="button"
                  className={active ? 'active' : ''}
                  disabled={active || accountBusy === `organization:${organizationId}`}
                  onClick={() => switchOrganization(organizationId)}
                >
                  <span>
                    <strong>{organization.name}</strong>
                    <small>{organizationRoleLabel(item.membership?.roles ?? [])}</small>
                  </span>
                  {active ? (
                    <Check size={16} />
                  ) : accountBusy === `organization:${organizationId}` ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <span>切换</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {isOrganizationAdmin && (
          <form className="organization-invite" onSubmit={inviteOrganizationMember}>
            <div className="organization-invite-copy">
              <UsersRound size={18} />
              <div>
                <strong>邀请组织成员</strong>
                <span>成员通过邮件完成注册后，将以组织成员身份加入当前空间。</span>
              </div>
            </div>
            <label>
              <span className="sr-only">成员邮箱</span>
              <input
                className="text-input"
                type="email"
                autoComplete="email"
                placeholder="成员邮箱"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                required
              />
            </label>
            <button className="button secondary" disabled={inviteState.status === 'saving'}>
              {inviteState.status === 'saving' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <UsersRound size={15} />
              )}
              发送邀请
            </button>
            {inviteState.message && (
              <p className={`organization-invite-message ${inviteState.status}`} role="status">
                {inviteState.message}
              </p>
            )}
          </form>
        )}
      </section>

      <div className="account-center-lower">
        <section className="account-center-panel account-security-panel">
          <div className="account-panel-topline">
            <div>
              <p>账号安全</p>
              <h2>更新登录密码</h2>
            </div>
            <ShieldCheck size={21} />
          </div>
          <form className="account-password-form" onSubmit={changePassword}>
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
              <p className={`account-form-message ${passwordState.status}`} role="status">
                {passwordState.message}
              </p>
            )}
            <button className="button secondary" disabled={passwordState.status === 'saving'}>
              {passwordState.status === 'saving' ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <KeyRound size={16} />
              )}
              {passwordState.status === 'saving' ? '正在更新' : '更新密码'}
            </button>
          </form>
          <button className="account-sign-out" type="button" onClick={onLogout}>
            <LogOut size={15} /> 退出当前账号
          </button>
        </section>

        <section className="account-center-panel account-devices-panel">
          <div className="account-panel-topline">
            <div>
              <p>登录设备</p>
              <h2>当前会话</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={refreshAccountScope}
              disabled={accountBusy === 'load'}
              aria-label="刷新登录设备"
              title="刷新登录设备"
            >
              {accountBusy === 'load' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
            </button>
          </div>

          {accountMessage.message && (
            <p className={`account-scope-message ${accountMessage.status}`} role="status">
              {accountMessage.message}
            </p>
          )}

          <div className="account-session-list">
            {sessions.map((session) => (
              <article
                key={session.sessionId}
                className={session.revokedAt ? 'account-session revoked' : 'account-session'}
              >
                <span className="session-device-icon">
                  <Monitor size={17} />
                </span>
                <div>
                  <strong>
                    {session.current ? '当前设备' : (session.deviceLabel ?? deviceLabel(session))}
                  </strong>
                  <span>{session.current ? deviceLabel(session) : formatDate(session.createdAt)}</span>
                </div>
                <button
                  className="button secondary compact"
                  type="button"
                  disabled={
                    session.current ||
                    Boolean(session.revokedAt) ||
                    accountBusy === `session:${session.sessionId}`
                  }
                  onClick={() => revokeSession(session)}
                >
                  {accountBusy === `session:${session.sessionId}` ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : null}
                  {session.revokedAt ? '已退出' : session.current ? '当前' : '退出'}
                </button>
              </article>
            ))}
            {!sessions.length && accountBusy === 'load' && (
              <p className="account-empty">正在同步登录设备...</p>
            )}
            {!sessions.length && accountBusy !== 'load' && !accountMessage.message && (
              <p className="account-empty">暂无其他登录设备。</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function roleName(role) {
  return (
    {
      owner: '平台所有者',
      super_admin: '超级管理员',
      admin: '平台管理员',
      member: '个人创作者',
      organization_admin: '组织负责人',
      organization_member: '组织成员',
    }[role] ?? role
  )
}

function organizationRoleLabel(roles) {
  if (roles.includes('organization_admin')) return '组织负责人'
  if (roles.includes('organization_member')) return '组织成员'
  if (roles.includes('owner')) return '平台所有者'
  if (roles.includes('super_admin') || roles.includes('admin')) return '平台管理'
  return '个人所有者'
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDate(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function deviceLabel(session) {
  if (session.deviceLabel) return session.deviceLabel
  if (session.userAgent?.includes('Chrome')) return 'Chrome 浏览器'
  if (session.userAgent?.includes('Firefox')) return 'Firefox 浏览器'
  if (session.userAgent?.includes('Safari')) return 'Safari 浏览器'
  return session.ipAddress ?? '未记录设备信息'
}
