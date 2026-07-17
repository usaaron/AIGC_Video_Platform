import {
  Activity,
  Aperture,
  CircleDollarSign,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../components/AuthProvider'
import { api } from '../services/apiClient'

export function AdminPage() {
  const { session, logout } = useAuth()
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState('')

  const load = () =>
    api
      .adminOverview()
      .then(setOverview)
      .catch((requestError) => setError(requestError.message))

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="brand-block">
          <div className="brand-mark">
            <Aperture size={20} />
          </div>
          <div className="brand-name">
            序幕 <span>ADMIN</span>
          </div>
        </div>
        <div>
          <span>{session.account.name}</span>
          <button className="button secondary" onClick={logout}>
            <LogOut size={15} /> 退出
          </button>
        </div>
      </header>
      <main className="admin-main">
        <div className="page-header">
          <div>
            <span className="eyebrow">运营后台</span>
            <h1>平台概览</h1>
            <p>只展示需要运营关注的核心状态。</p>
          </div>
          <button className="button secondary" onClick={load}>
            <RefreshCw size={15} /> 刷新
          </button>
        </div>
        {error && <div className="login-error">{error}</div>}
        {overview && (
          <>
            <section className="admin-stats">
              <div>
                <span className="stat-icon blue">
                  <UsersRound size={20} />
                </span>
                <p>
                  用户数<strong>{overview.users}</strong>
                </p>
              </div>
              <div>
                <span className="stat-icon mint">
                  <Activity size={20} />
                </span>
                <p>
                  活跃任务<strong>{overview.activeTasks}</strong>
                </p>
              </div>
              <div>
                <span className="stat-icon amber">
                  <CircleDollarSign size={20} />
                </span>
                <p>
                  今日积分消耗<strong>{overview.creditsConsumedToday}</strong>
                </p>
              </div>
            </section>
            <section className="admin-status">
              <ShieldCheck size={22} />
              <div>
                <h2>权限系统正常</h2>
                <p>当前账号通过后端 `admin.dashboard.read` 权限访问此页面，创作者账号无法调用该接口。</p>
              </div>
              <span>{new Date(overview.generatedAt).toLocaleString('zh-CN')}</span>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
