import { CheckCircle2, LoaderCircle, MailCheck, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import './LoginPage.css'

export function EmailVerificationPage() {
  const [state, setState] = useState({ status: 'checking', message: '正在验证邮箱...' })

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? ''
    if (!token) {
      setState({ status: 'error', message: '验证链接缺少 token。' })
      return
    }
    let cancelled = false
    api
      .verifyEmail({ token })
      .then(() => {
        if (!cancelled) setState({ status: 'success', message: '邮箱已验证，可以继续使用工作台。' })
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', message: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const success = state.status === 'success'
  const checking = state.status === 'checking'

  return (
    <main className="login-page auth-result-page">
      <section className="login-scene" aria-label="邮箱验证">
        <img src="/demo/room.jpg" alt="暖光中的电影创作空间" />
        <div className="login-scene-overlay" />
        <div className="login-scene-frame" aria-hidden="true">
          <span>02</span>
          <span>ACCOUNT / SECURITY</span>
        </div>
        <div className="login-scanline" aria-hidden="true" />
        <div className="login-brand">
          <span>
            <MailCheck size={20} />
          </span>
          <div>
            <strong>序幕TV</strong>
            <small>序幕TV创作工作台</small>
          </div>
        </div>
        <div className="login-story">
          <span>账号验证</span>
          <h1>确认身份，继续开场。</h1>
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
          <span>EMAIL VERIFICATION</span>
        </div>
        <div className="login-form auth-result">
          <span className={`auth-result-icon ${checking ? 'checking' : success ? 'success' : 'error'}`}>
            {checking ? (
              <LoaderCircle size={28} className="spin" />
            ) : success ? (
              <CheckCircle2 size={28} />
            ) : (
              <XCircle size={28} />
            )}
          </span>
          <div className="login-heading">
            <span className="eyebrow">邮箱验证</span>
            <h2>{checking ? '正在验证' : success ? '验证完成' : '验证失败'}</h2>
            <p>{state.message}</p>
          </div>
          <button className="login-submit" type="button" onClick={() => window.location.assign('/')}>
            返回工作台
          </button>
        </div>
      </section>
    </main>
  )
}
