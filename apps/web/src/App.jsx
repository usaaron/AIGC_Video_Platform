import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, LogOut, RefreshCw, X } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { IconButton } from './components/ui'
import {
  ProjectMenu,
  WorkspaceErrorBoundary,
  WorkspaceLoadError,
  WorkspaceLoading,
} from './components/WorkspaceOverlays'
import {
  AssetLibraryPage,
  AssetsPage,
  BillingPage,
  FilmPage,
  FunctionStackPage,
  GenerationPage,
  MembershipPage,
  OverviewPage,
  ProjectHomePage,
  RechargePage,
  SettingsPage,
  StoryboardPage,
} from './components/LazyWorkspacePages'
import { useAuth } from './components/AuthProvider'
import { canOpenAccountAdmin, getAdminConsoleUrl } from './features/account/access'
import { useAccountScope } from './features/account/useAccountScope'
import { api } from './services/apiClient'
import { createShotAssetReferenceIndex } from './features/storyboard/referenceSelector'
import { ASSET_SUGGESTION_MODEL } from '@seqora/contracts'
import { FUNCTION_STACK_IDS, FUNCTION_STACK_ITEMS } from './features/functionStack/config'
import { assetGenerationReferences } from './features/assets/assetGenerationReferences'
import { warmAssetPreviewCache } from './features/assets/assetPreview'
import { warmVideoPlaybackCache } from './features/film/videoPlaybackCache'
import {
  clearProjectTaskCache,
  readProjectTaskCache,
  writeProjectTaskCache,
} from './features/generation/projectTaskCache'
import { useTaskNotifications } from './features/notifications/useTaskNotifications'
import { exportProject } from './features/projects/exportProject'
import { projectLinkTarget } from './features/projects/projectLink'
import { WorkspaceScriptPage } from './features/workspace/WorkspaceScriptPage'
import { useTrustedPortraitSynchronization } from './features/workspace/useTrustedPortraitSynchronization'
import { useWorkspacePolling } from './features/workspace/useWorkspacePolling'
import { createWorkspaceCommands, createCharacterStageJob } from './features/workspace/workspaceCommands'
import {
  normalizeTasks,
  normalizeWorkspace,
  shouldLoadTaskDetails,
  workflowNavigationBlockMessage,
  workflowNavigationAccess,
  workspacePollingOptions,
} from './features/workspace/workspaceLoadingPolicy'

