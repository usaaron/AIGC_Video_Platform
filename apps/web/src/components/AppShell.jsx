import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Bell,
  BookOpenText,
  ChevronDown,
  Clapperboard,
  Crown,
  FolderKanban,
  FolderOpen,
  ImagePlus,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageSquareText,
  PackageOpen,
  RefreshCw,
  UserCog,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { StudioGuide } from './StudioGuide'
import { IconButton, StatusDot, TaskControls } from './ui'
import { FUNCTION_STACK_ITEMS } from '../features/functionStack/config'
import { workflowNavigationBlockMessage } from '../features/workspace/workspaceLoadingPolicy'

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

function taskStatusLabel(task) {
  if (task.status === 'queued') return '等待生成'
  if (task.status === 'paused') return '已暂停，可继续'
  if (task.status === 'running') return `生成中 ${task.progress || 0}% · 可确认停止，积分不退还`
  return task.status || '处理中'
}

export function AppHeader({
  projectName,
  billing,
  account,
  runningJobs,
  tasks = [],
  busyTaskId = null,
  onPause,
  onResume,
  onDelete,
  notifications = [],
  onOpenNav,
  onProjectClick,
  onCreditsClick,
  onPlanClick,
  onAccountClick,
  onNavigate,
  onNotificationOpen,
  onNotificationRetry,
  onNotificationRead,
  onNotificationsClear,
}) {
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const notificationCenterRef = useRef(null)
  const taskCenterRef = useRef(null)
  const unread = notifications.filter((item) => !item.read)
  const hasUnreadFailure = unread.some((item) => item.status === 'failed')
  const hasUnreadSuccess = unread.some((item) => item.status === 'completed')
  const planLabel =
    billing?.billingScope === 'organization' ? '组织账户' : billing?.plan === 'member' ? '创作会员' : '免费版'

  useEffect(() => {
    if (!notificationOpen) return undefined
    const closeOutside = (event) => {
      if (!notificationCenterRef.current?.contains(event.target)) setNotificationOpen(false)
    }
    const closeWithKeyboard = (event) => {
      if (event.key === 'Escape') setNotificationOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithKeyboard)
    }
  }, [notificationOpen])

  useEffect(() => {
    if (!taskOpen) return undefined
    const closeOutside = (event) => {
      if (!taskCenterRef.current?.contains(event.target)) setTaskOpen(false)
    }
    const closeWithKeyboard = (event) => {
      if (event.key === 'Escape') setTaskOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithKeyboard)
    }
  }, [taskOpen])

  const activeTasks = tasks.filter(
    (task) => ['queued', 'paused', 'running'].includes(task.status) && typeof task.metadata?.queueHiddenAt !== 'string',
  )

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
        {onNavigate && <StudioGuide onNavigate={onNavigate} />}
        <div className="task-center" ref={taskCenterRef}>
          <button
            type="button"
            className="queue-indicator"
            aria-label="打开生成任务控制"
            aria-expanded={taskOpen}
            onClick={() => setTaskOpen((current) => !current)}
          >
            <StatusDot status={activeTasks.length ? 'running' : 'completed'} />
            {activeTasks.length ? `${activeTasks.length} 个任务处理中` : '暂无生成任务'}
          </button>
          {taskOpen && (
            <div className="task-popover" role="dialog" aria-label="生成任务控制">
              <header>
                <div>
                  <strong>生成任务</strong>
                  <span>{activeTasks.length ? `${activeTasks.length} 项进行中` : '当前没有进行中的任务'}</span>
                </div>
                <IconButton label="关闭任务控制" onClick={() => setTaskOpen(false)}>
                  <X size={16} />
                </IconButton>
              </header>
              <div className="task-popover-list">
                {activeTasks.length ? (
                  activeTasks.map((task) => (
                    <article key={task.id} className={`task-popover-item ${task.status}`}>
                      <div className="task-popover-copy">
                        <strong>{task.label || '生成任务'}</strong>
                        <span>{taskStatusLabel(task)}</span>
                      </div>
                      <TaskControls
                        job={task}
                        busy={busyTaskId === task.id}
                        onPause={() => void onPause?.(task.id)}
                        onResume={() => void onResume?.(task.id)}
                        onDelete={() => void onDelete?.(task.id)}
                      />
                    </article>
                  ))
                ) : (
                  <div className="task-popover-empty">任务完成后会在这里显示状态。</div>
                )}
              </div>
            </div>
          )}
        </div>
        <div
          ref={notificationCenterRef}
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
                <div className="notification-popover-actions">
                  {notifications.length > 0 && (
                    <button
                      type="button"
                      className="notification-clear"
                      onClick={() => {
                        onNotificationsClear?.()
                        setNotificationOpen(false)
                      }}
                    >
                      清空
                    </button>
                  )}
                  <IconButton label="关闭消息中心" onClick={() => setNotificationOpen(false)}>
                    <X size={16} />
                  </IconButton>
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
                        onClick={() => {
                          setNotificationOpen(false)
                          void onNotificationOpen?.(notification)
                        }}
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
        <button
          className="credit-button"
          onClick={onCreditsClick}
          title={billing?.billingScope === 'organization' ? '组织共享积分账单' : '积分充值'}
        >
          <Zap size={15} fill="currentColor" /> {billing?.credits ?? 0} 积分
        </button>
        <button
          className={`plan-button ${billing?.plan === 'member' && billing?.billingScope !== 'organization' ? 'is-member' : ''}`}
          onClick={onPlanClick}
          aria-label={planLabel}
          title={planLabel}
        >
          <Crown size={15} />
          <span className="plan-button-label">{planLabel}</span>
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
  workflowAccess = {},
  canOpenAdminAccounts = false,
  adminConsoleUrl,
  onNavigate,
  onClose,
}) {
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
        <small>{String(FUNCTION_STACK_ITEMS.length).padStart(2, '0')}</small>
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
              <small>
                {item.availability === 'coming-soon'
                  ? '筹备中'
                  : item.availability === 'testing'
                    ? '测试中'
                    : '已启用'}
              </small>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-label">创作流程</div>
      <nav className="sidebar-flow-nav" aria-label="创作流程">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          const locked = workflowAccess[step.id] === false
          return (
            <button
              key={step.id}
              className={`nav-item ${activeStep === step.id ? 'active' : ''} ${locked ? 'is-locked' : ''}`}
              aria-disabled={locked || undefined}
              title={locked ? workflowNavigationBlockMessage(step.id, workflowAccess) : undefined}
              onClick={() => onNavigate(step.id)}
            >
              <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>
              <Icon size={17} />
              <span>{step.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-spacer" />
      <button
        className={`sidebar-link ${activeStep === 'library' ? 'active' : ''}`}
        onClick={() => onNavigate('library')}
      >
        <PackageOpen size={17} /> 资产库 <span>{assetCount}</span>
      </button>
      {billing?.billingScope !== 'organization' && (
        <button
          className={`sidebar-link ${activeStep === 'membership' ? 'active' : ''}`}
          onClick={() => onNavigate('membership')}
        >
          <Crown size={17} /> 会员中心
        </button>
      )}
      {billing?.billingScope !== 'organization' && (
        <button
          className={`sidebar-link ${activeStep === 'recharge' ? 'active' : ''}`}
          onClick={() => onNavigate('recharge')}
        >
          <Zap size={17} /> 积分充值
        </button>
      )}
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
          <span>{billing?.billingScope === 'organization' ? '组织共享积分' : '可用积分'}</span>
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
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
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

  const requestClose = () => {
    if (!creating) onClose()
  }

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    setCreateError('')
    try {
      await onCreate({
        name: name.trim() || '未命名影片',
        contentType,
        visualStyle,
        aspectRatio,
        episodeDurationSeconds: contentType === 'short-drama' ? 60 : 30,
      })
    } catch (error) {
      setCreateError(error?.message || '项目创建失败，请重试。')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={requestClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">新建项目</span>
            <h2>从一个故事开始</h2>
          </div>
          <IconButton label="关闭" disabled={creating} onClick={requestClose}>
            <X size={20} />
          </IconButton>
        </div>
        <label className="field-label" htmlFor="new-project-name">
          项目名称
        </label>
        <input
          className="text-input"
          value={name}
          disabled={creating}
          placeholder="输入项目名称"
          onFocus={() => setName((current) => (current === '未命名影片' ? '' : current))}
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
                disabled={creating}
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
                disabled={creating}
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
            <select
              value={aspectRatio}
              disabled={creating}
              onChange={(event) => setAspectRatio(event.target.value)}
            >
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </label>
        </div>
        {createError && (
          <p className="operation-error" role="alert">
            {createError}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" disabled={creating} onClick={requestClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={creating}
            aria-busy={creating}
            onClick={() => void handleCreate()}
          >
            {creating ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
            {creating ? '正在创建项目' : '创建并写剧本'}
          </button>
        </div>
      </div>
    </div>
  )
}
