import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { ProjectMenu } from './components/ProjectMenu'
import { useAuth } from './components/AuthProvider'
import { AdminPage } from './pages/AdminPage'
import { WorkspaceRouter } from './pages/WorkspaceRouter'
import { hasNewCompletedAssetTasks } from './features/generation/completedTaskSync'
import { hasCompletedVideoForShot } from './features/generation/taskResults'
import { createWorkspaceActions } from './features/generation/workspaceActions'
import { api } from './services/apiClient'

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
  const [taskPollError, setTaskPollError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentShot, setCurrentShot] = useState(0)
  const syncedAssetTaskKeys = useRef(new Set())

  const adminOnly = session.account.roles.includes('admin') && !session.permissions.includes('project.write')
  const currentShotId = workspace?.shots[currentShot]?.id
  const currentShotHasVideo = Boolean(currentShotId && hasCompletedVideoForShot(tasks, currentShotId))

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
    const projectId = workspace.project.id
    let disposed = false
    const loadTasks = () =>
      api
        .tasks(projectId)
        .then(async (nextTasks) => {
          if (disposed) return
          setTasks(nextTasks)
          setTaskPollError('')
          if (hasNewCompletedAssetTasks(nextTasks, syncedAssetTaskKeys.current)) {
            const [nextWorkspace, nextProjects] = await Promise.all([api.project(projectId), api.projects()])
            if (disposed) return
            setWorkspace(nextWorkspace)
            setProjects(nextProjects)
          }
        })
        .catch((error) => {
          if (!disposed) setTaskPollError(error.message || '生成状态同步失败')
        })
    void loadTasks()
    const timer = window.setInterval(loadTasks, 1_500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
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
    if (currentShotHasVideo) return undefined
    const timer = window.setInterval(
      () => setCurrentShot((index) => (index + 1) % workspace.shots.length),
      2_400,
    )
    return () => window.clearInterval(timer)
  }, [currentShotHasVideo, playing, workspace?.shots.length])

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

  const refreshTasks = async () => {
    if (!project) return
    const nextTasks = await api.tasks(project.id)
    setTasks(nextTasks)
    setTaskPollError('')
  }

  const navigateTo = (id) => {
    setActiveStep(id)
    setMobileNav(false)
  }

  const {
    createJob,
    retryJob,
    createShotVideoJob,
    retryShotVideoJob,
    exportFilmMp4,
    createProject,
    updateProject,
  } = createWorkspaceActions({
    project,
    workspace,
    tasks,
    setTasks,
    setToast,
    setNewProjectOpen,
    refreshWorkspace,
    refreshBilling,
    refreshTasks,
    navigateTo,
  })

  const renderedWorkspace = (
    <WorkspaceRouter
      activeStep={activeStep}
      project={project}
      workspace={workspace}
      tasks={tasks}
      billing={billing}
      account={session.account}
      playing={playing}
      setPlaying={setPlaying}
      currentShot={currentShot}
      setCurrentShot={setCurrentShot}
      taskPollError={taskPollError}
      onNavigate={navigateTo}
      onOpenNewProject={() => setNewProjectOpen(true)}
      onRefreshWorkspace={refreshWorkspace}
      onRefreshTasks={refreshTasks}
      onRefreshSession={refreshSession}
      onSetBilling={setBilling}
      onSetToast={setToast}
      onCreateJob={createJob}
      onCreateShotVideoJob={createShotVideoJob}
      onRetryJob={retryJob}
      onRetryShotVideoJob={retryShotVideoJob}
      onExportFilmMp4={exportFilmMp4}
      onUpdateProject={updateProject}
      onLogout={logout}
    />
  )
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
        onNavigate={navigateTo}
        onClose={() => setMobileNav(false)}
      />
      {mobileNav && (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
      )}
      <main className="workspace">{renderedWorkspace}</main>
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

export default App
