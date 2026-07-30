import { KeyRound, LoaderCircle, LogOut, Save, UserRound } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui'

export function SettingsPage({
  project,
  account,
  canEditProject = false,
  onSave,
  onChangePassword,
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

  return (
    <div className="page settings-page">
      <PageHeader eyebrow="账号" title="个人资料" description="查看当前登录账号，并管理自己的登录安全。">
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
        <aside className="account-section">
          <span className="account-avatar">
            <UserRound size={22} />
          </span>
          <h2>{account.name}</h2>
          <p>{account.email}</p>
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
                minLength={12}
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
                minLength={12}
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
        </aside>
      </div>
    </div>
  )
}
