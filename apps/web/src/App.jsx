import { useEffect, useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { IconButton } from './components/ui'
import { useAuth } from './components/AuthProvider'
import { AdminPage } from './pages/AdminPage'
import { AssetsPage } from './pages/AssetsPage'
import { BillingPage } from './pages/BillingPage'
import { FilmPage } from './pages/FilmPage'
import { GenerationPage } from './pages/GenerationPage'
import { OverviewPage } from './pages/OverviewPage'
import { ScriptPage } from './pages/ScriptPage'
import { SettingsPage } from './pages/SettingsPage'
import { StoryboardPage } from './pages/StoryboardPage'
import { api } from './services/apiClient'

const kindByType = { 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' }

function App() {
  const { session, logout, refresh: refreshSession } = useAuth()
  const [activeStep, setActiveStep] = useState('overview')
  const [projects, setProjects] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [tasks, setTasks] = useState([])
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mobileNav, setMobileNav] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentShot, setCurrentShot] = useState(0)

  const adminOnly = session.account.roles.includes('admin') && !session.permissions.includes('project.write')

  useEffect(() => {
    if (adminOnly) return
    Promise.all([api.projects(), api.billing()])
      .then(async ([projectList, billingSummary]) => {
        setProjects(projectList)
        setBilling(billingSummary)
        if (projectList[0]) setWorkspace(await api.project(projectList[0].id))
      })
      .catch((error) => setToast(error.message))
      .finally(() => setLoading(false))
  }, [adminOnly])

  useEffect(() => {
    if (!workspace?.project.id) return undefined
    const loadTasks = () =>
      api
        .tasks(workspace.project.id)
        .then(setTasks)
        .catch(() => {})
    void loadTasks()
    const timer = window.setInterval(loadTasks, 1_500)
    return () => window.clearInterval(timer)
  }, [workspace?.project.id])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2_800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeStep])

  useEffect(() => {
    if (!playing || !workspace?.shots.length) return undefined
    const timer = window.setInterval(
      () => setCurrentShot((index) => (index + 1) % workspace.shots.length),
      2_400,
    )
    return () => window.clearInterval(timer)
  }, [playing, workspace?.shots.length])

  if (adminOnly) return <AdminPage />
  if (loading || !billing)
    return (
      <div className="app-loading">
        <LoaderCircle size={24} className="spin" />
        <p>正在加载项目…</p>
      </div>
    )

  const project = workspace?.project

  const refreshWorkspace = async (projectId = project?.id) => {
    if (!projectId) return
    const next = await api.project(projectId)
    setWorkspace(next)
    setProjects(await api.projects())
  }

  const refreshBilling = async () => {
    const next = await api.billing()
    setBilling(next)
    await refreshSession()
  }

  const createJob = async (label, type = '图片', cost = 6, options = {}) => {
    if (!project) return
    try {
      const kind = kindByType[type] || 'image'
      const provider =
        kind === 'image' ? 'img2' : kind === 'video' ? 'seedance' : kind === 'audio' ? 'audio' : 'local'
      await api.createTask({
        clientRequestId: crypto.randomUUID(),
        projectId: project.id,
        kind,
        label,
        prompt: options.prompt,
        negativePrompt: options.negativePrompt,
        provider,
        model: kind === 'video' ? 'seedance-2.0' : kind === 'image' ? 'img2-default' : undefined,
        estimatedCredits: cost,
        metadata: options.metadata,
      })
      setTasks(await api.tasks(project.id))
      await refreshBilling()
      setToast(`${label} 已加入生成队列`)
    } catch (error) {
      setToast(error.message)
    }
  }

  const navigateTo = (id) => {
    setActiveStep(id)
    setMobileNav(false)
  }

  const createProject = async (input) => {
    try {
      const created = await api.createProject(input)
      await refreshWorkspace(created.id)
      setNewProjectOpen(false)
      navigateTo('script')
      setToast('新项目已创建')
    } catch (error) {
      setToast(error.message)
    }
  }

  const updateProject = async (input, message = '项目已保存') => {
    try {
      await api.updateProject(project.id, input)
      await refreshWorkspace()
      setToast(message)
    } catch (error) {
      setToast(error.message)
    }
  }

  const renderContent = () => {
    if (!project) {
      return (
        <div className="page empty-workspace">
          <h1>创建第一个项目</h1>
          <p>从项目名称和画面比例开始。</p>
          <button className="button primary" onClick={() => setNewProjectOpen(true)}>
            新建项目
          </button>
        </div>
      )
    }

    const pages = {
      overview: (
        <OverviewPage
          project={project}
          assets={workspace.assets}
          shots={workspace.shots}
          jobs={tasks}
          billing={billing}
          setActiveStep={navigateTo}
          setNewProjectOpen={setNewProjectOpen}
        />
      ),
      script: (
        <ScriptPage
          project={project}
          onSave={(script) => updateProject({ script }, '剧本已保存')}
          onGenerate={() => createJob('剧本 · AI 扩写', '文本', 3)}
          onNext={() => navigateTo('assets')}
        />
      ),
      assets: (
        <AssetsPage
          project={project}
          assets={workspace.assets}
          tasks={tasks}
          billing={billing}
          onCreate={async (input) => {
            const created = await api.createAsset(project.id, input)
            await refreshWorkspace()
            setToast('资产已添加')
            return created
          }}
          onUpdate={async (assetId, input) => {
            await api.updateAsset(project.id, assetId, input)
            await refreshWorkspace()
            setToast('资产已更新')
          }}
          onDelete={async (assetId) => {
            await api.deleteAsset(project.id, assetId)
            await refreshWorkspace()
            setToast('资产已删除')
          }}
          onUpload={(file) => api.uploadMedia(project.id, file)}
          onGenerateStage={(asset, stage, prompt) => {
            const references =
              stage === 'face'
                ? asset.references
                : stage === 'body'
                  ? [asset.attributes.faceReference].filter(Boolean)
                  : [asset.attributes.faceReference, asset.attributes.bodyReference].filter(Boolean)
            const labels = { face: '面部大头照', body: '全身设定', turnaround: '三视图设定表' }
            const costs = { face: 4, body: 6, turnaround: 18 }
            return createJob(`${asset.name} · ${labels[stage]}`, '图片', costs[stage], {
              prompt,
              negativePrompt: asset.negativePrompt,
              metadata: {
                assetId: asset.id,
                assetKind: asset.kind,
                generationStage: stage,
                aspectRatio: stage === 'face' ? '1:1' : stage === 'turnaround' ? '16:9' : project.aspectRatio,
                sourceMode: asset.sourceMode,
                references,
                attributes: asset.attributes,
                turnaround: stage === 'turnaround',
                composeSheet: stage === 'turnaround',
                outputLayout: asset.attributes.turnaroundLayout,
              },
            })
          }}
          onGenerate={(asset) =>
            createJob(`${asset.name} · 重新生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
              prompt: asset.prompt,
              negativePrompt: asset.negativePrompt,
              metadata: {
                assetId: asset.id,
                assetKind: asset.kind,
                aspectRatio: project.aspectRatio,
                sourceMode: asset.sourceMode,
                references: asset.references,
                attributes: asset.attributes,
                turnaround: asset.attributes.turnaround === true || asset.attributes.view === 'turnaround',
              },
            })
          }
          onGenerateAll={(selectedAssets) =>
            selectedAssets.forEach(
              (asset) =>
                void createJob(`${asset.name} · 资产生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
                  prompt: asset.prompt,
                  negativePrompt: asset.negativePrompt,
                  metadata: {
                    assetId: asset.id,
                    assetKind: asset.kind,
                    aspectRatio: project.aspectRatio,
                    sourceMode: asset.sourceMode,
                    references: asset.references,
                    attributes: asset.attributes,
                    turnaround:
                      asset.attributes.turnaround === true || asset.attributes.view === 'turnaround',
                  },
                }),
            )
          }
          onNext={() => navigateTo('storyboard')}
        />
      ),
      storyboard: (
        <StoryboardPage
          shots={workspace.shots}
          onRegenerate={async () => {
            await api.generateShots(project.id)
            await refreshWorkspace()
            setToast('已根据剧本重新拆分分镜')
          }}
          onCreate={async (input) => {
            await api.createShot(project.id, input)
            await refreshWorkspace()
          }}
          onUpdate={async (shotId, input) => {
            await api.updateShot(project.id, shotId, input)
            await refreshWorkspace()
            setToast('分镜已更新')
          }}
          onGenerate={(shot) =>
            createJob(`镜头 ${String(shot.order).padStart(2, '0')} · ${shot.title}`, '视频', 18, {
              shotId: shot.id,
            })
          }
          onNext={() => navigateTo('generate')}
        />
      ),
      generate: (
        <GenerationPage
          jobs={tasks}
          concurrency={billing.concurrency}
          member={billing.plan === 'member'}
          onUpgrade={() => navigateTo('billing')}
          onClear={async () => {
            await api.clearTasks(project.id)
            setTasks(await api.tasks(project.id))
            setToast('已清理完成任务')
          }}
          onNext={() => navigateTo('film')}
        />
      ),
      film: (
        <FilmPage
          project={project}
          shots={workspace.shots}
          playing={playing}
          setPlaying={setPlaying}
          currentShot={currentShot}
          setCurrentShot={setCurrentShot}
          onSave={async () => {
            const saved = await api.saveVersion(project.id)
            await refreshWorkspace()
            setToast(`版本 v${saved.version} 已保存`)
          }}
          onEdit={() => navigateTo('storyboard')}
          onExport={() => exportProject(workspace, tasks)}
        />
      ),
      billing: (
        <BillingPage
          billing={billing}
          onPlanChange={async (plan) => {
            setBilling(await api.updatePlan(plan))
            await refreshSession()
            setToast(plan === 'member' ? '会员已开通，赠送 500 积分' : '已切换为免费版')
          }}
        />
      ),
      settings: (
        <SettingsPage
          key={project.id}
          project={project}
          account={session.account}
          onSave={updateProject}
          onLogout={logout}
        />
      ),
    }
    return pages[activeStep] || pages.overview
  }

  const runningJobs = tasks.filter((task) => task.status === 'running')

  return (
    <div className="app-shell">
      <AppHeader
        projectName={project?.name || '选择项目'}
        billing={billing}
        account={session.account}
        runningJobs={runningJobs}
        onOpenNav={() => setMobileNav(true)}
        onProjectClick={() => setProjectMenuOpen(true)}
        onCreditsClick={() => navigateTo('billing')}
        onPlanClick={() => navigateTo('billing')}
        onAccountClick={() => navigateTo('settings')}
      />
      <AppSidebar
        activeStep={activeStep}
        mobileNav={mobileNav}
        billing={billing}
        assetCount={workspace?.assets.length ?? 0}
        onNavigate={navigateTo}
        onClose={() => setMobileNav(false)}
      />
      {mobileNav && (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
      )}
      <main className="workspace">{renderContent()}</main>
      {newProjectOpen && (
        <NewProjectModal onClose={() => setNewProjectOpen(false)} onCreate={createProject} />
      )}
      {projectMenuOpen && (
        <ProjectMenu
          projects={projects}
          currentId={project?.id}
          onClose={() => setProjectMenuOpen(false)}
          onSelect={async (id) => {
            await refreshWorkspace(id)
            setProjectMenuOpen(false)
            navigateTo('overview')
          }}
          onCreate={() => {
            setProjectMenuOpen(false)
            setNewProjectOpen(true)
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={16} /> {toast}
        </div>
      )}
    </div>
  )
}

function ProjectMenu({ projects, currentId, onClose, onSelect, onCreate }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal project-menu" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">项目</span>
            <h2>切换项目</h2>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="project-menu-list">
          {projects.map((item) => (
            <button
              key={item.id}
              className={item.id === currentId ? 'active' : ''}
              onClick={() => onSelect(item.id)}
            >
              <span>{item.name}</span>
              <small>
                {item.status === 'producing' ? '制作中' : '草稿'} · v{item.version}
              </small>
              {item.id === currentId && <Check size={16} />}
            </button>
          ))}
        </div>
        <button className="button primary full" onClick={onCreate}>
          新建项目
        </button>
      </div>
    </div>
  )
}

function exportProject(workspace, tasks) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ ...workspace, tasks, exportedAt: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${workspace.project.name}-项目包.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default App
