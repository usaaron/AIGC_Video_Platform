import { LogOut, Save, UserRound } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/ui'

export function SettingsPage({ project, account, onSave, onLogout }) {
  const [name, setName] = useState(project.name)
  const [synopsis, setSynopsis] = useState(project.synopsis)
  const [status, setStatus] = useState(project.status)

  return (
    <div className="page settings-page">
      <PageHeader eyebrow="项目 · 设置" title="项目设置" description="修改项目资料和制作状态。">
        <button className="button primary" onClick={() => onSave({ name, synopsis, status })}>
          <Save size={16} /> 保存设置
        </button>
      </PageHeader>
      <div className="settings-layout">
        <section className="settings-section">
          <h2>基本资料</h2>
          <label>
            <span>项目名称</span>
            <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>故事简介</span>
            <textarea value={synopsis} onChange={(event) => setSynopsis(event.target.value)} />
          </label>
          <label>
            <span>制作状态</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="draft">草稿</option>
              <option value="producing">制作中</option>
              <option value="completed">已完成</option>
              <option value="archived">已归档</option>
            </select>
          </label>
        </section>
        <aside className="account-section">
          <span className="account-avatar">
            <UserRound size={22} />
          </span>
          <h2>{account.name}</h2>
          <p>{account.email}</p>
          <dl>
            <div>
              <dt>角色</dt>
              <dd>{account.roles.join(', ')}</dd>
            </div>
            <div>
              <dt>账号 ID</dt>
              <dd>{account.id}</dd>
            </div>
          </dl>
          <button className="button secondary full" onClick={onLogout}>
            <LogOut size={16} /> 退出登录
          </button>
        </aside>
      </div>
    </div>
  )
}
