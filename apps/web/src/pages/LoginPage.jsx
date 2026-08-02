import { useEffect, useState } from 'react'
import {
  Aperture,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Ticket,
  UserPlus,
} from 'lucide-react'
import { useAuth } from '../components/AuthProvider'
import { api } from '../services/apiClient'
import './LoginPage.css'

export function LoginPage() {
  const registrationEntry = registrationEntryFromSearch(
    typeof window === 'undefined' ? '' : window.location.search,
  )
  const { login, register } = useAuth()
  const [mode, setMode] = useState(registrationEntry.mode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [token, setToken] = useState(registrationEntry.token)
  const [verificationCode, setVerificationCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [visible, setVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const isRegistering = mode === 'register'
  const isForgotPassword = mode === 'forgot'

  useEffect(() => {
    if (resendSeconds <= 0) return undefined
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [resendSeconds])

  const resetRegistrationCode = () => {
    setCodeSent(false)
    setVerificationCode('')
    setResendSeconds(0)
    setSuccess('')
  }

  const requestRegistrationCode = async () => {
    const result = await api.requestRegistrationCode({
      token: token.trim(),
      email: email.trim(),
    })
    setCodeSent(true)
    setResendSeconds(result.resendAfterSeconds)
    setSuccess(`验证码已发送至 ${email.trim()}，10 分钟内有效。`)
  }

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
        if (!codeSent) {
          await requestRegistrationCode()
        } else {
          await register({
            token: token.trim(),
            name: name.trim(),
            email: email.trim(),
            password,
            verificationCode,
          })
        }
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
    if (nextMode !== 'register') resetRegistrationCode()
  }

  const resendRegistrationCode = async () => {
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      await requestRegistrationCode()
    } catch (requestError) {
      setError(authErrorMessage(requestError, { isRegistering: true }))
    } finally {
      setSubmitting(false)
    }
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
            <h2>{isForgotPassword ? '找回密码' : isRegistering ? '验证邮箱并注册' : '欢迎回来'}</h2>
            <p>
              {isForgotPassword
                ? '输入账号邮箱，系统会发送密码重置链接。'
                : isRegistering
                  ? codeSent
                    ? '填写邮箱收到的 6 位验证码，完成账号创建。'
                    : '先验证受邀邮箱，再设置你的账号信息。'
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
                    onChange={(event) => {
                      setToken(event.target.value)
                      resetRegistrationCode()
                    }}
                    autoComplete="off"
                    placeholder="请输入邀请码"
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
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (isRegistering) resetRegistrationCode()
                }}
                autoComplete="email"
                placeholder="请输入账号邮箱"
                autoFocus
                required
              />
            </div>
          </label>
          {isRegistering && codeSent && (
            <>
              <label>
                <span>邮箱验证码</span>
                <div className="login-input registration-code-input">
                  <ShieldCheck size={17} />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={verificationCode}
                    onChange={(event) =>
                      setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    autoComplete="one-time-code"
                    placeholder="6 位验证码"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    required
                    autoFocus
                  />
                </div>
              </label>
              <button
                className="login-code-resend"
                type="button"
                disabled={submitting || resendSeconds > 0}
                onClick={resendRegistrationCode}
              >
                {resendSeconds > 0 ? `${resendSeconds} 秒后可重新发送` : '重新发送验证码'}
              </button>
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
          {!isForgotPassword && (!isRegistering || codeSent) && (
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
                {isForgotPassword
                  ? '发送重置邮件'
                  : isRegistering
                    ? codeSent
                      ? '验证并创建账号'
                      : '发送邮箱验证码'
                    : '进入工作台'}{' '}
                <ArrowRight size={17} />
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
            {isForgotPassword
              ? '重置邮件会发送到已注册邮箱'
              : isRegistering
                ? '仅限持有邀请码的受邀邮箱'
                : '仅限已开通账号'}
          </p>
        </form>
      </section>
    </main>
  )
}

export function registrationEntryFromSearch(search = '') {
  const token = new URLSearchParams(search).get('token')?.trim() ?? ''
  return { mode: token ? 'register' : 'login', token }
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
    case 'REGISTRATION_CODE_COOLDOWN':
      return '验证码发送过于频繁，请稍后再试'
    case 'REGISTRATION_CODE_REQUIRED':
      return '请先发送邮箱验证码'
    case 'REGISTRATION_CODE_EXPIRED':
      return '验证码已过期，请重新发送'
    case 'REGISTRATION_CODE_INVALID':
      return '验证码错误，请检查后重试'
    case 'REGISTRATION_CODE_LOCKED':
      return '验证码错误次数过多，请重新发送验证码'
    case 'REGISTRATION_CODE_USED':
      return '验证码已被使用，请重新发送'
    case 'VALIDATION_ERROR':
      return isRegistering
        ? '请检查邀请码、邮箱、6 位验证码和密码，密码至少 12 位。'
        : isForgotPassword
          ? '请检查邮箱格式。'
          : '请检查邮箱和密码。'
    case 'SERVICE_UNAVAILABLE':
      return '登录服务暂时不可用，请稍后重试'
    default:
      if (error?.status >= 500 || error?.name === 'TypeError') {
        return '无法连接登录服务，请确认 API 已启动后重试'
      }
      return error?.message || '请求失败，请稍后重试'
  }
}
