import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { ProjectMenu } from './components/ProjectMenu'
import { useAuth } from './components/AuthProvider'
import { AdminPage } from './pages/AdminPage'
import { WorkspaceRouter } from './pages/WorkspaceRouter'
import { createWorkspaceActions } from './features/generation/workspaceActions'
import { useProjectTasks } from './features/workspace/useProjectTasks'
import { useShotPlayback } from './features/workspace/useShotPlayback'
import { useWorkspaceData } from './features/workspace/useWorkspaceData'
import { useWorkspaceNavigation } from './features/workspace/useWorkspaceNavigation'

function App() {
  const { session, logout, refresh: refreshSession } = useAuth()
  const { activeStep, mobileNav, setMobileNav, navigateTo } = useWorkspaceNavigation()
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [toast, setToast] = useState('')

  const adminOnly = session.account.roles.includes('admin') && !session.permissions.includes('project.write')
  const { projects, workspace, project, billing, setBilling, loading, refreshWorkspace, refreshBilling } =
    useWorkspaceData({ adminOnly, refreshSession, setToast })
  const handleCompletedAssetTasks = useCallback(
    async (projectId) => {
      await refreshWorkspace(projectId)
    },
    [refreshWorkspace],
  )
  const { tasks, setTasks, taskPollError, taskSyncMode, refreshTasks } = useProjectTasks(project?.id, {
    onCompletedAssetTasks: handleCompletedAssetTasks,
  })
  const { playing, setPlaying, currentShot, setCurrentShot } = useShotPlayback({ workspace, tasks })

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2_800)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (adminOnly) return <AdminPage />
  if (loading || !billing)
    return (
      <div className="app-loading">
        <LoaderCircle size={24} className="spin" />
        <p>正在加载项目…</p>
      </div>
    )

  const {
    createJob,
    retryJob,
    rerunJob,
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
      <main className="workspace">
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
          onRerunJob={rerunJob}
          onRetryShotVideoJob={retryShotVideoJob}
          onExportFilmMp4={exportFilmMp4}
          onUpdateProject={updateProject}
          onLogout={logout}
          taskSyncMode={taskSyncMode}
        />
      </main>
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
