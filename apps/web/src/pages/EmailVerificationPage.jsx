import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import { AuthLayout } from '../components/AuthLayout'

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
    <AuthLayout>
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
    </AuthLayout>
  )
}
