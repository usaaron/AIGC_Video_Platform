import { useState } from 'react'
import {
  Aperture,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Ticket,
  UserPlus,
} from 'lucide-react'
import { useAuth } from '../components/AuthProvider'
import { api } from '../services/apiClient'
import './LoginPage.css'

export function LoginPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const isRegistering = mode === 'register'
  const isForgotPassword = mode === 'forgot'

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      if (isForgotPassword) {
        await api.requestPasswordReset({ email: email.trim() })
        setSuccess('如果邮箱已开通账号，密码重置邮件会发送到该邮箱。')
      } else if (isRegistering) {
        await register({
          token: token.trim(),
          name: name.trim(),
          email: email.trim(),
          password,
        })
      } else {
        if (password.trim().toUpperCase() === 'RESET REQUIRED') {
          throw new LoginInputError(
            '“RESET REQUIRED”是账号状态，不是登录密码。请让管理员在用户列表中点击“重置临时密码”。',
          )
        }
        await login({ email: email.trim(), password })
      }
    } catch (requestError) {
      setError(authErrorMessage(requestError, { isRegistering, isForgotPassword }))
    } finally {
      setSubmitting(false)
    }
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setSuccess('')
  }

  return (
    <main className="login-page">
      <section className="login-scene" aria-label="序幕创作工作台画面">
        <img src="/demo/station.jpg" alt="雨夜中的城市街道" />
        <div className="login-scene-overlay" />
        <div className="login-brand">
          <span>
            <Aperture size={20} />
          </span>
          序幕 <small>SEQORA</small>
        </div>
        <div className="login-story">
          <span>正在创作</span>
          <h1>从一个故事，到一部成片。</h1>
          <p>剧本、角色、分镜和生成任务，在同一个安静的工作台里完成。</p>
        </div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit} className="login-form">
          <div className="login-heading">
            <span className="eyebrow">创作工作台</span>
            <h2>{isForgotPassword ? '找回密码' : isRegistering ? '邀请码注册' : '欢迎回来'}</h2>
            <p>
              {isForgotPassword
                ? '输入账号邮箱，系统会发送密码重置链接。'
                : isRegistering
                  ? '使用受邀邮箱和邀请码创建账号。'
                  : '登录后继续你的项目。'}
            </p>
          </div>

          <div className="login-mode-switch" role="tablist" aria-label="账号入口">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegistering}
              className={!isRegistering ? 'is-active' : ''}
              onClick={() => switchMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegistering}
              className={isRegistering ? 'is-active' : ''}
              onClick={() => switchMode('register')}
            >
              注册
            </button>
          </div>

          {isRegistering && (
            <>
              <label>
                <span>邀请码</span>
                <div className="login-input">
                  <Ticket size={17} />
                  <input
                    type="text"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="one-time-code"
                    placeholder="请输入邀请码"
                    required
                  />
                </div>
              </label>
              <label>
                <span>用户名</span>
                <div className="login-input">
                  <UserPlus size={17} />
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder="请输入用户名"
                    required
                  />
                </div>
              </label>
            </>
          )}

          <label>
            <span>邮箱</span>
            <div className="login-input">
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="请输入账号邮箱"
                autoFocus
                required
              />
            </div>
          </label>
          {!isForgotPassword && (
            <label>
              <span>密码</span>
              <div className="login-input">
                <LockKeyhole size={17} />
                <input
                  type={visible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                  placeholder={isRegistering ? '至少 12 位密码' : '请输入密码'}
                  required
                  minLength={isRegistering ? 12 : undefined}
                />
                <button
                  type="button"
                  onClick={() => setVisible((value) => !value)}
                  aria-label={visible ? '隐藏密码' : '显示密码'}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
          )}
          {error && <div className="login-error">{error}</div>}
          {success && <div className="login-success">{success}</div>}
          <button className="login-submit" disabled={submitting}>
            {submitting ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <>
                {isForgotPassword ? '发送重置邮件' : isRegistering ? '创建账号' : '进入工作台'} <ArrowRight size={17} />
              </>
            )}
          </button>
          {!isRegistering && (
            <button
              className="login-link-button"
              type="button"
              onClick={() => switchMode(isForgotPassword ? 'login' : 'forgot')}
            >
              {isForgotPassword ? '返回登录' : '忘记密码？'}
            </button>
          )}
          <p className="login-access-note">
            <LockKeyhole size={14} />{' '}
            {isForgotPassword ? '重置邮件会发送到已注册邮箱' : isRegistering ? '仅限持有邀请码的受邀邮箱' : '仅限已开通账号'}
          </p>
        </form>
      </section>
    </main>
  )
}

class LoginInputError extends Error {}

export function authErrorMessage(error, { isRegistering = false, isForgotPassword = false } = {}) {
  if (error instanceof LoginInputError) return error.message
  switch (error?.code) {
    case 'INVALID_CREDENTIALS':
      return '邮箱或密码错误'
    case 'INVITATION_NOT_FOUND':
      return '邀请码无效或已重新生成'
    case 'INVITATION_NOT_PENDING':
      return '邀请码已被使用或撤销'
    case 'INVITATION_EXPIRED':
      return '邀请码已过期'
    case 'INVITATION_EMAIL_MISMATCH':
      return '邮箱与邀请码绑定的受邀邮箱不一致'
    case 'VALIDATION_ERROR':
      return isRegistering ? '请检查邀请码、邮箱和密码，密码至少 12 位。' : isForgotPassword ? '请检查邮箱格式。' : '请检查邮箱和密码。'
    case 'SERVICE_UNAVAILABLE':
      return '登录服务暂时不可用，请稍后重试'
    default:
      if (error?.status >= 500 || error?.name === 'TypeError') {
        return '无法连接登录服务，请确认 API 已启动后重试'
      }
      return error?.message || '请求失败，请稍后重试'
  }
}
