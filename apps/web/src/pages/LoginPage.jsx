import { useEffect, useState } from 'react'
import {
  Aperture,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  Phone,
  QrCode,
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
    typeof window === 'undefined' ? '' : window.location.pathname,
  )
  const { login, loginWithPhone, completeWechatQrLogin } = useAuth()
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
  const [errorCode, setErrorCode] = useState('')
  const [success, setSuccess] = useState('')
  const [loginMethod, setLoginMethod] = useState('password')
  const [phone, setPhone] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [phoneResendSeconds, setPhoneResendSeconds] = useState(0)
  const [qrSession, setQrSession] = useState(null)
  const [qrStatus, setQrStatus] = useState('idle')
  const [qrMessage, setQrMessage] = useState('')

  const isRegistering = mode === 'register'
  const isForgotPassword = mode === 'forgot'

  useEffect(() => {
    if (resendSeconds <= 0) return undefined
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [resendSeconds])

  useEffect(() => {
    if (phoneResendSeconds <= 0) return undefined
    const timer = window.setInterval(() => {
      setPhoneResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [phoneResendSeconds])

  useEffect(() => {
    if (!qrSession) return undefined
    let cancelled = false
    const poll = async () => {
      try {
        const result = await api.pollWechatQrLogin(qrSession.sessionId)
        if (cancelled) return
        setQrStatus(result.status)
        setQrMessage(result.message ?? '')
        if (result.status === 'completed') await completeWechatQrLogin()
      } catch (requestError) {
        if (!cancelled) {
          setQrStatus('error')
          setQrMessage(authErrorMessage(requestError))
        }
      }
    }
    const timer = window.setInterval(poll, qrSession.pollAfterMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [qrSession])

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

  const requestPhoneCode = async () => {
    const result = await api.requestPhoneLoginCode({ phone: phone.trim() })
    setPhoneCodeSent(true)
    setPhoneResendSeconds(result.resendAfterSeconds)
    setSuccess(`验证码已发送至 ${phone.trim()}，10 分钟内有效。`)
  }

  const startWechatQrLogin = async () => {
    setSubmitting(true)
    setError('')
    setSuccess('')
    setQrMessage('')
    setQrStatus('loading')
    try {
      const result = await api.startWechatQrLogin()
      setQrSession(result)
      setQrStatus(result.status)
    } catch (requestError) {
      setQrSession(null)
      setQrStatus('error')
      setQrMessage(authErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setErrorCode('')
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
      } else if (loginMethod === 'phone') {
        if (!phoneCodeSent) {
          await requestPhoneCode()
        } else {
          await loginWithPhone({ phone: phone.trim(), verificationCode: phoneCode })
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
      setErrorCode(requestError?.code ?? '')
      setError(authErrorMessage(requestError, { isRegistering, isForgotPassword }))
    } finally {
      setSubmitting(false)
    }
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setErrorCode('')
    setSuccess('')
    if (nextMode !== 'register') resetRegistrationCode()
    if (nextMode !== 'login') {
      setLoginMethod('password')
      setPhoneCodeSent(false)
      setPhoneCode('')
      setQrSession(null)
      setQrStatus('idle')
    }
  }

  const switchLoginMethod = (nextMethod) => {
    setLoginMethod(nextMethod)
    setError('')
    setErrorCode('')
    setSuccess('')
    setPhoneCodeSent(false)
    setPhoneCode('')
    setPhoneResendSeconds(0)
    setQrSession(null)
    setQrStatus('idle')
    setQrMessage('')
  }

  const resendRegistrationCode = async () => {
    setSubmitting(true)
    setError('')
    setErrorCode('')
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
      <section className="login-scene" aria-label="序幕TV 创作工作台">
        <img src="/demo/room.jpg" alt="暖光中的电影创作空间" />
        <div className="login-scene-overlay" />
        <div className="login-scene-frame" aria-hidden="true">
          <span>01</span>
          <span>序幕TV™ ORIGINALS</span>
        </div>
        <div className="login-scanline" aria-hidden="true" />
        <div className="login-brand">
          <span>
            <Aperture size={20} />
          </span>
          <div>
            <strong>
              序幕TV<sup className="login-brand-mark">™</sup>
            </strong>
            <small>序幕TV创作工作台</small>
          </div>
        </div>
        <div className="login-story">
          <span>序幕TV™ · AI CINEMATIC STUDIO</span>
          <h1>
            “序幕起，<em>好戏生。</em>”
          </h1>
          <div className="login-story-timeline" aria-hidden="true">
            <i />
            <span>00:00:01</span>
          </div>
        </div>
        <div className="login-scene-footer" aria-hidden="true">
          <span>FRAME 01</span>
          <i />
          <span>24 FPS</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-panel-meta" aria-hidden="true">
          <span>序幕TV™</span>
          <i />
          <span>SECURE ACCESS</span>
        </div>
        <form onSubmit={submit} className="login-form login-entry-form">
          <div className="login-heading">
            <span className="eyebrow">序幕TV™ · 创作工作台</span>
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

          {!isRegistering && !isForgotPassword && (
            <div className="login-method-switch" role="tablist" aria-label="登录方式">
              <button
                type="button"
                role="tab"
                aria-selected={loginMethod === 'password'}
                className={loginMethod === 'password' ? 'is-active' : ''}
                onClick={() => switchLoginMethod('password')}
              >
                <Mail size={14} /> 邮箱密码
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={loginMethod === 'phone'}
                className={loginMethod === 'phone' ? 'is-active' : ''}
                onClick={() => switchLoginMethod('phone')}
              >
                <Phone size={14} /> 手机验证码
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={loginMethod === 'wechat'}
                className={loginMethod === 'wechat' ? 'is-active' : ''}
                onClick={() => switchLoginMethod('wechat')}
              >
                <MessageCircle size={14} /> 微信扫码
              </button>
            </div>
          )}

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

          {loginMethod === 'wechat' && !isRegistering && !isForgotPassword ? (
            <div className="login-qr-panel" aria-label="微信扫码登录">
              <div className="login-qr-frame">
                {qrSession?.qrCodeUrl ? (
                  <img src={qrSession.qrCodeUrl} alt="微信登录二维码" />
                ) : (
                  <QrCode size={44} />
                )}
              </div>
              <strong>{qrStatus === 'waiting' ? '请使用微信扫描二维码' : '微信扫码登录'}</strong>
              <p>{qrMessage || '二维码由服务端生成，登录状态会自动确认。'}</p>
              <button
                className="login-secondary-button"
                type="button"
                onClick={startWechatQrLogin}
                disabled={submitting || qrStatus === 'waiting'}
              >
                {submitting ? <LoaderCircle size={17} className="spin" /> : <QrCode size={17} />}
                {qrStatus === 'waiting' ? '等待扫码' : '获取登录二维码'}
              </button>
            </div>
          ) : (
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
          )}
          {loginMethod === 'phone' && !isRegistering && !isForgotPassword && (
            <>
              <label>
                <span>手机号</span>
                <div className="login-input">
                  <Phone size={17} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))
                      setPhoneCodeSent(false)
                    }}
                    autoComplete="tel"
                    placeholder="请输入 11 位手机号"
                    required
                  />
                </div>
              </label>
              {phoneCodeSent && (
                <label>
                  <span>短信验证码</span>
                  <div className="login-input registration-code-input">
                    <ShieldCheck size={17} />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={phoneCode}
                      onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      autoComplete="one-time-code"
                      placeholder="6 位验证码"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      required
                    />
                  </div>
                  <button
                    className="login-code-resend"
                    type="button"
                    disabled={submitting || phoneResendSeconds > 0}
                    onClick={requestPhoneCode}
                  >
                    {phoneResendSeconds > 0 ? `${phoneResendSeconds} 秒后可重新发送` : '重新发送验证码'}
                  </button>
                </label>
              )}
            </>
          )}
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
                <span>显示名称</span>
                <div className="login-input">
                  <UserPlus size={17} />
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder="请输入显示名称"
                    required
                  />
                </div>
                <small className="login-field-hint">仅用于展示，可以与其他用户相同。</small>
              </label>
            </>
          )}
          {!isForgotPassword &&
            loginMethod !== 'wechat' &&
            (!isRegistering || codeSent) &&
            loginMethod !== 'phone' && (
              <label>
                <span>密码</span>
                <div className="login-input">
                  <LockKeyhole size={17} />
                  <input
                    type={visible ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isRegistering ? 'new-password' : 'current-password'}
                    placeholder={isRegistering ? '至少 8 位密码' : '请输入密码'}
                    required
                    minLength={isRegistering ? 8 : undefined}
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
          {error && (
            <div className="login-error">
              <span>{error}</span>
              {errorCode === 'INVITATION_ACCOUNT_PASSWORD_INVALID' && (
                <button type="button" onClick={() => switchMode('forgot')}>
                  重置已有账号密码
                </button>
              )}
            </div>
          )}
          {success && <div className="login-success">{success}</div>}
          {loginMethod !== 'wechat' && (
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
                      : loginMethod === 'phone'
                        ? phoneCodeSent
                          ? '验证码登录'
                          : '发送手机验证码'
                        : '进入工作台'}{' '}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          )}
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
                ? '邀请码将在首次发送验证码时绑定当前邮箱'
                : loginMethod === 'phone'
                  ? '短信验证码仅用于身份认证，不会展示或保存明文验证码'
                  : loginMethod === 'wechat'
                    ? '微信只会返回经过授权的登录身份，不会读取聊天内容'
                    : '仅限已开通账号'}
          </p>
        </form>
      </section>
    </main>
  )
}

export function registrationEntryFromSearch(search = '', pathname = '') {
  const token = new URLSearchParams(search).get('token')?.trim() ?? ''
  return { mode: token || pathname === '/register' ? 'register' : 'login', token }
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
    case 'INVITATION_EMAIL_ALREADY_PENDING':
      return '该邮箱已有待使用的邀请码，请使用原邀请码或联系管理员撤销'
    case 'INVITATION_ACCOUNT_PASSWORD_INVALID':
      return '该邮箱已有账号。这里需要输入原登录密码；如果忘记密码，请先重置密码。'
    case 'MEMBERSHIP_ALREADY_EXISTS':
      return '该邮箱已经加入当前组织，请直接登录'
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
        ? '请检查邀请码、邮箱、6 位验证码和密码，密码至少 8 位。'
        : isForgotPassword
          ? '请检查邮箱格式。'
          : '请检查邮箱和密码。'
    case 'SERVICE_UNAVAILABLE':
      return '登录服务暂时不可用，请稍后重试'
    case 'AUTH_PROVIDER_NOT_CONFIGURED':
      return '该登录方式尚未配置，请联系管理员或使用邮箱密码登录'
    default:
      if (error?.status >= 500 || error?.name === 'TypeError') {
        return '无法连接登录服务，请确认 API 已启动后重试'
      }
      return error?.message || '请求失败，请稍后重试'
  }
}
