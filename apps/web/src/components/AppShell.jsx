import { useState } from 'react'
import {
  ArrowRight,
  Bell,
  BookOpenText,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clapperboard,
  Crown,
  FolderKanban,
  FolderOpen,
  ImagePlus,
  Layers3,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  PackageOpen,
  RefreshCw,
  Settings,
  UserCog,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { IconButton, StatusDot } from './ui'
import { FUNCTION_STACK_ITEMS } from '../features/functionStack/config'

const STEPS = [
  { id: 'overview', label: '项目概览', icon: LayoutDashboard },
  { id: 'script', label: '剧本', icon: BookOpenText },
  { id: 'assets', label: '资产设计', icon: UsersRound },
  { id: 'storyboard', label: '分镜', icon: Layers3 },
  { id: 'generate', label: '生成队列', icon: WandSparkles },
  { id: 'film', label: '成片', icon: Clapperboard },
]

const FUNCTION_STACK_ICONS = {
  'agent-studio': MessageSquareText,
  'image-studio': ImagePlus,
  'writing-studio': BookOpenText,
}

export function AppHeader({
  projectName,
  billing,
  account,
  runningJobs,
  notifications = [],
  onOpenNav,
  onProjectClick,
  onCreditsClick,
  onPlanClick,
  onAccountClick,
  onNotificationOpen,
  onNotificationRetry,
  onNotificationRead,
}) {
  const [notificationOpen, setNotificationOpen] = useState(false)
  const unread = notifications.filter((item) => !item.read)
  const hasUnreadFailure = unread.some((item) => item.status === 'failed')
  const hasUnreadSuccess = unread.some((item) => item.status === 'completed')
  return (
    <header className="topbar">
      <div className="brand-block">
        <button className="mobile-menu" onClick={onOpenNav} aria-label="打开导航">
          <Menu size={21} />
        </button>
        <BrandMark spin />
        <div className="brand-name">
          序幕
          <span>
            TV<sup className="brand-registered">™</sup>
          </span>
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
        <div
          className="notification-center"
          onMouseEnter={() => setNotificationOpen(true)}
          onMouseLeave={() => setNotificationOpen(false)}
        >
          <button
            type="button"
            className={`notification-trigger ${unread.length ? 'has-unread' : ''}`}
            aria-label={`消息中心，${unread.length} 条未读`}
            aria-expanded={notificationOpen}
            onClick={() => setNotificationOpen((current) => !current)}
          >
            <Bell size={17} />
            {(hasUnreadFailure || hasUnreadSuccess) && (
              <span className="notification-trigger-dots" aria-hidden="true">
                {hasUnreadFailure && <i className="failed" />}
                {hasUnreadSuccess && <i className="completed" />}
              </span>
            )}
          </button>
          {notificationOpen && (
            <div className="notification-popover">
              <header>
                <div>
                  <strong>消息中心</strong>
                  <span>{unread.length ? `${unread.length} 条未读` : '任务状态已同步'}</span>
                </div>
              </header>
              <div className="notification-list">
                {notifications.length ? (
                  notifications.slice(0, 10).map((notification) => (
                    <article
                      key={notification.id}
                      className={`${notification.status} ${notification.read ? 'read' : 'unread'}`}
                      onMouseEnter={() => onNotificationRead?.(notification.id)}
                    >
                      <span className="notification-status-dot" />
                      <button
                        type="button"
                        className="notification-preview"
                        onClick={() => void onNotificationOpen?.(notification)}
                      >
                        <strong>
                          {notification.title} · {notification.label}
                        </strong>
                        <span>{notification.projectName}</span>
                        <small>{notification.message}</small>
                      </button>
                      {notification.status === 'failed' && (
                        <button
                          type="button"
                          className="notification-retry"
                          title="使用原参数重试"
                          onClick={() => void onNotificationRetry?.(notification)}
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="notification-empty">
                    <Bell size={18} />
                    <span>暂无生成消息</span>
                  </div>
                )}
              </div>
            </div>
          )}
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
  adminConsoleUrl,
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
      <button
        className={`sidebar-home ${activeStep === 'home' ? 'active' : ''}`}
        onClick={() => onNavigate('home')}
      >
        <FolderOpen size={17} />
        <span>项目库</span>
      </button>
      <div className="sidebar-group-heading">
        <span>功能栈</span>
        <small>03</small>
      </div>
      <nav className="sidebar-tool-nav" aria-label="功能栈">
        {FUNCTION_STACK_ITEMS.map((item) => {
          const Icon = FUNCTION_STACK_ICONS[item.id]
          return (
            <button
              key={item.id}
              className={`sidebar-tool-item ${activeStep === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="sidebar-tool-icon">
                <Icon size={15} />
              </span>
              <span>{item.label}</span>
              <small>{item.id === 'writing-studio' ? '开发中' : '已启用'}</small>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-label">创作流程</div>
      <nav className="sidebar-flow-nav" aria-label="创作流程">
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
        <Settings size={17} /> 项目设置
      </button>
      {canOpenAdminAccounts && (
        <a className="sidebar-link" href={adminConsoleUrl} target="_blank" rel="noreferrer">
          <UserCog size={17} /> 管理后台
        </a>
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
  const [visualStyle, setVisualStyle] = useState('cinematic-cg')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const contentTypes = [
    ['short-drama', '网剧', '连续剧情与分集钩子'],
    ['advertisement', '广告', '产品或品牌传播'],
    ['animation', '短片', '完整独立叙事'],
  ]
  const visualStyles = [
    ['cinematic-cg', 'CG风', '影视化三维质感'],
    ['photorealistic', '仿真人', '真人摄影与真实材质'],
    ['chinese-2d', '2D风', '二维动画与插画表现'],
  ]

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
        <section className="new-project-choice-group">
          <span>内容类型</span>
          <div className="new-project-choice-grid" role="group" aria-label="内容类型">
            {contentTypes.map(([value, label, description]) => (
              <button
                type="button"
                key={value}
                className={contentType === value ? 'active' : ''}
                aria-pressed={contentType === value}
                onClick={() => setContentType(value)}
              >
                <strong>{label}</strong>
                <small>{description}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="new-project-choice-group">
          <span>项目视觉风格</span>
          <div className="new-project-choice-grid visual-style-grid" role="group" aria-label="项目视觉风格">
            {visualStyles.map(([value, label, description]) => (
              <button
                type="button"
                key={value}
                className={visualStyle === value ? 'active' : ''}
                aria-pressed={visualStyle === value}
                onClick={() => setVisualStyle(value)}
              >
                <strong>{label}</strong>
                <small>{description}</small>
              </button>
            ))}
          </div>
        </section>
        <div className="field-grid new-project-ratio">
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
            onClick={() =>
              onCreate({
                name: name || '未命名影片',
                contentType,
                visualStyle,
                aspectRatio,
                episodeDurationSeconds: contentType === 'short-drama' ? 60 : 30,
              })
            }
          >
            创建并写剧本 <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
