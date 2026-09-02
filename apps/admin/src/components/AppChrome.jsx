import { ArrowLeft, Check, LoaderCircle, LogOut, ShieldCheck, X } from 'lucide-react'
import {
  canCreateOrganization,
  canManageBilling,
  canManageUsers,
  roleName,
  isPlatformAdminSession,
} from '../adminConsole'
import { tooltipProps } from './AdminUi'
import { WEB_ORIGIN } from './adminDomain'

export function LoadingScreen({ label, compact = false }) {
  return (
    <div
      className={compact ? 'loading-state compact' : 'loading-state'}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoaderCircle size={compact ? 20 : 28} className="spin" />
      <span>{label}</span>
    </div>
  )
}

export function DismissibleNotice({ tone = 'success', children, onClose }) {
  return (
    <div
      className={`notice ${tone} dismissible`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <span>{children}</span>
      <button className="notice-dismiss" type="button" onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  )
}

export function NextStepNotice({ hint, onAction, onClose }) {
  return (
    <section className="next-step-notice">
      <ShieldCheck size={16} />
      <div className="next-step-copy">
        <strong>{hint.title}</strong>
        <span>{hint.description}</span>
      </div>
      <div className="next-step-actions">
        {(hint.actions ?? []).map((action) => (
          <button
            key={action.label}
            className="row-button"
            type="button"
            {...tooltipProps(action.description ?? `执行：${action.label}`)}
            onClick={() => onAction(action)}
          >
            {action.icon ? <action.icon size={14} /> : <Check size={14} />}
            {action.label}
          </button>
        ))}
        <button className="icon-button" type="button" {...tooltipProps('关闭下一步提示')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </section>
  )
}

export function PermissionBoundaryBanner({ session }) {
  const roles = session?.account?.roles ?? []
  const scope = permissionScopeDescription(session)
  const chips = [
    canManageUsers(session) ? '账号管理' : '',
    canManageBilling(session) ? '账单调账' : '',
    isPlatformAdminSession(session) ? '合规审查' : '',
    canCreateOrganization(session) ? '创建企业组织' : '',
  ].filter(Boolean)

  return (
    <section className="permission-boundary">
      <ShieldCheck size={16} />
      <div>
        <strong>当前身份：{roles.map(roleName).join('、')}</strong>
        <span>{scope}</span>
      </div>
      <div>{chips.length ? chips.map((chip) => <span key={chip}>{chip}</span>) : <span>只读</span>}</div>
    </section>
  )
}

export function permissionScopeDescription(session) {
  const roles = session?.account?.roles ?? []
  if (roles.includes('owner')) return '可管理全平台账号、企业组织、组织共享池、套餐、合规审查和系统级权限。'
  if (roles.includes('super_admin'))
    return '可管理全平台运营功能，但 owner 等最高权限账号仍受 owner 边界保护。'
  if (roles.includes('admin')) return '主要管理 C 端普通成员和个人空间；企业组织池和组织管理员受限。'
  if (roles.includes('organization_admin'))
    return '只能管理当前企业组织内成员、邀请和组织共享池，不能管理其他企业或平台账号。'
  if (roles.includes('organization_member'))
    return '组织成员通常不能进入后台管理；如可见页面，多数操作为只读。'
  return '普通成员通常不能进入后台管理；如可见页面，多数操作为只读。'
}

export function LoginScreen({ form, busy, error, onChange, onSubmit }) {
  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={onSubmit}>
        <div className="brand-lockup large">
          <span className="brand-mark">序</span>
          <div>
            <strong>序幕TV Admin</strong>
            <span>管理后台</span>
          </div>
        </div>
        <label>
          <span>邮箱</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            autoComplete="username"
            required
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            value={form.password}
            onChange={(event) => onChange({ ...form, password: event.target.value })}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
          登录
        </button>
      </form>
    </main>
  )
}

export function DeniedScreen({ session, busy, onLogout }) {
  return (
    <main className="login-shell">
      <section className="login-panel denied">
        <ShieldCheck size={24} />
        <h1>当前账号无后台权限</h1>
        <p>{session.account.email}</p>
        <div className="denied-actions">
          <a className="icon-text-button" href={WEB_ORIGIN}>
            <ArrowLeft size={16} />
            返回工作台
          </a>
          <button className="primary-button" type="button" onClick={onLogout} disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}
            退出
          </button>
        </div>
      </section>
    </main>
  )
}
