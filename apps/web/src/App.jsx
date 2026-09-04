import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, LogOut, RefreshCw, X } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { IconButton } from './components/ui'
import { ProjectMenu, WorkspaceLoading } from './components/WorkspaceOverlays'
import {
  AssetLibraryPage,
  AssetsPage,
  BillingPage,
  FilmPage,
  FunctionStackPage,
  GenerationPage,
  OverviewPage,
  ProjectHomePage,
  ScriptPage,
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
import {
  assetSuggestionRevision,
  scriptGenerationTaskLabel,
  scriptSegmentTaskLabel,
} from './features/script/scriptTaskLabels'
import { useTrustedPortraitSynchronization } from './features/workspace/useTrustedPortraitSynchronization'
import { useWorkspacePolling } from './features/workspace/useWorkspacePolling'
import { createWorkspaceCommands } from './features/workspace/workspaceCommands'
import { shouldLoadTaskDetails, workspacePollingProjectId } from './features/workspace/workspaceLoadingPolicy'

function App() {
  const { session, logout, refresh: refreshSession } = useAuth()
  const [activeStep, setActiveStep] = useState('home')
  const [projects, setProjects] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [tasks, setTasks] = useState([])
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
  const taskCacheWriteAtRef = useRef(new Map())
  const {
    notifications,
    notificationPopups,
    markNotificationRead,
    clearNotifications,
    dismissNotificationPopup,
  } = useTaskNotifications({ projects, recentTasks, recentTasksLoaded })

  const replaceTasks = useCallback((projectId, nextTasks) => {
    setTasks(nextTasks)
    if (!projectId) return
    const now = Date.now()
    const lastWriteAt = taskCacheWriteAtRef.current.get(projectId) || 0
    const hasActiveTask = nextTasks.some((task) => ['queued', 'paused', 'running'].includes(task?.status))
    if (!lastWriteAt || now - lastWriteAt >= 15_000 || !hasActiveTask) {
      writeProjectTaskCache(projectId, nextTasks)
      taskCacheWriteAtRef.current.set(projectId, now)
    }
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
        if (projectList[0]) {
          const initialProjectId = projectList[0].id
          activeProjectIdRef.current = initialProjectId
          setWorkspace(
            workspaceCacheRef.current.get(initialProjectId) || {
              project: projectList[0],
              scriptEpisodes: [],
              assets: [],
              shots: [],
            },
          )
          replaceTasks(initialProjectId, readProjectTaskCache(initialProjectId))
        }
      })
      .catch((error) => {
        setLoadError(error.message || '无法加载项目和积分信息。')
        setToast(error.message)
      })
      .finally(() => setLoading(false))
  }, [adminOnly, loadAttempt, replaceTasks])

  useWorkspacePolling({
    projectId: workspacePollingProjectId(activeStep, workspace),
    includeTaskDetails: shouldLoadTaskDetails(activeStep),
    workspaceCacheRef,
    replaceTasks,
    setWorkspace,
    setBilling,
    setProjects,
    setRecentTasks,
    setRecentTasksLoaded,
  })

  useEffect(() => {
    warmAssetPreviewCache(
      (workspace?.assets || []).filter((asset) => asset.kind === 'character').slice(0, 24),
    )
  }, [workspace?.assets])

  useTrustedPortraitSynchronization({
    projectId: workspace?.project.id,
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

  const project = workspace?.project
  const {
    refreshWorkspace,
    mergeWorkspaceAsset,
    refreshBilling,
    refreshCurrentProjectData,
    createJob,
    createCharacterFaceJob,
    createTrustedPortraitJob,
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
    activeProjectIdRef,
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
  })

  const renderContent = () => {
    if (activeStep === 'home') {
      return (
        <ProjectHomePage
          projects={projects}
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
              const nextWorkspace = nextProjects[0] ? await api.project(nextProjects[0].id) : null
              setWorkspace(nextWorkspace)
              if (nextProjects[0]) {
                const nextProjectId = nextProjects[0].id
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
    if (FUNCTION_STACK_IDS.has(activeStep)) {
      return (
        <FunctionStackPage
          tool={activeStep}
          project={project}
          billing={billing}
          tasks={tasks}
          image2ProviderStatus={providerHealth?.providers?.img2 ?? null}
          onRefreshImageStudio={refreshCurrentProjectData}
          onOpenBilling={() => navigateTo('billing')}
          onOpenProject={openProject}
          onOpenScript={() => navigateTo('script')}
          onProjectCreated={async (projectId) => {
            setProjects(await api.projects())
            await refreshBilling()
            if (projectId) await refreshWorkspace(projectId)
          }}
        />
      )
    }
    if (activeStep === 'billing') {
      return (
        <BillingPage
          billing={billing}
          onPlanChange={async (plan) => {
            setBilling(await api.updatePlan(plan))
            await refreshSession()
            setToast(plan === 'member' ? '会员已开通，赠送 500 积分' : '已切换为免费版')
          }}
        />
      )
    }
    if (activeStep === 'settings') {
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
    if (!project && activeStep === 'library') {
      return (
        <AssetLibraryPage
          currentProject={null}
          onToast={setToast}
          onLoadItems={(query) => api.libraryItems(query)}
          onLoadStats={() => api.libraryStats()}
          onLoadDuplicates={() => api.libraryDuplicates()}
          onDedupe={() => api.dedupeLibraryItems()}
          onDelete={(itemId) => api.deleteLibraryItem(itemId)}
          onRestore={(itemId) => api.restoreLibraryItem(itemId)}
          onPermanentDelete={(itemId) => api.permanentlyDeleteLibraryItem(itemId)}
          onLoadVersions={(itemId) => api.libraryItemVersions(itemId)}
        />
      )
    }
    if (!project) {
      return <ProjectHomePage projects={[]} onCreate={() => setNewProjectOpen(true)} />
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
          onUpdateSynopsis={async (synopsis) => {
            await api.updateProject(project.id, { synopsis })
            await refreshWorkspace()
            setToast('故事简介已保存')
          }}
        />
      ),
      script: () => (
        <ScriptPage
          key={project.id}
          project={project}
          scriptEpisodes={workspace.scriptEpisodes || []}
          assets={workspace.assets}
          billing={billing}
          tasks={tasks}
          textProviderStatus={providerHealth?.providers?.text ?? null}
          scriptModelCapabilities={providerHealth?.scriptModels ?? []}
          onOpenLongForm={() => navigateTo('writing-studio')}
          onSave={async (script) => {
            await api.updateProject(project.id, { script })
            await refreshWorkspace()
            setToast('剧本已保存')
          }}
          onSaveEpisode={async (episodeId, content) => {
            const episode = await api.saveScriptEpisode(project.id, {
              ...(episodeId ? { episodeId } : {}),
              content,
            })
            await refreshWorkspace()
            setToast(`${episode.title}已保存`)
            return episode
          }}
          onDeleteEpisode={async (episodeId) => {
            await api.deleteScriptEpisode(project.id, episodeId)
            await refreshWorkspace()
            setToast('最后一集已删除')
          }}
          onClearEpisodes={async () => {
            await api.clearScriptEpisodes(project.id)
            await refreshWorkspace()
            setToast('所有剧集已清空')
          }}
          onUpdateEpisodeDuration={async (episodeDurationSeconds) => {
            await api.updateProject(project.id, { episodeDurationSeconds })
            await refreshWorkspace()
            setToast(
              project.contentType === 'short-drama'
                ? '网剧剧本按单集生成；该时长仅用于后续分镜分集'
                : `已设置目标成片 ${episodeDurationSeconds} 秒，脚本与分镜会沿用该时长`,
            )
          }}
          onGenerate={async (
            draft,
            direction,
            productionMode,
            episodeDurationSeconds,
            model,
            revisionNote,
            setPhase,
            episodeId,
          ) => {
            setPhase?.('submitting')
            const isRevision = Boolean(revisionNote?.trim())
            return createScriptJob(
              isRevision ? '改写当前剧集' : scriptGenerationTaskLabel(project.contentType),
              isRevision ? 'enrich' : 'generate',
              {
                ...(isRevision ? { script: draft } : { draft, mode: 'quick' }),
                direction,
                productionMode,
                episodeDurationSeconds,
                episodeMinutes: Math.max(1, Math.ceil(episodeDurationSeconds / 60)),
                model,
                revisionNote,
                episodeId,
              },
            )
          }}
          onGenerateSegment={async (
            draft,
            direction,
            segment,
            productionMode,
            episodeDurationSeconds,
            model,
            revisionNote,
            setPhase,
            episodeId,
          ) => {
            setPhase?.('submitting')
            return createScriptJob(scriptSegmentTaskLabel(project.contentType), 'generate', {
              draft,
              direction,
              mode: 'segment',
              segment,
              productionMode,
              episodeDurationSeconds,
              episodeMinutes: Math.max(1, Math.ceil(episodeDurationSeconds / 60)),
              model,
              revisionNote,
              episodeId,
            })
          }}
          onSuggestAssets={(script, direction, sourceScriptFingerprint) =>
            createScriptJob('资产建议', 'suggest-assets', {
              script,
              direction,
              sourceScriptFingerprint,
              assetRevision: assetSuggestionRevision(workspace?.assets),
              model: ASSET_SUGGESTION_MODEL,
            })
          }
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
          onCreateAsset={async (input) => {
            const created = await api.createAsset(project.id, input)
            await refreshWorkspace()
            setToast(`已加入资产：${created.name}`)
            return created
          }}
          onImportAssets={async (inputs) => {
            const created = await Promise.all(inputs.map((input) => api.createAsset(project.id, input)))
            await refreshWorkspace()
            setToast(`已导入 ${created.length} 个资产，等待在资产设计页生成`)
            return created
          }}
          onCreateAndGenerateAsset={async (input) => {
            const created = await api.createAsset(project.id, input)
            await refreshWorkspace()
            const task =
              created.kind === 'character'
                ? await createCharacterFaceJob(created, 'img2-default', '资产建议 · 面部大头照')
                : await createJob(`${created.name} · 资产建议生成`, '图片', 6, {
                    prompt: created.prompt,
                    model: 'img2-default',
                    negativePrompt: created.negativePrompt,
                    metadata: {
                      assetId: created.id,
                      assetKind: created.kind,
                      generationStage: 'asset',
                      aspectRatio: project.aspectRatio,
                      sourceMode: created.sourceMode,
                      references: assetGenerationReferences(created, [...(workspace?.assets || []), created]),
                      attributes: created.attributes,
                      turnaround:
                        created.attributes.turnaround === true || created.attributes.view === 'turnaround',
                    },
                  })
            if (!task) throw new Error('资产已写入，但生成任务未能加入队列，请到资产页重试')
            return task
          }}
          onUpload={(file) => api.uploadMedia(project.id, file)}
          onCancelTask={async (taskId, successMessage = '已停止剧本生成，可以切换模型后重试') => {
            await api.deleteTask(taskId)
            replaceTasks(project.id, await api.tasks(project.id))
            setToast(successMessage)
          }}
          onNext={() => navigateTo('assets')}
        />
      ),
      assets: () => (
        <AssetsPage
          project={project}
          assets={workspace.assets}
          tasks={tasks}
          imageModels={providerHealth?.imageModels}
          concurrency={billing.concurrency}
          billing={billing}
          onCreate={async (input) => {
            const created = await api.createAsset(project.id, input)
            await refreshWorkspace()
            setToast('资产已添加')
            return created
          }}
          onUpdate={async (assetId, input) => {
            const updated = await api.updateAsset(project.id, assetId, input)
            await refreshWorkspace()
            setToast('资产已更新')
            return updated
          }}
          onDelete={async (assetId) => {
            await api.deleteAsset(project.id, assetId)
            await refreshWorkspace()
            setToast('资产已删除')
          }}
          onUpload={(file) => api.uploadMedia(project.id, file)}
          onGetTrustedConfiguration={() => api.trustedAssetConfiguration()}
          onListTrustedPortraits={(groupType) => api.trustedPortraits(groupType)}
          onRegisterVirtualPortrait={createTrustedPortraitJob}
          onBindTrustedPortrait={async (assetId, providerAssetId) => {
            const updated = await api.bindTrustedPortrait(project.id, assetId, providerAssetId)
            mergeWorkspaceAsset(updated)
            return updated
          }}
          onRefreshTrustedPortrait={async (assetId) => {
            const updated = await api.refreshTrustedPortrait(project.id, assetId)
            mergeWorkspaceAsset(updated)
            return updated
          }}
          onGenerateStage={(asset, stage, prompt, model) => {
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
              model,
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
          onUpdate={async (shotId, input) => {
            await api.updateShot(project.id, shotId, input)
            await refreshWorkspace()
            setToast('分镜已更新')
          }}
          onDelete={async (shotId) => {
            await api.deleteShot(project.id, shotId)
            await refreshWorkspace()
            setToast('分镜已删除，后续镜头已重新编号')
          }}
          onUpload={(file) => api.uploadMedia(project.id, file)}
          onGenerateVideo={createStoryboardVideo}
          onGenerateAllVideos={createStoryboardVideoBatch}
          onNext={() => navigateTo('generate')}
        />
      ),
      generate: () => (
        <GenerationPage
          jobs={tasks}
          concurrency={billing.concurrency}
          member={billing.plan === 'member'}
          onUpgrade={() => navigateTo('billing')}
          onPause={async (taskId) => {
            try {
              await api.pauseTask(taskId)
              replaceTasks(project.id, await api.tasks(project.id))
              setToast('任务已暂停')
            } catch (error) {
              setToast(error.message)
            }
          }}
          onResume={async (taskId) => {
            try {
              await api.resumeTask(taskId)
              replaceTasks(project.id, await api.tasks(project.id))
              setToast('任务已继续')
            } catch (error) {
              setToast(error.message)
            }
          }}
          onDelete={async (taskId) => {
            try {
              await api.deleteTask(taskId)
              replaceTasks(project.id, await api.tasks(project.id))
              await refreshBilling()
              setToast('任务已移出队列')
            } catch (error) {
              setToast(error.message)
            }
          }}
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
      library: () => (
        <AssetLibraryPage
          currentProject={project}
          onToast={setToast}
          onLoadItems={(query) => api.libraryItems(query)}
          onLoadStats={() => api.libraryStats()}
          onLoadDuplicates={() => api.libraryDuplicates()}
          onDedupe={() => api.dedupeLibraryItems()}
          onDelete={(itemId) => api.deleteLibraryItem(itemId)}
          onRestore={(itemId) => api.restoreLibraryItem(itemId)}
          onPermanentDelete={(itemId) => api.permanentlyDeleteLibraryItem(itemId)}
          onLoadVersions={(itemId) => api.libraryItemVersions(itemId)}
          onImportToProject={async (itemId, target = 'auto') => {
            const result = await api.importLibraryItem(project.id, { itemId, target })
            setToast(`${result.item.title} 已导入当前项目`)
            return result
          }}
        />
      ),
    }
    return (pages[activeStep] || pages.overview)()
  }

  const runningJobs = tasks.filter((task) => task.status === 'running')
  const activeFunction = FUNCTION_STACK_ITEMS.find((item) => item.id === activeStep)

  return (
    <div className="app-shell">
      <AppHeader
        projectName={
          activeStep === 'home' || !projects.length
            ? '项目库'
            : activeFunction?.title || project?.name || '选择项目'
        }
        billing={billing}
        account={session.account}
        runningJobs={runningJobs}
        notifications={notifications}
        onNotificationOpen={openNotification}
        onNotificationRetry={retryNotification}
        onNotificationRead={markNotificationRead}
        onNotificationsClear={clearNotifications}
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
        assetCount=""
        canOpenAdminAccounts={canOpenAdminAccounts}
        adminConsoleUrl={adminConsoleUrl}
        onNavigate={navigateTo}
        onClose={() => setMobileNav(false)}
      />
      {mobileNav && (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
      )}
      <main className="workspace">
        <Suspense fallback={<WorkspaceLoading />}>{renderContent()}</Suspense>
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
