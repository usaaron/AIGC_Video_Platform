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
  Settings,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { IconButton, StatusDot } from './ui'

const STEPS = [
  { id: 'overview', label: '项目概览', icon: LayoutDashboard },
  { id: 'script', label: '剧本', icon: BookOpenText },
  { id: 'assets', label: '角色资产', icon: UsersRound },
  { id: 'storyboard', label: '分镜', icon: Layers3 },
  { id: 'generate', label: '生成队列', icon: WandSparkles },
  { id: 'film', label: '成片', icon: Clapperboard },
]

export function AppHeader({
  projectName,
  credits,
  member,
  setMember,
  runningJobs,
  onOpenNav,
  onProjectClick,
  onCreditsClick,
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
          <Zap size={15} fill="currentColor" /> {credits} 积分
        </button>
        <button
          className={`plan-button ${member ? 'is-member' : ''}`}
          onClick={() => setMember((value) => !value)}
        >
          <Crown size={15} /> {member ? '创作会员' : '免费版'}
        </button>
        <div className="avatar">夏</div>
      </div>
    </header>
  )
}

export function AppSidebar({ activeStep, mobileNav, member, onNavigate, onClose }) {
  const activeIndex = STEPS.findIndex((item) => item.id === activeStep)

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
      <button className="sidebar-link">
        <PackageOpen size={17} /> 资产库 <span>12</span>
      </button>
      <button className="sidebar-link">
        <CircleDollarSign size={17} /> 积分账单
      </button>
      <button className="sidebar-link">
        <Settings size={17} /> 项目设置
      </button>
      <div className="usage-box">
        <div>
          <span>本月用量</span>
          <strong>714 / 1000</strong>
        </div>
        <div className="usage-track">
          <span />
        </div>
        <small>{member ? '会员并发 3 个任务' : '免费版并发 1 个任务'}</small>
      </div>
    </aside>
  )
}

export function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('未命名影片')

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
            <select>
              <option>短剧</option>
              <option>广告</option>
              <option>动画短片</option>
            </select>
          </label>
          <label>
            <span>画面比例</span>
            <select>
              <option>9:16 竖屏</option>
              <option>16:9 横屏</option>
              <option>1:1 方形</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" onClick={() => onCreate(name || '未命名影片')}>
            创建并写剧本 <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
