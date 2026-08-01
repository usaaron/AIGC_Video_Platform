import { CheckCircle2, LoaderCircle, MailCheck, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../components/AuthProvider'
import { api } from '../services/apiClient'
import './LoginPage.css'

export function EmailVerificationPage() {
  const { refresh } = useAuth()
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
      .then(async () => {
        await refresh().catch(() => {})
        if (!cancelled) setState({ status: 'success', message: '邮箱已验证，可以继续使用工作台。' })
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', message: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const success = state.status === 'success'
  const checking = state.status === 'checking'

  return (
    <main className="login-page auth-result-page">
      <section className="login-scene" aria-label="邮箱验证">
        <img src="/demo/station.jpg" alt="城市街道" />
        <div className="login-scene-overlay" />
        <div className="login-brand">
          <span>
            <MailCheck size={20} />
          </span>
          序幕 <small>SEQORA</small>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form auth-result">
          <span className={success ? 'auth-result-icon success' : 'auth-result-icon error'}>
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
