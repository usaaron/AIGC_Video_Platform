import { CheckCircle2, LoaderCircle, LogOut, MailCheck, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import { api } from '../services/apiClient'
import './LoginPage.css'

export function EmailVerificationPendingPage({ account, onRefresh, onLogout }) {
  const [action, setAction] = useState('idle')
  const [message, setMessage] = useState('')

  const checkVerification = async () => {
    setAction('checking')
    setMessage('')
    try {
      const session = await onRefresh()
      if (session.account.emailVerified) return
      setMessage('邮箱尚未完成验证，请先点击验证邮件中的链接。')
    } catch (error) {
      setMessage(error.message || '暂时无法检查验证状态，请稍后重试。')
    } finally {
      setAction('idle')
    }
  }

  const resendVerification = async () => {
    setAction('sending')
    setMessage('')
    try {
      await api.requestEmailVerification({ email: account.email })
      setMessage('新的验证邮件已发送，请检查收件箱和垃圾邮件。')
    } catch (error) {
      setMessage(error.message || '验证邮件发送失败，请稍后重试。')
    } finally {
      setAction('idle')
    }
  }

  const busy = action !== 'idle'

  return (
    <main className="login-page auth-result-page">
      <section className="login-scene" aria-label="等待邮箱验证">
        <img src="/demo/station.jpg" alt="城市街道" />
        <div className="login-scene-overlay" />
        <div className="login-brand">
          <span>
            <MailCheck size={20} />
          </span>
          序幕 <small>SEQORA</small>
        </div>
        <div className="login-story">
          <span>账号安全</span>
          <h1>最后一步，验证你的邮箱。</h1>
          <p>完成邮箱验证后，项目库、积分和生成工作流会立即开放。</p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form auth-result verification-pending">
          <span className="auth-result-icon warning">
            <MailCheck size={28} />
          </span>
          <div className="login-heading">
            <span className="eyebrow">邮箱验证</span>
            <h2>请查收验证邮件</h2>
            <p>验证邮件已发送至以下邮箱。点击邮件内的链接后返回这里检查状态。</p>
          </div>
          <div className="verification-pending-email">
            <MailCheck size={17} />
            <strong>{account.email}</strong>
          </div>
          {message && (
            <div className="verification-pending-status" role="status">
              <CheckCircle2 size={15} />
              <span>{message}</span>
            </div>
          )}
          <div className="verification-pending-actions">
            <button className="login-submit" type="button" onClick={checkVerification} disabled={busy}>
              {action === 'checking' ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}
              我已完成验证
            </button>
            <button
              className="login-secondary-button"
              type="button"
              onClick={resendVerification}
              disabled={busy}
            >
              {action === 'sending' ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
              重新发送验证邮件
            </button>
            <button className="login-link-button" type="button" onClick={onLogout} disabled={busy}>
              <LogOut size={15} />
              退出登录
            </button>
          </div>
          <p className="login-access-note">没有收到邮件时，请先检查垃圾邮件，再尝试重新发送。</p>
        </div>
      </section>
    </main>
  )
}
