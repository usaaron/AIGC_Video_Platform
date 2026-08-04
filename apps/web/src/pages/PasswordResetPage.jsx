import { CheckCircle2, KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../services/apiClient'
import './LoginPage.css'

export function PasswordResetPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [state, setState] = useState({
    status: token ? 'idle' : 'error',
    message: token ? '' : '重置链接缺少 token。',
  })

  const submit = async (event) => {
    event.preventDefault()
    if (password !== confirmPassword) {
      setState({ status: 'error', message: '两次输入的新密码不一致。' })
      return
    }
    setState({ status: 'saving', message: '' })
    try {
      await api.resetPassword({ token, newPassword: password })
      setState({ status: 'success', message: '密码已重置，请使用新密码登录。' })
      setPassword('')
      setConfirmPassword('')
    } catch (error) {
      setState({ status: 'error', message: error.message })
    }
  }

  return (
    <main className="login-page auth-result-page">
      <section className="login-scene" aria-label="密码重置">
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
          <span>账号安全</span>
          <h1>重置密码，重新开场。</h1>
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
          <span>PASSWORD RESET</span>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="login-heading">
            <span className="eyebrow">账号安全</span>
            <h2>重置密码</h2>
            <p>设置一个至少 8 位的新密码。</p>
          </div>
          <label>
            <span>新密码</span>
            <div className="login-input">
              <LockKeyhole size={17} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                disabled={state.status === 'success' || !token}
              />
            </div>
          </label>
          <label>
            <span>确认新密码</span>
            <div className="login-input">
              <LockKeyhole size={17} />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                disabled={state.status === 'success' || !token}
              />
            </div>
          </label>
          {state.message && (
            <div className={state.status === 'success' ? 'login-success' : 'login-error'}>
              {state.status === 'success' && <CheckCircle2 size={16} />} {state.message}
            </div>
          )}
          {state.status === 'success' ? (
            <button className="login-submit" type="button" onClick={() => window.location.assign('/')}>
              返回登录
            </button>
          ) : (
            <button className="login-submit" disabled={state.status === 'saving' || !token}>
              {state.status === 'saving' ? <LoaderCircle size={18} className="spin" /> : '更新密码'}
            </button>
          )}
        </form>
      </section>
    </main>
  )
}
