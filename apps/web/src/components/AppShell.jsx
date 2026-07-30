import { useState } from 'react'
import {
  Aperture,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clapperboard,
  Crown,
  FolderKanban,
  Layers3,
  LayoutDashboard,
  Menu,
  PackageOpen,
  UserCog,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { IconButton, StatusDot } from './ui'

const STEPS = [
  { id: 'overview', label: '项目概览', icon: LayoutDashboard },
  { id: 'script', label: '剧本', icon: BookOpenText },
  { id: 'assets', label: '资产设计', icon: UsersRound },
  { id: 'storyboard', label: '分镜', icon: Layers3 },
  { id: 'generate', label: '生成队列', icon: WandSparkles },
  { id: 'film', label: '成片', icon: Clapperboard },
]

export function AppHeader({
  projectName,
  billing,
  account,
  runningJobs,
  onOpenNav,
  onProjectClick,
  onCreditsClick,
  onPlanClick,
  onAccountClick,
}) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <button className="mobile-menu" onClick={onOpenNav} aria-label="打开导航">
          <Menu size={21} />
        </button>
        <div className="brand-mark">
          <Aperture size={20} />
        </div>
        <div className="brand-name">
          序幕 <span>SEQORA</span>
        </div>
      </div>
      <button className="project-switcher" onClick={onProjectClick}>
        <FolderKanban size={16} />
        <span>{projectName}</span>
        <ChevronDown size={15} />
      </button>
      <div className="top-actions">
        <div className="queue-indicator">
          <StatusDot status={runningJobs.length ? 'running' : 'completed'} />
          {runningJobs.length ? `${runningJobs.length} 个任务生成中` : '生成服务正常'}
        </div>
        <button className="credit-button" onClick={onCreditsClick}>
          <Zap size={15} fill="currentColor" /> {billing?.credits ?? 0} 积分
        </button>
        <button
          className={`plan-button ${billing?.plan === 'member' ? 'is-member' : ''}`}
          onClick={onPlanClick}
        >
          <Crown size={15} /> {billing?.plan === 'member' ? '创作会员' : '免费版'}
        </button>
        <button className="avatar" onClick={onAccountClick} title="账号设置">
          {account?.name?.slice(0, 1) ?? '用'}
        </button>
      </div>
    </header>
  )
}

export function AppSidebar({
  activeStep,
  mobileNav,
  billing,
  assetCount,
  canOpenAdminAccounts = false,
  onNavigate,
  onClose,
}) {
  const activeIndex = STEPS.findIndex((item) => item.id === activeStep)
  const usage = billing?.monthlyUsage
  const usageBudget = usage?.includedCredits || (usage?.netCredits ?? 0) + (billing?.credits ?? 0)
  const usagePercent = usageBudget
    ? Math.min(100, Math.round(((usage?.netCredits ?? 0) / usageBudget) * 100))
    : 0

  return (
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="mobile-sidebar-head">
        <div className="brand-name">创作流程</div>
        <IconButton label="关闭导航" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <div className="sidebar-label">创作流程</div>
      <nav>
        {STEPS.map((step, index) => {
          const Icon = step.icon
          return (
            <button
              key={step.id}
              className={`nav-item ${activeStep === step.id ? 'active' : ''}`}
              onClick={() => onNavigate(step.id)}
            >
              <span className={`nav-index ${index < activeIndex ? 'done' : ''}`}>
                {index < activeIndex ? <Check size={12} /> : index + 1}
              </span>
              <Icon size={17} />
              <span>{step.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-spacer" />
      <button className="sidebar-link" onClick={() => onNavigate('assets')}>
        <PackageOpen size={17} /> 资产库 <span>{assetCount}</span>
      </button>
      <button
        className={`sidebar-link ${activeStep === 'billing' ? 'active' : ''}`}
        onClick={() => onNavigate('billing')}
      >
        <CircleDollarSign size={17} /> 积分账单
      </button>
      <button
        className={`sidebar-link ${activeStep === 'settings' ? 'active' : ''}`}
        onClick={() => onNavigate('settings')}
      >
        <UserRound size={17} /> 个人资料
      </button>
      {canOpenAdminAccounts && (
        <button
          className={`sidebar-link ${activeStep === 'accounts' ? 'active' : ''}`}
          onClick={() => onNavigate('accounts')}
        >
          <UserCog size={17} /> 管理员端
        </button>
      )}
      <button
        type="button"
        className="usage-box"
        onClick={() => onNavigate('billing')}
        style={{ '--usage-progress': `${usagePercent}%` }}
      >
        <div>
          <span>可用积分</span>
          <strong>{billing?.credits ?? 0} 积分</strong>
        </div>
        <div className="usage-track">
          <span />
        </div>
        <small>
          本月已用 {usage?.netCredits ?? 0} · {usage?.generationCount ?? 0} 次计费
          {usage?.refundedCredits ? ` · 已退 ${usage.refundedCredits} 积分` : ''}
          {usage?.includedCredits ? ` · 月度 ${usage.includedCredits}` : ' · 按量使用'}
        </small>
      </button>
    </aside>
  )
}

export function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('未命名影片')
  const [contentType, setContentType] = useState('short-drama')
  const [aspectRatio, setAspectRatio] = useState('9:16')

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">新建项目</span>
            <h2>从一个故事开始</h2>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <label className="field-label" htmlFor="new-project-name">
          项目名称
        </label>
        <input
          className="text-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          id="new-project-name"
        />
        <div className="field-grid">
          <label>
            <span>内容类型</span>
            <select value={contentType} onChange={(event) => setContentType(event.target.value)}>
              <option value="short-drama">短剧</option>
              <option value="advertisement">广告</option>
              <option value="animation">动画短片</option>
            </select>
          </label>
          <label>
            <span>画面比例</span>
            <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            onClick={() => onCreate({ name: name || '未命名影片', contentType, aspectRatio })}
          >
            创建并写剧本 <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
