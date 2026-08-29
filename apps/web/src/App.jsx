import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, LogOut, RefreshCw, X } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { BrandMark } from './components/BrandMark'
import { IconButton } from './components/ui'
import { useAuth } from './components/AuthProvider'
import { canOpenAccountAdmin, getAdminConsoleUrl } from './features/account/access'
import { api } from './services/apiClient'
import {
  selectShotAssetReferences,
  selectVideoReferenceImages,
} from './features/storyboard/referenceSelector'
import {
  activeVideoTasksForShots,
  isCompatibleCompletedVideoTask,
  planVideoBatch,
} from './features/storyboard/videoBatchPlanner'
import {
  compileStoryboardVideoPrompt,
  normalizedVideoDuration,
  VIDEO_PROMPT_VERSION,
} from '@seqora/prompting'
import { SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'
import { FUNCTION_STACK_IDS, FUNCTION_STACK_ITEMS } from './features/functionStack/config'
import { compileCharacterStagePrompt } from './features/assets/promptCompiler'
import { warmAssetPreviewCache } from './features/assets/assetPreview'
import { warmVideoPlaybackCache } from './features/film/videoPlaybackCache'
import {
  clearProjectTaskCache,
  readProjectTaskCache,
  writeProjectTaskCache,
} from './features/generation/projectTaskCache'

const kindByType = { 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' }
const videoResolutions = new Set(['480p', '720p', '1080p', '4k'])
const activeTaskStatuses = new Set(['queued', 'paused', 'running'])
const terminalTaskStatuses = new Set(['completed', 'failed'])
const TASK_STATUS_CACHE_KEY = 'seqora:task-status-cache'
const ACTIVE_TASK_POLL_MS = 2_500
const IDLE_TASK_POLL_MS = 12_000
const BACKGROUND_TASK_POLL_MS = 30_000

const AssetsPage = lazyNamed(() => import('./pages/AssetsPage'), 'AssetsPage')
const AssetLibraryPage = lazyNamed(() => import('./pages/AssetLibraryPage'), 'AssetLibraryPage')
const BillingPage = lazyNamed(() => import('./pages/BillingPage'), 'BillingPage')
const FilmPage = lazyNamed(() => import('./pages/FilmPage'), 'FilmPage')
const GenerationPage = lazyNamed(() => import('./pages/GenerationPage'), 'GenerationPage')
const OverviewPage = lazyNamed(() => import('./pages/OverviewPage'), 'OverviewPage')
const ProjectHomePage = lazyNamed(() => import('./pages/ProjectHomePage'), 'ProjectHomePage')
const FunctionStackPage = lazyNamed(() => import('./pages/FunctionStackPage'), 'FunctionStackPage')
const ScriptPage = lazyNamed(() => import('./pages/ScriptPage'), 'ScriptPage')
const SettingsPage = lazyNamed(() => import('./pages/SettingsPage'), 'SettingsPage')
const StoryboardPage = lazyNamed(() => import('./pages/StoryboardPage'), 'StoryboardPage')

function App() {
  const { session, logout, refresh: refreshSession } = useAuth()
  const [activeStep, setActiveStep] = useState('home')
  const [projects, setProjects] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [tasks, setTasks] = useState([])
  const [billing, setBilling] = useState(null)
  const [providerHealth, setProviderHealth] = useState(null)
  const [accountOrganizations, setAccountOrganizations] = useState([])
  const [accountSessions, setAccountSessions] = useState([])
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
  const [notifications, setNotifications] = useState([])
  const [notificationPopups, setNotificationPopups] = useState([])
  const taskStatusesRef = useRef(readTaskStatusCache())
  const notificationHistoryReadyRef = useRef(false)
  const workspaceCacheRef = useRef(new Map())
  const activeProjectIdRef = useRef(null)

  const replaceTasks = useCallback((projectId, nextTasks) => {
    setTasks(nextTasks)
    if (projectId) writeProjectTaskCache(projectId, nextTasks)
  }, [])

  const hydrateProject = useCallback(
    async (projectId) => {
      try {
        const [nextWorkspace, nextTasks] = await Promise.all([api.project(projectId), api.tasks(projectId)])
        workspaceCacheRef.current.set(projectId, nextWorkspace)
        if (activeProjectIdRef.current !== projectId) return nextWorkspace
        setWorkspace(nextWorkspace)
        replaceTasks(projectId, nextTasks)
        return nextWorkspace
      } catch (error) {
        if (activeProjectIdRef.current === projectId) setToast(error.message || '项目内容暂时无法加载。')
        throw error
      }
    },
    [replaceTasks],
  )

  const adminOnly = session.account.roles.includes('admin') && !session.permissions.includes('project.write')
  const canOpenAdminAccounts = canOpenAccountAdmin(session)
  const adminConsoleUrl = getAdminConsoleUrl()

  const loadAccountScope = useCallback(async () => {
    const [organizationsResult, sessionsResult] = await Promise.allSettled([
      api.organizations(),
      api.authSessions(),
    ])
    const organizations = organizationsResult.status === 'fulfilled' ? organizationsResult.value : []
    const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : []
    setAccountOrganizations(organizations)
    setAccountSessions(sessions)

    const failedSections = [
      organizationsResult.status === 'rejected' ? '数据范围' : null,
      sessionsResult.status === 'rejected' ? '登录设备' : null,
    ].filter(Boolean)
    if (failedSections.length) {
      throw new Error(`${failedSections.join('、')}暂时无法同步，请稍后刷新。`)
    }
    return { organizations, sessions }
  }, [])

  const switchAccountOrganization = useCallback(
    async (organizationId) => {
      await api.switchOrganization(organizationId)
      await refreshSession()
      setWorkspace(null)
      setTasks([])
      setActiveStep('home')
      setLoadAttempt((attempt) => attempt + 1)
    },
    [refreshSession],
  )

  const revokeAccountSession = useCallback(async (sessionId) => {
    await api.revokeAuthSession(sessionId)
    setAccountSessions(await api.authSessions())
  }, [])

  const inviteOrganizationMember = useCallback(async (organizationId, email) => {
    return await api.createOrganizationInvitation(organizationId, {
      email,
      roles: ['organization_member'],
    })
  }, [])

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
          void hydrateProject(initialProjectId).catch(() => {})
        }
      })
      .catch((error) => {
        setLoadError(error.message || '无法加载项目和积分信息。')
        setToast(error.message)
      })
      .finally(() => setLoading(false))
  }, [adminOnly, loadAttempt, replaceTasks])

  useEffect(() => {
    if (!workspace?.project.id) return undefined
    let cancelled = false
    let requestInFlight = false
    let timer = null
    const schedule = (delay) => {
      if (cancelled) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void loadTasks(), delay)
    }
    const loadTasks = async () => {
      if (requestInFlight || cancelled) return
      requestInFlight = true
      let nextDelay = IDLE_TASK_POLL_MS
      try {
        const [nextTasks, nextWorkspace] = await Promise.all([
          api.tasks(workspace.project.id),
          api.project(workspace.project.id),
        ])
        if (cancelled) return
        workspaceCacheRef.current.set(workspace.project.id, nextWorkspace)
        replaceTasks(workspace.project.id, nextTasks)
        setWorkspace(nextWorkspace)
        const hasActiveTasks = nextTasks.some((task) => activeTaskStatuses.has(task.status))
        nextDelay = hasActiveTasks ? ACTIVE_TASK_POLL_MS : IDLE_TASK_POLL_MS
        if (!hasActiveTasks) {
          void Promise.allSettled([api.billing(), api.projects(), api.recentTasks()]).then(
            ([billingResult, projectsResult, recentTasksResult]) => {
              if (cancelled) return
              if (billingResult.status === 'fulfilled') setBilling(billingResult.value)
              if (projectsResult.status === 'fulfilled') setProjects(projectsResult.value)
              if (recentTasksResult.status === 'fulfilled') {
                setRecentTasks(recentTasksResult.value)
                setRecentTasksLoaded(true)
              }
            },
          )
        }
      } catch {
        nextDelay = IDLE_TASK_POLL_MS
      } finally {
        requestInFlight = false
        schedule(document.hidden ? BACKGROUND_TASK_POLL_MS : nextDelay)
      }
    }
    const handleVisibilityChange = () => {
      window.clearTimeout(timer)
      if (document.hidden) schedule(BACKGROUND_TASK_POLL_MS)
      else void loadTasks()
    }
    void loadTasks()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [replaceTasks, workspace?.project.id])

  useEffect(() => {
    warmAssetPreviewCache(
      (workspace?.assets || []).filter((asset) => asset.kind === 'character').slice(0, 24),
    )
  }, [workspace?.assets])

  const processingTrustedPortraitKey = useMemo(
    () =>
      (workspace?.assets || [])
        .filter(
          (asset) =>
            asset.attributes?.type === 'character' &&
            asset.attributes.trustedPortrait?.status === 'processing',
        )
        .map((asset) => `${asset.id}:${asset.attributes.trustedPortrait.assetId}`)
        .sort()
        .join('|'),
    [workspace?.assets],
  )

  useEffect(() => {
    const projectId = workspace?.project.id
    if (!projectId || !processingTrustedPortraitKey) return undefined
    let cancelled = false
    let requestInFlight = false
    let timer = null

    const schedule = (delay) => {
      if (cancelled) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void synchronize(), delay)
    }
    const synchronize = async () => {
      if (cancelled || requestInFlight) return
      requestInFlight = true
      try {
        const updatedAssets = await api.refreshProcessingTrustedPortraits(projectId)
        if (cancelled) return
        const byId = new Map(updatedAssets.map((asset) => [asset.id, asset]))
        setWorkspace((current) =>
          current?.project.id === projectId
            ? {
                ...current,
                assets: current.assets.map((asset) => byId.get(asset.id) || asset),
              }
            : current,
        )
      } catch {
        // The per-character refresh button remains available if an upstream status check is transiently unavailable.
      } finally {
        requestInFlight = false
        schedule(document.hidden ? BACKGROUND_TASK_POLL_MS : 8_000)
      }
    }
    const handleVisibilityChange = () => {
      window.clearTimeout(timer)
      if (document.hidden) schedule(BACKGROUND_TASK_POLL_MS)
      else void synchronize()
    }

    void synchronize()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', synchronize)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', synchronize)
    }
  }, [processingTrustedPortraitKey, workspace?.project.id])

  useEffect(() => {
    warmVideoPlaybackCache(tasks)
  }, [tasks])

  useEffect(() => {
    if (!recentTasksLoaded) return
    if (!recentTasks.length) {
      taskStatusesRef.current = {}
      window.localStorage.setItem(TASK_STATUS_CACHE_KEY, '{}')
      setNotifications([])
      notificationHistoryReadyRef.current = true
      return
    }
    const previousStatuses = taskStatusesRef.current
    const nextStatuses = {}
    const recentIds = new Set(recentTasks.map((task) => task.id))
    const now = Date.now()
    const newlyFinished = []

    for (const task of recentTasks) {
      nextStatuses[task.id] = task.status
      const previousStatus = previousStatuses[task.id]
      const changedFromActive =
        activeTaskStatuses.has(previousStatus) && terminalTaskStatuses.has(task.status)
      const justCompletedUnseen =
        notificationHistoryReadyRef.current &&
        !previousStatus &&
        terminalTaskStatuses.has(task.status) &&
        now - Date.parse(task.updatedAt) < 60_000
      if (changedFromActive || justCompletedUnseen) newlyFinished.push(task)
    }

    taskStatusesRef.current = nextStatuses
    window.localStorage.setItem(TASK_STATUS_CACHE_KEY, JSON.stringify(nextStatuses))
    setNotifications((current) => {
      const byId = new Map(current.filter((item) => recentIds.has(item.id)).map((item) => [item.id, item]))
      for (const task of recentTasks.filter((item) => terminalTaskStatuses.has(item.status)).slice(0, 30)) {
        const existing = byId.get(task.id)
        const isNew = newlyFinished.some((item) => item.id === task.id)
        byId.set(task.id, createNotification(task, projects, isNew ? false : (existing?.read ?? true)))
      }
      return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    })
    if (newlyFinished.length) {
      const popups = newlyFinished.map((task) => ({
        ...createNotification(task, projects, false),
        expiresAt: now + 15_000,
      }))
      setNotificationPopups((current) => [...popups, ...current].slice(0, 4))
    }
    notificationHistoryReadyRef.current = true
  }, [projects, recentTasks, recentTasksLoaded])

  useEffect(() => {
    if (!notificationPopups.length) return undefined
    const timer = window.setInterval(() => {
      const now = Date.now()
      setNotificationPopups((current) => current.filter((item) => item.expiresAt > now))
    }, 500)
    return () => window.clearInterval(timer)
  }, [notificationPopups.length])

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

  const refreshWorkspace = async (projectId = project?.id) => {
    if (!projectId) return
    const next = await api.project(projectId)
    workspaceCacheRef.current.set(projectId, next)
    setWorkspace(next)
    void api
      .projects()
      .then(setProjects)
      .catch((error) => setToast(error.message || '项目列表暂时无法同步。'))
    return next
  }

  const mergeWorkspaceAsset = (updatedAsset) => {
    if (!updatedAsset?.id) return
    setWorkspace((current) => {
      if (!current) return current
      return {
        ...current,
        assets: current.assets.map((asset) => (asset.id === updatedAsset.id ? updatedAsset : asset)),
      }
    })
  }

  const refreshBilling = async () => {
    const next = await api.billing()
    setBilling(next)
    await refreshSession()
  }

  const refreshCurrentProjectData = async () => {
    if (!project?.id) return
    const [nextWorkspace, nextTasks, nextBilling, nextProjects] = await Promise.all([
      api.project(project.id),
      api.tasks(project.id),
      api.billing(),
      api.projects(),
    ])
    setWorkspace(nextWorkspace)
    setTasks(nextTasks)
    setBilling(nextBilling)
    setProjects(nextProjects)
  }

  const createJob = async (label, type = '图片', cost = 6, options = {}) => {
    if (!project) return
    try {
      const kind = kindByType[type] || 'image'
      const provider =
        kind === 'image' ? 'img2' : kind === 'video' ? 'seedance' : kind === 'audio' ? 'audio' : 'local'
      const created = await api.createTask({
        clientRequestId: crypto.randomUUID(),
        projectId: project.id,
        kind,
        label,
        prompt: options.prompt,
        negativePrompt: options.negativePrompt,
        provider,
        model:
          kind === 'video'
            ? 'doubao-seedance-2-0-260128'
            : kind === 'image'
              ? options.model || 'img2-default'
              : undefined,
        estimatedCredits: cost,
        metadata: options.metadata,
      })
      replaceTasks(project.id, await api.tasks(project.id))
      await refreshBilling()
      setToast(`${label} 已加入生成队列`)
      return created
    } catch (error) {
      setToast(error.message)
      return null
    }
  }

  const createCharacterFaceJob = (asset, model, label = '面部大头照') =>
    createJob(`${asset.name} · ${label}`, '图片', 4, {
      prompt: compileCharacterStagePrompt(asset, '1:1', 'face'),
      model,
      negativePrompt: asset.negativePrompt,
      metadata: {
        assetId: asset.id,
        assetKind: asset.kind,
        generationStage: 'face',
        aspectRatio: '1:1',
        sourceMode: asset.sourceMode,
        references: asset.references,
        attributes: asset.attributes,
      },
    })

  const createTrustedPortraitJob = async (assetId, assetName = '人物') => {
    if (!project) return null
    const task = await api.createTask({
      clientRequestId: crypto.randomUUID(),
      projectId: project.id,
      kind: 'text',
      label: `${assetName || '人物'} · 创建 AI 人像资源`,
      provider: 'asset-library',
      estimatedCredits: 1,
      metadata: {
        generationStage: 'trusted-portrait',
        trustedAssetOperation: 'register-virtual',
        assetId,
      },
    })
    replaceTasks(project.id, await api.tasks(project.id))
    await refreshBilling()
    setToast('AI 人像资源已进入后台任务，完成后会自动同步状态')
    return task
  }

  const createScriptJob = async (label, operation, input) => {
    if (!project) return null
    try {
      const generationStage =
        operation === 'enrich'
          ? 'script-enrich'
          : operation === 'suggest-assets'
            ? 'script-asset-suggestions'
            : 'script-generate'
      const task = await api.createTask({
        clientRequestId: crypto.randomUUID(),
        projectId: project.id,
        kind: 'text',
        label,
        provider: 'text',
        model: input.model,
        estimatedCredits:
          operation === 'enrich'
            ? SCRIPT_OPERATION_CREDITS.enrich
            : operation === 'suggest-assets'
              ? SCRIPT_OPERATION_CREDITS.suggestAssets
              : SCRIPT_OPERATION_CREDITS.generate,
        metadata: {
          generationStage,
          scriptOperation: operation,
          billingMode: 'prepaid',
          ...input,
        },
      })
      replaceTasks(project.id, await api.tasks(project.id))
      await refreshBilling()
      setToast(`${label}已提交后台生成`)
      return task
    } catch (error) {
      setToast(error.message)
      throw error
    }
  }

  const navigateTo = (id) => {
    setActiveStep(id)
    setMobileNav(false)
    if (id === 'home') {
      void api
        .projects()
        .then(setProjects)
        .catch((error) => setToast(error.message))
    }
  }

  const openProject = (projectId) => {
    const projectSummary = projects.find((item) => item.id === projectId)
    const cachedWorkspace = workspaceCacheRef.current.get(projectId)
    activeProjectIdRef.current = projectId
    setWorkspace(
      cachedWorkspace ||
        (projectSummary
          ? {
              project: projectSummary,
              scriptEpisodes: [],
              assets: [],
              shots: [],
            }
          : null),
    )
    replaceTasks(projectId, readProjectTaskCache(projectId))
    navigateTo('overview')
    void hydrateProject(projectId).catch(() => {})
  }

  const markNotificationRead = (notificationId) => {
    setNotifications((current) =>
      current.map((item) => (item.id === notificationId ? { ...item, read: true } : item)),
    )
  }

  const openNotification = async (notification) => {
    markNotificationRead(notification.id)
    openProject(notification.projectId)
    navigateTo(notification.target)
  }

  const retryNotification = async (notification) => {
    try {
      const created = await api.createTask(retryTaskInput(notification.task))
      markNotificationRead(notification.id)
      if (project?.id === created.projectId) {
        replaceTasks(created.projectId, await api.tasks(created.projectId))
      }
      setToast(`${created.label}已重新提交`)
    } catch (error) {
      setToast(error.message)
    }
  }

  const createProject = async (input) => {
    try {
      const created = await api.createProject(input)
      await refreshWorkspace(created.id)
      replaceTasks(created.id, readProjectTaskCache(created.id))
      setNewProjectOpen(false)
      navigateTo('script')
      setToast('新项目已创建')
    } catch (error) {
      setToast(error.message)
    }
  }

  const createStoryboardVideo = async (
    shot,
    {
      resolution = '720p',
      continuitySourceTask = null,
      chain = [],
      continuityMode = shot.continuityMode || 'independent',
      batchId = null,
      batchMode = null,
    } = {},
  ) => {
    const references = selectShotAssetReferences(workspace.assets, shot)
    const orderedShots = [...workspace.shots].sort((left, right) => left.order - right.order)
    const shotIndex = orderedShots.findIndex((item) => item.id === shot.id)
    const adjacentPreviousShot = shotIndex > 0 ? orderedShots[shotIndex - 1] : null
    const previousShot =
      adjacentPreviousShot &&
      !shot.episodeBreakBefore &&
      adjacentPreviousShot.episodeNumber === shot.episodeNumber
        ? adjacentPreviousShot
        : null
    const actualContinuityMode = continuityMode === 'continue' && previousShot ? 'continue' : 'independent'
    let sourceTask = actualContinuityMode === 'continue' ? continuitySourceTask : null
    if (actualContinuityMode === 'continue' && previousShot && !sourceTask) {
      sourceTask = latestVideoTaskFor(tasks, previousShot, true)
      if (!sourceTask && !chain.includes(previousShot.id)) {
        sourceTask = await createStoryboardVideo(previousShot, {
          resolution,
          chain: [...chain, shot.id],
          batchId,
          batchMode,
        })
      }
      if (!sourceTask) {
        setToast('请先完成上一镜头并生成尾帧，再生成连续镜头')
        return null
      }
    }
    if (sourceTask?.status === 'completed' && !hasLastFrame(sourceTask)) {
      setToast('上一镜头虽已完成，但尾帧提取失败；请重新生成上一镜头后再继续')
      return null
    }
    const manualReferenceUrl =
      shot.imageUrl && !shot.imageUrl.startsWith('/api/v1/generation/tasks/') ? shot.imageUrl : null
    const images = selectVideoReferenceImages(
      manualReferenceUrl,
      references,
      actualContinuityMode === 'continue' ? 4 : 9,
    )
    const selectedResolution = videoResolutions.has(resolution) ? resolution : '720p'
    const videoPrompt = compileStoryboardVideoPrompt({
      project,
      shot,
      shots: workspace.shots,
      assets: workspace.assets,
      references,
      continuityMode: actualContinuityMode,
    })
    const dependencyIds = [sourceTask && sourceTask.status !== 'completed' ? sourceTask.id : null].filter(
      Boolean,
    )
    return createJob(`镜头 ${String(shot.order).padStart(2, '0')} · ${shot.title}`, '视频', 18, {
      prompt: videoPrompt,
      negativePrompt: shot.negativePrompt,
      metadata: {
        shotId: shot.id,
        duration: normalizedVideoDuration(shot.duration, project.contentType === 'short-drama' ? 3 : 4),
        requestedDuration: shot.duration,
        aspectRatio: project.aspectRatio,
        resolution: selectedResolution,
        // Seedance 负责输出镜头内的对白、画外音和现场声；成片合成会继续保留音轨。
        generateAudio: true,
        watermark: false,
        returnLastFrame: true,
        continuityMode: actualContinuityMode,
        ...(sourceTask ? { continuitySourceTaskId: sourceTask.id } : {}),
        ...(manualReferenceUrl ? { manualReferenceUrl } : {}),
        images,
        videoInputMode: sourceTask
          ? 'continuity-and-assets'
          : manualReferenceUrl
            ? 'manual-reference-and-assets'
            : references.length
              ? 'assets'
              : 'text',
        referenceAssetIds: references.map((reference) => reference.id),
        compiledPrompt: videoPrompt,
        videoPromptVersion: VIDEO_PROMPT_VERSION,
        sourceProjectVersion: project.version,
        ...(batchId
          ? {
              batchId,
              batchMode,
              batchPlanVersion: 'v2',
            }
          : {}),
        ...(dependencyIds.length
          ? { dependsOnTaskId: dependencyIds[0], dependsOnTaskIds: dependencyIds }
          : {}),
      },
    })
  }

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
      overview: (
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
      script: (
        <ScriptPage
          project={project}
          scriptEpisodes={workspace.scriptEpisodes || []}
          assets={workspace.assets}
          billing={billing}
          tasks={tasks}
          textProviderStatus={providerHealth?.providers?.text ?? null}
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
          onSuggestAssets={(script, direction, sourceScriptFingerprint, model) =>
            createScriptJob('资产建议', 'suggest-assets', {
              script,
              direction,
              sourceScriptFingerprint,
              model,
            })
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
          onCancelTask={async (taskId) => {
            await api.deleteTask(taskId)
            replaceTasks(project.id, await api.tasks(project.id))
            setToast('已停止剧本生成，可以切换模型后重试')
          }}
          onNext={() => navigateTo('assets')}
        />
      ),
      assets: (
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
      storyboard: (
        <StoryboardPage
          project={project}
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
          onRegenerate={async (mode = 'scene', episodeDurationSeconds = 60) => {
            const generatedShots = await api.generateShots(project.id, {
              maxShots: project.contentType === 'short-drama' ? 120 : 48,
              mode,
              episodeDurationSeconds,
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
          onGenerateAllVideos={async (shotsToGenerate, resolution, mode = 'parallel') => {
            const activeTasks = activeVideoTasksForShots(tasks, shotsToGenerate)
            if (activeTasks.length) {
              const shotCount = new Set(activeTasks.map((task) => task.metadata?.shotId)).size
              throw new Error(
                `当前有 ${shotCount} 个分镜视频任务仍在队列中，请先在生成队列暂停或删除后再切换策略。`,
              )
            }

            const batchId = crypto.randomUUID()
            const plan = planVideoBatch(shotsToGenerate, mode, billing.concurrency)
            if (plan.continuityUpdates.length) {
              await Promise.all(
                plan.continuityUpdates.map((update) =>
                  api.updateShot(project.id, update.shotId, { continuityMode: update.continuityMode }),
                ),
              )
            }

            const laneResults = await Promise.all(
              plan.lanes.map(async (lane) => {
                let created = 0
                let previousVideoTask = null
                for (const [shotIndex, shot] of lane.entries()) {
                  const references = selectShotAssetReferences(workspace.assets, shot)
                  const mustProvideLastFrame = lane[shotIndex + 1]?.continuityMode === 'continue'
                  const existingVideo = tasks.find(
                    (task) =>
                      isCompatibleCompletedVideoTask(task, {
                        shotId: shot.id,
                        referenceAssetIds: references.map((reference) => reference.id),
                        resolution,
                        continuityMode: shot.continuityMode,
                        previousTaskId: previousVideoTask?.id ?? null,
                        sourcePromptSnapshot: shot.prompt,
                      }) &&
                      (!mustProvideLastFrame || hasLastFrame(task)),
                  )
                  if (existingVideo) {
                    previousVideoTask = existingVideo
                    continue
                  }
                  const createdTask = await createStoryboardVideo(shot, {
                    resolution,
                    continuityMode: shot.continuityMode,
                    continuitySourceTask: shot.continuityMode === 'continue' ? previousVideoTask : null,
                    batchId,
                    batchMode: mode,
                  })
                  if (!createdTask) break
                  previousVideoTask = createdTask
                  created += 1
                }
                return created
              }),
            )
            const created = laneResults.reduce((total, count) => total + count, 0)
            await refreshWorkspace()
            replaceTasks(project.id, await api.tasks(project.id))
            if (created) {
              const laneCount = Math.min(plan.immediateLaneCount, created)
              setToast(
                mode === 'parallel'
                  ? `已创建 ${created} 个视频任务，${laneCount} 路安全并发执行`
                  : mode === 'independent'
                    ? `已创建 ${created} 个独立视频任务，全部并发提交`
                    : `已按尾帧承接关系创建 ${created} 个视频任务`,
              )
            }
          }}
          onNext={() => navigateTo('generate')}
        />
      ),
      generate: (
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
      film: (
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
      library: (
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
      ),
    }
    return pages[activeStep] || pages.overview
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
            <button
              key={notification.id}
              className={`notification-toast ${notification.status}`}
              onClick={() => void openNotification(notification)}
            >
              <span className="notification-status-dot" />
              <span>
                <strong>{notification.title}</strong>
                <small>
                  {notification.projectName} · {notification.label}
                </small>
              </span>
            </button>
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

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })))
}

function WorkspaceLoading({ fullPage = false }) {
  return (
    <div className={fullPage ? 'app-loading' : 'workspace-loading'}>
      <BrandMark size={20} spin />
      <div>
        <strong>正在打开工作台</strong>
        <p>同步页面与项目数据...</p>
      </div>
    </div>
  )
}

function latestVideoTaskFor(tasks, shotOrId, needsLastFrame = false) {
  const shotId = typeof shotOrId === 'string' ? shotOrId : shotOrId.id
  const selectedVideoTaskId = typeof shotOrId === 'string' ? null : shotOrId.selectedVideoTaskId
  const selected = tasks.find(
    (task) =>
      task.id === selectedVideoTaskId &&
      task.kind === 'video' &&
      task.metadata?.shotId === shotId &&
      task.status === 'completed' &&
      (!needsLastFrame || hasLastFrame(task)),
  )
  return (
    tasks.find(
      (task) =>
        task.kind === 'video' &&
        task.metadata?.shotId === shotId &&
        task.status !== 'cancelled' &&
        (task.status === 'queued' || task.status === 'paused' || task.status === 'running'),
    ) ||
    selected ||
    tasks.find(
      (task) =>
        task.kind === 'video' &&
        task.metadata?.shotId === shotId &&
        task.status === 'completed' &&
        (!needsLastFrame || hasLastFrame(task)),
    ) ||
    null
  )
}

function hasLastFrame(task) {
  return task?.outputs?.some((output) => output.view === 'last-frame') ?? false
}

function assetGenerationReferences(asset, assets) {
  const references = [...(asset.references || [])]
  if (asset.kind !== 'costume' || !asset.attributes?.characterAssetId) return references
  const character = assets.find(
    (item) => item.kind === 'character' && item.id === asset.attributes.characterAssetId,
  )
  if (!character || character.attributes?.type !== 'character') return references
  const activeVariant = (character.attributes.appearanceVariants || []).find(
    (variant) => variant.id === character.attributes.activeAppearanceVariantId,
  )
  const source =
    activeVariant?.bodyReference ||
    character.attributes.bodyReference ||
    character.attributes.faceReference ||
    (character.imageUrl
      ? { id: `character-${character.id}`, url: character.imageUrl, name: `${character.name}-人物参考` }
      : null)
  if (!source?.url || references.some((reference) => reference?.url === source.url)) return references
  return [source, ...references]
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

function scriptGenerationTaskLabel(contentType) {
  if (contentType === 'advertisement') return '广告脚本'
  if (contentType === 'animation') return '短片剧本'
  return '生成本集'
}

function scriptSegmentTaskLabel(contentType) {
  if (contentType === 'advertisement') return '延长广告脚本'
  if (contentType === 'animation') return '续写短片'
  return '续写下一集'
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

function readTaskStatusCache() {
  try {
    return JSON.parse(window.localStorage.getItem(TASK_STATUS_CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function createNotification(task, projects, read) {
  const projectName = projects.find((item) => item.id === task.projectId)?.name || '项目'
  const status = task.status === 'failed' ? 'failed' : 'completed'
  const isTrustedPortraitTask = task.metadata?.generationStage === 'trusted-portrait'
  return {
    id: task.id,
    task,
    projectId: task.projectId,
    projectName,
    label: task.label,
    status,
    title: status === 'failed' ? (isTrustedPortraitTask ? '人像资源创建失败' : '生成失败') : '生成完成',
    message: status === 'failed' ? task.error || '任务执行失败，请查看详情后重试。' : '生成结果已经保存。',
    target: isTrustedPortraitTask ? 'assets' : task.kind === 'text' ? 'script' : 'generate',
    updatedAt: task.updatedAt,
    read,
  }
}

function retryTaskInput(task) {
  const {
    providerName: _providerName,
    providerState: _providerState,
    providerTaskId: _providerTaskId,
    providerPolledAt: _providerPolledAt,
    providerPollErrors: _providerPollErrors,
    generatedOutputs: _generatedOutputs,
    queueHiddenAt: _queueHiddenAt,
    completedAt: _completedAt,
    failedAt: _failedAt,
    textResult: _textResult,
    ...metadata
  } = task.metadata || {}
  return {
    clientRequestId: crypto.randomUUID(),
    projectId: task.projectId,
    kind: task.kind,
    label: task.label,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    provider: task.provider,
    model: task.model || undefined,
    estimatedCredits: task.estimatedCredits,
    maxAttempts: task.maxAttempts,
    metadata,
  }
}

export default App