function App() {
  const { session, logout, refresh: refreshSession } = useAuth()
  const [activeStep, setActiveStep] = useState('home')
  const [pendingLandingView, setPendingLandingView] = useState(null)
  const [retainedSeriesId, setRetainedSeriesId] = useState(null)
  const [projects, setProjects] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [workspaceLoadError, setWorkspaceLoadError] = useState(null)
  const [tasks, setTasks] = useState([])
  const [taskActionId, setTaskActionId] = useState(null)
  const [billing, setBilling] = useState(null)
  const [providerHealth, setProviderHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [mobileNav, setMobileNav] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [currentShot, setCurrentShot] = useState(0)
  const [recentTasks, setRecentTasks] = useState([])
  const [recentTasksLoaded, setRecentTasksLoaded] = useState(false)
  const workspaceCacheRef = useRef(new Map())
  const activeProjectIdRef = useRef(null)
  const projectCreationInFlightRef = useRef(null)
  const assetOperationInFlightRef = useRef(new Map())
  const taskCacheWriteAtRef = useRef(new Map())
  const {
    notifications,
    notificationPopups,
    markNotificationRead,
    clearNotifications,
    dismissNotificationPopup,
  } = useTaskNotifications({ projects, recentTasks, recentTasksLoaded })

  const replaceTasks = useCallback((projectId, nextTasks) => {
    const safeTasks = normalizeTasks(nextTasks)
    setTasks(safeTasks)
    if (!projectId) return
    const now = Date.now()
    const lastWriteAt = taskCacheWriteAtRef.current.get(projectId) || 0
    const hasActiveTask = safeTasks.some((task) => ['queued', 'paused', 'running'].includes(task?.status))
    if (!lastWriteAt || now - lastWriteAt >= 15_000 || !hasActiveTask) {
      writeProjectTaskCache(projectId, safeTasks)
      taskCacheWriteAtRef.current.set(projectId, now)
    }
  }, [])

  const selectActiveProject = useCallback((projectId) => {
    activeProjectIdRef.current = projectId
    setActiveProjectId(projectId)
    setWorkspaceLoadError(null)
    setPendingLandingView(null)
  }, [])

  const handleWorkspaceError = useCallback((projectId, error) => {
    if (activeProjectIdRef.current !== projectId) return
    // A transient refresh failure must not hide the last valid workspace while a
    // long-running generation task is still being reconciled.
    const cachedWorkspace = normalizeWorkspace(workspaceCacheRef.current.get(projectId))
    if (cachedWorkspace) {
      workspaceCacheRef.current.set(projectId, cachedWorkspace)
      setWorkspace((current) => {
        if (current?.project?.id === projectId) return current
        return cachedWorkspace
      })
      setWorkspaceLoadError((current) => (current?.projectId === projectId ? null : current))
      return
    }
    setWorkspaceLoadError({
      projectId,
      message:
        error?.name === 'AbortError'
          ? '项目数据响应超时，请重试。'
          : error?.message || '项目数据同步失败，请重试。',
    })
  }, [])

  const handleWorkspaceReady = useCallback((projectId) => {
    if (activeProjectIdRef.current === projectId) setWorkspaceLoadError(null)
  }, [])

  const adminOnly = session.account.roles.includes('admin') && !session.permissions.includes('project.write')
  const canOpenAdminAccounts = canOpenAccountAdmin(session)
  const adminConsoleUrl = getAdminConsoleUrl()
  const {
    organizations: accountOrganizations,
    sessions: accountSessions,
    load: loadAccountScope,
    switchOrganization: switchAccountOrganization,
    revokeSession: revokeAccountSession,
    inviteOrganizationMember,
  } = useAccountScope({
    refreshSession,
    setWorkspace,
    setTasks,
    setActiveStep,
    setLoadAttempt,
    setActiveProject: selectActiveProject,
  })

  useEffect(() => {
    if (adminOnly) return
    setLoading(true)
    setLoadError('')
    Promise.all([api.projects(), api.billing(), api.health().catch(() => null)])
      .then(([projectList, billingSummary, health]) => {
        setProjects(projectList)
        setBilling(billingSummary)
        setProviderHealth(health)
        if (projectList[0] && activeProjectIdRef.current === null) {
          const landing = projectLinkTarget(projectList, window.location.search)
          const initialProject = landing?.project ?? projectList[0]
          const initialProjectId = initialProject.id
          selectActiveProject(initialProjectId)
          if (landing?.view === 'script') setActiveStep('script')
          else if (landing?.view) {
            // Asset/storyboard deep links must wait for the real workspace
            // payload. The project list only contains a summary and cannot
            // prove that a prerequisite exists.
            setPendingLandingView({ projectId: initialProjectId, view: landing.view })
            setActiveStep('overview')
          }
          const cachedWorkspace = normalizeWorkspace(workspaceCacheRef.current.get(initialProjectId))
          if (cachedWorkspace) workspaceCacheRef.current.set(initialProjectId, cachedWorkspace)
          setWorkspace(
            cachedWorkspace || {
              project: initialProject,
              scriptEpisodes: [],
              assets: [],
              shots: [],
            },
          )
          replaceTasks(initialProjectId, readProjectTaskCache(initialProjectId))
        } else if (!projectList.length) {
          selectActiveProject(null)
          setWorkspace(null)
          replaceTasks(null, [])
        }
      })
      .catch((error) => {
        setLoadError(error.message || '无法加载项目和积分信息。')
        setToast(error.message)
      })
      .finally(() => setLoading(false))
  }, [adminOnly, loadAttempt, replaceTasks, selectActiveProject])

  useWorkspacePolling({
    ...workspacePollingOptions(activeStep, activeProjectId),
    includeTaskDetails: shouldLoadTaskDetails(activeStep),
    workspaceCacheRef,
    activeProjectIdRef,
    replaceTasks,
    setWorkspace,
    setBilling,
    setProjects,
    setRecentTasks,
    setRecentTasksLoaded,
    onWorkspaceError: handleWorkspaceError,
    onWorkspaceReady: handleWorkspaceReady,
  })

  useEffect(() => {
    warmAssetPreviewCache(
      (workspace?.assets || []).filter((asset) => asset.kind === 'character').slice(0, 24),
    )
  }, [workspace?.assets])

  useTrustedPortraitSynchronization({
    projectId: activeProjectId,
    assets: workspace?.assets,
    setWorkspace,
  })

  useEffect(() => {
    warmVideoPlaybackCache(tasks)
  }, [tasks])

  const workspaceAssetReferenceIndex = useMemo(
    () => createShotAssetReferenceIndex(workspace?.assets),
    [workspace?.assets],
  )

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2_800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeStep])

  const project = workspace?.project
  const workflowAccess = useMemo(() => workflowNavigationAccess(workspace), [workspace])
  useEffect(() => {
    if (!pendingLandingView) return
    const { projectId, view } = pendingLandingView
    if (projectId !== activeProjectId || activeStep !== 'overview') {
      setPendingLandingView(null)
      return
    }
    // The initial project-list placeholder has no real assets or shots. Only
    // the loaded workspace may decide whether the requested stage is available.
    if (workspace?.project?.id !== projectId || workspaceCacheRef.current.get(projectId) !== workspace) return
    if (workflowAccess[view] === false) {
      setToast(workflowNavigationBlockMessage(view, workflowAccess))
      setPendingLandingView(null)
      return
    }
    setActiveStep(view)
    setPendingLandingView(null)
  }, [activeProjectId, activeStep, pendingLandingView, workflowAccess, workspace])
  const retainSeriesEditor =
    project?.contentType === 'short-drama' &&
    (['script', 'storyboard'].includes(activeStep) || retainedSeriesId === project.id)
  useEffect(() => {
    if (project?.contentType === 'short-drama' && ['script', 'storyboard'].includes(activeStep))
      setRetainedSeriesId(project.id)
    else if (retainedSeriesId !== project?.id) setRetainedSeriesId(null)
  }, [activeStep, project?.id, project?.contentType, retainedSeriesId])

  const {
    refreshWorkspace,
    mergeWorkspaceAsset,
    refreshBilling,
    refreshCurrentProjectData,
    createJob,
    createAsset,
    importAssets,
    createAndGenerateAsset,
    createCharacterFaceJob,
    assetCommands,
    updateShot,
    createScriptJob,
    navigateTo,
    openProject,
    openNotification,
    retryNotification,
    createProject,
    createStoryboardVideo,
    createStoryboardVideoBatch,
  } = createWorkspaceCommands({
    project,
    projects,
    workspace,
    tasks,
    workspaceCacheRef,
    setActiveProject: selectActiveProject,
    activeProjectIdRef,
    projectCreationInFlightRef,
    assetOperationInFlightRef,
    replaceTasks,
    refreshSession,
    markNotificationRead,
    setActiveStep,
    setMobileNav,
    setWorkspace,
    setTasks,
    setBilling,
    setProjects,
    setNewProjectOpen,
    setToast,
    assetReferenceIndex: workspaceAssetReferenceIndex,
    generationConcurrency: billing?.concurrency || 1,
    workflowAccess,
  })

  // Keep these callbacks before every conditional return. The app renders a
  // loading state first, so declaring them below that state would change the
  // Hook order when the workspace finishes loading and crash the whole shell.
  const pauseTask = useCallback(
    async (taskId) => {
      if (!project?.id || taskActionId) return
      setTaskActionId(taskId)
      try {
        const task = tasks.find((item) => item.id === taskId)
        const running = task?.status === 'running'
        if (running) await api.stopTask(taskId)
        else await api.pauseTask(taskId)
        replaceTasks(project.id, await api.tasks(project.id))
        setToast(running ? '已停止生成，积分不退还' : '任务已暂停')
      } catch (error) {
        setToast(error.message || '任务暂时无法暂停或停止')
      } finally {
        setTaskActionId(null)
      }
    },
    [project?.id, replaceTasks, taskActionId, tasks],
  )

  const reviewVideo = useCallback(
    async (task, decision, note) => {
      await api.reviewVideo(task.id, { decision, note, expectedUpdatedAt: task.updatedAt })
      replaceTasks(project.id, await api.tasks(project.id))
      setToast(
        decision === 'approved'
          ? '该视频版本已通过验收，可供后续镜头承接'
          : decision === 'rejected'
            ? '已标记问题，后续镜头等待修复'
            : '已撤回验收；尚未提交的衔接镜头将等待',
      )
    },
    [project?.id, replaceTasks],
  )

  const resumeTask = useCallback(
    async (taskId) => {
      if (!project?.id || taskActionId) return
      setTaskActionId(taskId)
      try {
        await api.resumeTask(taskId)
        replaceTasks(project.id, await api.tasks(project.id))
        setToast('任务已继续')
      } catch (error) {
        setToast(error.message || '任务暂时无法继续')
      } finally {
        setTaskActionId(null)
      }
    },
    [project?.id, replaceTasks, taskActionId],
  )

  const deleteTask = useCallback(
    async (taskId) => {
      if (!project?.id || taskActionId) return
      setTaskActionId(taskId)
      try {
        await api.deleteTask(taskId)
        replaceTasks(project.id, await api.tasks(project.id))
        await refreshBilling()
        setToast('任务已移出队列')
      } catch (error) {
        setToast(error.message || '任务暂时无法移出队列')
      } finally {
        setTaskActionId(null)
      }
    },
    [project?.id, refreshBilling, replaceTasks, taskActionId],
  )

  if (adminOnly)
    return (
      <div className="app-loading">
        <p>此账号使用独立管理后台</p>
        <a className="button primary" href={adminConsoleUrl}>
          进入管理后台
        </a>
      </div>
    )
  if (loading)
    return (
      <div className="app-loading">
        <LoaderCircle size={24} className="spin" />
        <p>正在加载项目…</p>
      </div>
    )
  if (loadError || !billing)
    return (
      <div className="app-loading">
        <X size={24} />
        <p>{loadError || '项目和积分信息暂时不可用。'}</p>
        <button className="button primary" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>
          <RefreshCw size={16} /> 重新加载
        </button>
        <button className="button secondary" type="button" onClick={() => void logout()}>
          <LogOut size={16} /> 退出登录
        </button>
      </div>
    )

  const workspaceRequired = new Set(['overview', 'script', 'assets', 'storyboard', 'generate', 'film']).has(
    activeStep,
  )
  const selectedWorkspaceError = workspaceLoadError?.projectId === activeProjectId ? workspaceLoadError : null
  if (workspaceRequired && activeProjectId && selectedWorkspaceError) {
    return (
      <WorkspaceLoadError
        message={selectedWorkspaceError.message}
        onRetry={() => void openProject(activeProjectId)}
      />
    )
  }
  if (workspaceRequired && activeProjectId && workspace?.project?.id !== activeProjectId) {
    return <WorkspaceLoading />
  }
  const renderContent = (step = activeStep) => {
    if (step === 'home') {
      return (
        <ProjectHomePage
          projects={projects}
          onNavigate={navigateTo}
          onCreate={() => setNewProjectOpen(true)}
          onOpen={openProject}
          onRename={async (projectId, name) => {
            await api.updateProject(projectId, { name })
            if (project?.id === projectId) await refreshWorkspace(projectId)
            else setProjects(await api.projects())
            setToast('项目名称已更新')
          }}
          onDelete={async (projectId) => {
            await api.deleteProject(projectId)
            clearProjectTaskCache(projectId)
            const nextProjects = await api.projects()
            setProjects(nextProjects)
            if (project?.id === projectId) {
              const nextProjectId = nextProjects[0]?.id || null
              selectActiveProject(nextProjectId)
              const nextWorkspace = nextProjectId
                ? normalizeWorkspace(await api.project(nextProjectId))
                : null
              setWorkspace(nextWorkspace)
              if (nextProjectId) {
                replaceTasks(nextProjectId, readProjectTaskCache(nextProjectId))
                replaceTasks(nextProjectId, await api.tasks(nextProjectId))
              } else {
                replaceTasks(null, [])
              }
            }
            setToast('项目已删除并归档')
          }}
        />
      )
    }
    if (FUNCTION_STACK_IDS.has(step)) {
      return (
        <FunctionStackPage
          tool={step}
          project={step === 'image-studio' ? project : undefined}
          billing={billing}
          tasks={tasks}
          image2ProviderStatus={providerHealth?.providers?.img2 ?? null}
          onRefreshImageStudio={refreshCurrentProjectData}
          onPauseTask={pauseTask}
          onResumeTask={resumeTask}
          onDeleteTask={deleteTask}
          busyTaskId={taskActionId}
          onOpenBilling={() => navigateTo('billing')}
          onOpenHome={() => navigateTo('home')}
        />
      )
    }
    if (step === 'billing') {
      return (
        <BillingPage
          billing={billing}
          onRefreshBilling={refreshBilling}
          onOpenRecharge={() => navigateTo('recharge')}
          onOpenMembership={() => navigateTo('membership')}
        />
      )
    }
    if (step === 'membership') {
      return (
        <MembershipPage
          key={[session.account.id, session.account.organizationId, billing.billingScope, billing.plan].join(
            ':',
          )}
          billing={billing}
          onOpenBilling={() => navigateTo('billing')}
          onOpenRecharge={() => navigateTo('recharge')}
        />
      )
    }
    if (step === 'recharge') {
      return (
        <RechargePage
          key={[session.account.id, session.account.organizationId, billing.billingScope, billing.plan].join(
            ':',
          )}
          billing={billing}
          onOpenBilling={() => navigateTo('billing')}
        />
      )
    }
    if (step === 'settings') {
      return (
        <SettingsPage
          key={session.account.id}
          account={session.account}
          billing={billing}
          canOpenAdminConsole={canOpenAdminAccounts}
          adminConsoleUrl={adminConsoleUrl}
          organizations={accountOrganizations}
          sessions={accountSessions}
          onLoadAccountScope={loadAccountScope}
          onSwitchOrganization={switchAccountOrganization}
          onRevokeSession={revokeAccountSession}
          onInviteOrganizationMember={inviteOrganizationMember}
          onOpenBilling={() => navigateTo('billing')}
          onChangePassword={(input) => api.changePassword(input)}
          onRequestEmailVerification={() => api.requestEmailVerification({ email: session.account.email })}
          onLogout={logout}
        />
      )
    }
    if (step === 'library') {
      return (
        <AssetLibraryPage
          currentProject={project ?? null}
          onToast={setToast}
          onLoadItems={(query) => api.libraryItems(query)}
          onLoadStats={() => api.libraryStats()}
          onLoadDuplicates={() => api.libraryDuplicates()}
          onDedupe={() => api.dedupeLibraryItems()}
          onDelete={(itemId) => api.deleteLibraryItem(itemId)}
          onRestore={(itemId) => api.restoreLibraryItem(itemId)}
          onPermanentDelete={(itemId) => api.permanentlyDeleteLibraryItem(itemId)}
          onLoadVersions={(itemId) => api.libraryItemVersions(itemId)}
          onLoadText={api.libraryItemText}
          onSaveTemplate={(input, itemId) =>
            itemId ? api.createLibraryItemVersion(itemId, input) : api.createLibraryItem(input)
          }
          onImportToProject={
            project
              ? async (itemId, target = 'auto') => {
                  const result = await api.importLibraryItem(project.id, { itemId, target })
                  await refreshWorkspace()
                  if (result.imported.type === 'script') navigateTo('script')
                  setToast(`${result.item.title} 已导入当前项目`)
                  return result
                }
              : undefined
          }
        />
      )
    }
    if (!project) {
      return (
        <ProjectHomePage projects={[]} onNavigate={navigateTo} onCreate={() => setNewProjectOpen(true)} />
      )
    }
    const pages = {
      overview: () => (
        <OverviewPage
          project={project}
          assets={workspace.assets}
          shots={workspace.shots}
          jobs={tasks}
          billing={billing}
          setActiveStep={navigateTo}
          setNewProjectOpen={setNewProjectOpen}
          onPauseTask={pauseTask}
          onResumeTask={resumeTask}
          onDeleteTask={deleteTask}
          onUpdateSynopsis={async (synopsis) => {
            await api.updateProject(project.id, { synopsis })
            await refreshWorkspace()
            setToast('故事简介已保存')
          }}
        />
      ),
      script: () => (
        <WorkspaceScriptPage
          key={project.id}
          project={project}
          workspace={workspace}
          billing={billing}
          tasks={tasks}
          providerHealth={providerHealth}
          refreshWorkspace={refreshWorkspace}
          navigateTo={navigateTo}
          activeStep={activeStep}
          setToast={setToast}
          createScriptJob={createScriptJob}
          createAsset={createAsset}
          importAssets={importAssets}
          createAndGenerateAsset={createAndGenerateAsset}
          replaceTasks={replaceTasks}
        />
      ),
      assets: () => (
        <AssetsPage
          project={project}
          assets={workspace.assets}
          scriptEpisodes={workspace.scriptEpisodes}
          onSuggestAssetsFast={(script, direction) =>
            api.suggestScriptAssets(
              project.id,
              script,
              direction,
              ASSET_SUGGESTION_MODEL,
              crypto.randomUUID(),
              'fast',
            )
          }
          onImportAssets={importAssets}
          tasks={tasks}
          onPauseTask={pauseTask}
          onResumeTask={resumeTask}
          onDeleteTask={deleteTask}
          busyTaskId={taskActionId}
          imageModels={providerHealth?.imageModels}
          concurrency={billing.concurrency}
          billing={billing}
          {...assetCommands}
          onUpload={(file) => api.uploadMedia(project.id, file)}
          onGetTrustedConfiguration={() => api.trustedAssetConfiguration()}
          onListTrustedPortraits={(groupType) => api.trustedPortraits(groupType)}
          onCreateTrustedValidationSession={(assetId) =>
            api.createTrustedValidationSession(project.id, assetId)
          }
          onRefreshTrustedValidationSession={async (sessionId) => {
            const result = await api.refreshTrustedValidationSession(sessionId)
            if (result?.asset) mergeWorkspaceAsset(result.asset)
            return result
          }}
          onLatestTrustedValidationSession={(assetId) =>
            api.latestTrustedValidationSession(project.id, assetId)
          }
          onGenerateStage={(asset, stage, prompt, model) =>
            createCharacterStageJob(createJob, project, asset, stage, prompt, model)
          }
          onGenerate={(asset, model) => {
            if (asset.sourceMode === 'import') {
              setToast('直接导入资产已使用原图，不会创建 Img2 任务')
              return null
            }
            if (asset.kind === 'character') return createCharacterFaceJob(asset, model, '重新生成面部大头照')
            const references = assetGenerationReferences(asset, workspace.assets)
            return createJob(`${asset.name} · 重新生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
              prompt: asset.prompt,
              model,
              negativePrompt: asset.negativePrompt,
              metadata: {
                assetId: asset.id,
                assetKind: asset.kind,
                aspectRatio: project.aspectRatio,
                sourceMode: asset.sourceMode,
                references,
                attributes: asset.attributes,
                turnaround: asset.attributes.turnaround === true || asset.attributes.view === 'turnaround',
              },
            })
          }}
          onGenerateAll={(selectedAssets, model) =>
            Promise.all(
              selectedAssets
                .filter((asset) => asset.sourceMode === 'generate')
                .map((asset) =>
                  asset.kind === 'character'
                    ? createCharacterFaceJob(asset, model)
                    : createJob(`${asset.name} · 资产生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
                        prompt: asset.prompt,
                        model,
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
                ),
            )
          }
          onNext={() => navigateTo('storyboard')}
        />
      ),
      storyboard: () => (
        <StoryboardPage
          project={project}
          scriptEpisodes={workspace.scriptEpisodes}
          shots={workspace.shots}
          assets={workspace.assets}
          tasks={tasks}
          episodeDurationSeconds={project.episodeDurationSeconds}
          onUpdateEpisodeDuration={async (episodeDurationSeconds) => {
            await api.updateProject(project.id, { episodeDurationSeconds })
            await refreshWorkspace()
            setToast(`已同步分镜每集 ${episodeDurationSeconds} 秒设置`)
          }}
          concurrency={billing.concurrency}
          unlimitedConcurrency={billing.unlimitedConcurrency}
          onRegenerate={async (mode = 'scene', episodeDurationSeconds = 60, episodeId) => {
            const generatedShots = await api.generateShots(project.id, {
              maxShots: project.contentType === 'short-drama' ? 120 : 48,
              mode,
              episodeDurationSeconds,
              ...(episodeId ? { episodeId } : {}),
            })
            await refreshWorkspace()
            setToast(
              mode === 'beat'
                ? `已批量拆分 ${generatedShots.length} 个动作镜头`
                : `已扫描完整剧本，批量生成 ${generatedShots.length} 个分镜`,
            )
            return generatedShots
          }}
          onAutoSplitEpisodes={async (episodeDurationSeconds) => {
            await api.autoSplitShotEpisodes(project.id, { episodeDurationSeconds })
            await refreshWorkspace()
            setToast(`已按每集约 ${episodeDurationSeconds} 秒完成分集`)
          }}
          onCreate={async (input) => {
            await api.createShot(project.id, input)
            await refreshWorkspace()
          }}
          onUpdate={updateShot}
          onDelete={async (shotId) => {
            await api.deleteShot(project.id, shotId)
            await refreshWorkspace()
            setToast('分镜已删除，后续镜头已重新编号')
          }}
          onUpload={(file) => api.uploadMedia(project.id, file)}
          onGenerateVideo={createStoryboardVideo}
          onGenerateAllVideos={createStoryboardVideoBatch}
          onReviewVideo={reviewVideo}
          onPauseTask={pauseTask}
          onResumeTask={resumeTask}
          onDeleteTask={deleteTask}
          busyTaskId={taskActionId}
          onNext={() => navigateTo('generate')}
        />
      ),
      generate: () => (
        <GenerationPage
          jobs={tasks}
          concurrency={billing.concurrency}
          member={billing.plan === 'member'}
          billingScope={billing.billingScope}
          onUpgrade={() => navigateTo('membership')}
          onPause={pauseTask}
          onResume={resumeTask}
          onDelete={deleteTask}
          onFreezeDelivery={async (task, contract) => {
            const frozen = await api.freezeDeliveryContract(task.id, {
              expectedUpdatedAt: task.updatedAt,
              contract,
            })
            replaceTasks(project.id, await api.tasks(project.id))
            setToast('交付合同已冻结')
            return frozen
          }}
          onInspectDelivery={(task) => api.deliveryVerification(task.id)}
          onInspectDeliveryGate={(task) => api.deliveryGate(task.id)}
          onClear={async () => {
            await api.clearTasks(project.id)
            replaceTasks(project.id, await api.tasks(project.id))
            setToast('已归档结束任务，生成结果仍然保留')
          }}
          onNext={() => navigateTo('film')}
        />
      ),
      film: () => (
        <FilmPage
          project={project}
          shots={workspace.shots}
          tasks={tasks}
          currentShot={currentShot}
          setCurrentShot={setCurrentShot}
          onSave={async () => {
            const saved = await api.saveVersion(project.id)
            await refreshWorkspace()
            setToast(`版本 v${saved.version} 已保存`)
          }}
          onEdit={() => navigateTo('storyboard')}
          onPauseTask={pauseTask}
          onResumeTask={resumeTask}
          onDeleteTask={deleteTask}
          busyTaskId={taskActionId}
          onComposePreview={async (mode = 'full', episodeNumber = null) => {
            try {
              const task = await api.createFilmPreview(project.id, mode, true, episodeNumber)
              replaceTasks(project.id, await api.tasks(project.id))
              const target =
                mode === 'partial' ? '已完成片段' : episodeNumber ? `第 ${episodeNumber} 集成片` : '全集'
              setToast(task.status === 'completed' ? `${target}已是最新版本` : `${target}正在后台合成`)
              return task
            } catch (error) {
              setToast(error.message)
              return null
            }
          }}
          onSaveTaskToLibrary={async (task, input) => {
            const item = await api.createLibraryItem({
              sourceType: 'task',
              projectId: project.id,
              taskId: task.id,
              ...input,
            })
            setToast(`${item.title} 已存入资产库`)
            return item
          }}
          onExport={() => exportProject(workspace, tasks)}
        />
      ),
    }
    return (pages[step] || pages.overview)()
  }
  const activeFunction = FUNCTION_STACK_ITEMS.find((item) => item.id === activeStep)

  return (
    <div className="app-shell" data-workspace={activeStep}>
      <AppHeader
        projectName={
          activeStep === 'home' || !projects.length
            ? '项目库'
            : activeFunction?.title || project?.name || '选择项目'
        }
        billing={billing}
        account={session.account}
        runningJobs={tasks.filter((task) => task.status === 'running')}
        tasks={tasks}
        busyTaskId={taskActionId}
        onPause={pauseTask}
        onResume={resumeTask}
        onDelete={deleteTask}
        notifications={notifications}
        onNotificationOpen={openNotification}
        onNotificationRetry={retryNotification}
        onNotificationRead={markNotificationRead}
        onNotificationsClear={clearNotifications}
        onOpenNav={() => setMobileNav(true)}
        onProjectClick={() => setProjectMenuOpen(true)}
        onCreditsClick={() => navigateTo(billing.billingScope === 'organization' ? 'billing' : 'recharge')}
        onPlanClick={() => navigateTo(billing.billingScope === 'organization' ? 'billing' : 'membership')}
        onAccountClick={() => navigateTo('settings')}
        onNavigate={navigateTo}
      />
      <AppSidebar
        activeStep={activeStep}
        mobileNav={mobileNav}
        billing={billing}
        assetCount=""
        workflowAccess={workflowAccess}
        canOpenAdminAccounts={canOpenAdminAccounts}
        adminConsoleUrl={adminConsoleUrl}
        onNavigate={navigateTo}
        onClose={() => setMobileNav(false)}
      />
      {mobileNav && (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
      )}
      <main className="workspace">
        {retainSeriesEditor && (
          <div
            className="retained-series-workspace"
            // Keep the embedded Script Master mounted during storyboard
            // navigation so its saved shots can finish syncing, but expose
            // only the host storyboard surface to the user.
            hidden={activeStep !== 'script'}
          >
            <WorkspaceErrorBoundary
              projectId={project?.id}
              step="script"
              onRetry={() => void openProject(project?.id)}
            >
              <Suspense fallback={<WorkspaceLoading />}>{renderContent('script')}</Suspense>
            </WorkspaceErrorBoundary>
          </div>
        )}
        {(!retainSeriesEditor || activeStep !== 'script') && (
          <WorkspaceErrorBoundary
            projectId={activeProjectId}
            step={activeStep}
            onRetry={() => void openProject(activeProjectId)}
          >
            <Suspense fallback={<WorkspaceLoading />}>{renderContent()}</Suspense>
          </WorkspaceErrorBoundary>
        )}
      </main>
      {newProjectOpen && (
        <NewProjectModal onClose={() => setNewProjectOpen(false)} onCreate={createProject} />
      )}
      {projectMenuOpen && (
        <ProjectMenu
          projects={projects}
          currentId={project?.id}
          onClose={() => setProjectMenuOpen(false)}
          onSelect={(id) => {
            setProjectMenuOpen(false)
            openProject(id)
          }}
          onCreate={() => {
            setProjectMenuOpen(false)
            setNewProjectOpen(true)
          }}
        />
      )}
      {notificationPopups.length > 0 && (
        <div className="notification-toast-stack" aria-live="polite">
          {notificationPopups.map((notification) => (
            <article key={notification.id} className={`notification-toast ${notification.status}`}>
              <span className="notification-status-dot" />
              <button
                type="button"
                className="notification-toast-open"
                onClick={() => void openNotification(notification)}
              >
                <strong>{notification.title}</strong>
                <small>
                  {notification.projectName} · {notification.label}
                </small>
              </button>
              <IconButton
                label="关闭提示"
                className="notification-toast-close"
                onClick={() => dismissNotificationPopup(notification.id)}
              >
                <X size={15} />
              </IconButton>
            </article>
          ))}
        </div>
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
