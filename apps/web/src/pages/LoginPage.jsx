import { useState } from 'react'
import { Aperture, ArrowRight, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { useAuth } from '../components/AuthProvider'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('creator@seqora.local')
  const [password, setPassword] = useState('Creator123!')
  const [visible, setVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await login({ email, password })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-scene" aria-label="午夜胶片项目画面">
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
            <h2>欢迎回来</h2>
            <p>登录后继续你的项目。</p>
          </div>
          <label>
            <span>邮箱</span>
            <div className="login-input">
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div className="login-input">
              <LockKeyhole size={17} />
              <input
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
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
          {error && <div className="login-error">{error}</div>}
          <button className="login-submit" disabled={submitting}>
            {submitting ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <>
                进入工作台 <ArrowRight size={17} />
              </>
            )}
          </button>
          <div className="demo-accounts">
            <div>
              <Check size={14} />
              <span>创作者</span>
              <code>creator@seqora.local / Creator123!</code>
            </div>
            <button
              type="button"
              onClick={() => {
                setEmail('admin@seqora.local')
                setPassword('Admin123!')
              }}
            >
              切换管理员
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
