import {
  Activity,
  Aperture,
  DatabaseZap,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from './components/AuthProvider'
import { api } from './services/apiClient'

const ADMIN_PERMISSION = 'admin.dashboard.read'

export function App() {
  const { session, loading, login, logout } = useAuth()

  if (loading) return <LoadingState label="正在准备后台" />
  if (!session) return <LoginPage onLogin={login} />
  if (!session.permissions.includes(ADMIN_PERMISSION)) {
    return <AccessDenied account={session.account} onLogout={logout} />
  }

  return <AdminDashboard session={session} onLogout={logout} />
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('admin@seqora.local')
  const [password, setPassword] = useState('Admin123!')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onLogin({ email, password })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-login">
      <form className="admin-login-panel" onSubmit={submit}>
        <Brand />
        <div>
          <span className="eyebrow">管理员后台</span>
          <h1>平台运行与审计</h1>
          <p>管理员账号只进入后台，不显示创作工作台。</p>
        </div>
        <label>
          <span>邮箱</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <div className="admin-error">{error}</div>}
        <button className="primary-action" disabled={submitting}>
          {submitting ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}
          进入后台
        </button>
      </form>
    </main>
  )
}

function AdminDashboard({ session, onLogout }) {
  const [overview, setOverview] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])
  const [readiness, setReadiness] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [nextOverview, nextAudit, nextReadiness] = await Promise.all([
        api.adminOverview(),
        api.adminAuditLogs(20),
        api.healthReady(),
      ])
      setOverview(nextOverview)
      setAuditLogs(nextAudit.logs || [])
      setReadiness(nextReadiness)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="admin-app">
      <header className="admin-topbar">
        <Brand />
        <div className="admin-account">
          <span>{session.account.name}</span>
          <button onClick={onLogout}>
            <LogOut size={15} />
            退出
          </button>
        </div>
      </header>
      <main className="admin-workspace">
        <section className="admin-page-head">
          <div>
            <span className="eyebrow">后台总览</span>
            <h1>平台运行状态</h1>
            <p>独立后台只保留运营与排障所需信息，创作流程仍在主应用完成。</p>
          </div>
          <button className="secondary-action" onClick={load} disabled={loading}>
            {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            刷新
          </button>
        </section>

        {error && <div className="admin-error">{error}</div>}
        <section className="admin-grid">
          <MetricCard icon={UsersRound} label="用户数" value={overview?.users ?? '-'} tone="blue" />
          <MetricCard icon={Activity} label="活跃任务" value={overview?.activeTasks ?? '-'} tone="green" />
          <MetricCard
            icon={Zap}
            label="今日消耗"
            value={overview?.creditsConsumedToday ?? '-'}
            tone="amber"
          />
        </section>

        <section className="admin-panel health-panel">
          <div>
            <span className="panel-icon">
              <DatabaseZap size={20} />
            </span>
            <div>
              <h2>生产依赖</h2>
              <p>{readiness?.status === 'ok' ? 'API、数据存储和队列依赖可用。' : '等待健康检查结果。'}</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>数据</dt>
              <dd>{readiness?.checks?.database || '-'}</dd>
            </div>
            <div>
              <dt>队列</dt>
              <dd>{readiness?.checks?.queue || '-'}</dd>
            </div>
            <div>
              <dt>生成时间</dt>
              <dd>{overview?.generatedAt ? new Date(overview.generatedAt).toLocaleString('zh-CN') : '-'}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-panel audit-panel">
          <div className="panel-head">
            <div>
              <h2>最近审计日志</h2>
              <span>按租户隔离，只显示当前管理员可见记录。</span>
            </div>
          </div>
          <div className="audit-list">
            {auditLogs.length ? (
              auditLogs.map((entry) => <AuditRow entry={entry} key={entry.id} />)
            ) : (
              <p className="panel-empty">暂无审计日志。</p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, tone }) {
  return (
    <article className="metric-card">
      <span className={`metric-icon ${tone}`}>
        <Icon size={20} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  )
}

function AuditRow({ entry }) {
  return (
    <article className="audit-row">
      <span className={entry.outcome === 'success' ? 'good' : 'bad'}>{entry.outcome}</span>
      <div>
        <strong>
          {entry.method} {entry.path}
        </strong>
        <small>
          {entry.userId || 'anonymous'} · {entry.statusCode} ·{' '}
          {new Date(entry.createdAt).toLocaleString('zh-CN')}
        </small>
      </div>
    </article>
  )
}

function AccessDenied({ account, onLogout }) {
  return (
    <main className="admin-login">
      <section className="admin-login-panel">
        <Brand />
        <div>
          <span className="eyebrow">权限不足</span>
          <h1>{account.name} 无法访问后台</h1>
          <p>需要后端授予 `admin.dashboard.read` 权限。</p>
        </div>
        <button className="secondary-action" onClick={onLogout}>
          <LogOut size={15} />
          退出登录
        </button>
      </section>
    </main>
  )
}

function LoadingState({ label }) {
  return (
    <main className="admin-loading">
      <LoaderCircle size={24} className="spin" />
      <span>{label}</span>
    </main>
  )
}

function Brand() {
  return (
    <div className="admin-brand">
      <span>
        <Aperture size={20} />
      </span>
      <strong>序幕 Admin</strong>
    </div>
  )
}
