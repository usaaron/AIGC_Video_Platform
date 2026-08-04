import { CheckCircle2, KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import './LoginPage.css'

export function RequiredPasswordChangePage({ account, onChangePassword, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [state, setState] = useState({ status: 'idle', message: '' })

  const submit = async (event) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setState({ status: 'error', message: '两次输入的新密码不一致' })
      return
    }
    if (currentPassword === newPassword) {
      setState({ status: 'error', message: '新密码不能与临时密码相同' })
      return
    }
    setState({ status: 'saving', message: '' })
    try {
      await onChangePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setState({ status: 'success', message: '新密码已生效，请重新登录' })
    } catch (error) {
      setState({
        status: 'error',
        message:
          error?.code === 'CURRENT_PASSWORD_INVALID'
            ? '临时密码不正确，请联系管理员重新设置'
            : error?.message || '密码更新失败，请稍后重试',
      })
    }
  }

  const completed = state.status === 'success'

  return (
    <main className="login-page">
      <section className="login-scene" aria-label="账号安全验证">
        <img src="/demo/room.jpg" alt="暖光中的电影创作空间" />
        <div className="login-scene-overlay" />
        <div className="login-scene-frame" aria-hidden="true">
          <span>02</span>
          <span>ACCOUNT / SECURITY</span>
        </div>
        <div className="login-scanline" aria-hidden="true" />
        <div className="login-brand">
          <span>
            <KeyRound size={20} />
          </span>
          <div>
            <strong>序幕TV</strong>
            <small>序幕TV创作工作台</small>
          </div>
        </div>
        <div className="login-story">
          <span>账号保护</span>
          <h1>先设置自己的密码。</h1>
          <p>临时密码只用于首次登录，更新后原有登录会话将自动失效。</p>
        </div>
        <div className="login-scene-footer" aria-hidden="true">
          <span>SECURE FRAME</span>
          <i />
          <span>序幕TV</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-panel-meta" aria-hidden="true">
          <span>序幕TV</span>
          <i />
          <span>ACCOUNT SECURITY</span>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="login-heading">
            <span className="eyebrow">首次登录</span>
            <h2>修改临时密码</h2>
            <p>{account.email}</p>
          </div>

          <div className="login-security-note">
            <LockKeyhole size={17} />
            <div>
              <strong>必须完成此步骤</strong>
              <span>请输入管理员给你的临时密码，再设置至少 8 位的新密码。</span>
            </div>
          </div>

          {!completed && (
            <>
              <PasswordField
                label="临时密码"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <PasswordField
                label="新密码"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                minLength={8}
              />
              <PasswordField
                label="确认新密码"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                minLength={8}
              />
            </>
          )}

          {state.message && (
            <div className={completed ? 'login-success' : 'login-error'} role="status">
              {completed && <CheckCircle2 size={16} />} {state.message}
            </div>
          )}

          {completed ? (
            <button className="login-submit" type="button" onClick={onLogout}>
              使用新密码登录
            </button>
          ) : (
            <button className="login-submit" disabled={state.status === 'saving'}>
              {state.status === 'saving' ? <LoaderCircle size={18} className="spin" /> : '确认修改密码'}
            </button>
          )}
        </form>
      </section>
    </main>
  )
}

function PasswordField({ label, value, onChange, autoComplete, minLength }) {
  return (
    <label>
      <span>{label}</span>
      <div className="login-input">
        <LockKeyhole size={17} />
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={128}
          required
        />
      </div>
    </label>
  )
}
