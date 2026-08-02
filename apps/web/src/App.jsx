import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { IconButton } from './components/ui'
import { useAuth } from './components/AuthProvider'
import { canOpenAccountAdmin, getAdminConsoleUrl } from './features/account/access'
import { api } from './services/apiClient'
import {
  selectShotAssetReferences,
  selectVideoReferenceImages,
  taskUsesAssetReferences,
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
import { compileCharacterStagePrompt } from './features/assets/promptCompiler'

const kindByType = { 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' }
const videoResolutions = new Set(['480p', '720p', '1080p', '4k'])
const activeTaskStatuses = new Set(['queued', 'paused', 'running'])
const terminalTaskStatuses = new Set(['completed', 'failed'])
const TASK_STATUS_CACHE_KEY = 'seqora:task-status-cache'
const ACTIVE_TASK_POLL_MS = 2_500
const IDLE_TASK_POLL_MS = 12_000
const BACKGROUND_TASK_POLL_MS = 30_000

const AssetsPage = lazyNamed(() => import('./pages/AssetsPage'), 'AssetsPage')
const BillingPage = lazyNamed(() => import('./pages/BillingPage'), 'BillingPage')
const FilmPage = lazyNamed(() => import('./pages/FilmPage'), 'FilmPage')
const GenerationPage = lazyNamed(() => import('./pages/GenerationPage'), 'GenerationPage')
const OverviewPage = lazyNamed(() => import('./pages/OverviewPage'), 'OverviewPage')
const ProjectHomePage = lazyNamed(() => import('./pages/ProjectHomePage'), 'ProjectHomePage')
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
  const [loading, setLoading] = useState(true)
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

  const adminOnly = session.account.roles.includes('admin') && !session.permissions.includes('project.write')
  const canOpenAdminAccounts = canOpenAccountAdmin(session)
  const adminConsoleUrl = getAdminConsoleUrl()

  useEffect(() => {
    if (adminOnly) return
    Promise.all([api.projects(), api.billing(), api.health().catch(() => null)])
      .then(async ([projectList, billingSummary, health]) => {
        setProjects(projectList)
        setBilling(billingSummary)
        setProviderHealth(health)
        if (projectList[0]) setWorkspace(await api.project(projectList[0].id))
      })
      .catch((error) => setToast(error.message))
      .finally(() => setLoading(false))
  }, [adminOnly])

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
        const [nextTasks, nextWorkspace, nextBilling, nextProjects, nextRecentTasks] = await Promise.all([
          api.tasks(workspace.project.id),
          api.project(workspace.project.id),
          api.billing(),
          api.projects(),
          api.recentTasks(),
        ])
        if (cancelled) return
        setTasks(nextTasks)
        setWorkspace(nextWorkspace)
        setBilling(nextBilling)
        setProjects(nextProjects)
        setRecentTasks(nextRecentTasks)
        setRecentTasksLoaded(true)
        nextDelay = nextTasks.some((task) => activeTaskStatuses.has(task.status))
          ? ACTIVE_TASK_POLL_MS
          : IDLE_TASK_POLL_MS
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
  }, [workspace?.project.id])

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
      setTasks(await api.tasks(project.id))
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
    setTasks(await api.tasks(project.id))
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
      setTasks(await api.tasks(project.id))
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

  const markNotificationRead = (notificationId) => {
    setNotifications((current) =>
      current.map((item) => (item.id === notificationId ? { ...item, read: true } : item)),
    )
  }

  const openNotification = async (notification) => {
    markNotificationRead(notification.id)
    await refreshWorkspace(notification.projectId)
    setTasks(await api.tasks(notification.projectId))
    navigateTo(notification.target)
  }

  const retryNotification = async (notification) => {
    try {
      const created = await api.createTask(retryTaskInput(notification.task))
      markNotificationRead(notification.id)
      if (project?.id === created.projectId) setTasks(await api.tasks(created.projectId))
      setToast(`${created.label}已重新提交`)
    } catch (error) {
      setToast(error.message)
    }
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

  const createStoryboardImage = (shot) => {
    const references = selectShotAssetReferences(workspace.assets, shot)
    const generationReferences = [
      ...(shot.imageUrl
        ? [
            {
              id: `shot-reference-${shot.id}`,
              url: shot.imageUrl,
              name: `${shot.title}-reference.png`,
              assetName: '镜头参考图',
              assetKind: 'shot-reference',
            },
          ]
        : []),
      ...references,
    ].slice(0, 4)
    const referencePrompt = references.length
      ? `参考项目资产：${references.map((reference) => reference.assetName).join('、')}，严格保持人物身份、服装、场景和关键物品一致`
      : ''
    return createJob(`分镜图 ${String(shot.order).padStart(2, '0')} · ${shot.title}`, '图片', 6, {
      prompt: [
        shot.prompt,
        shot.continuityNote ? `场景衔接：${shot.continuityNote}` : '',
        shot.framing,
        referencePrompt,
        '电影分镜静帧，构图清晰，保持项目视觉风格一致',
      ]
        .filter(Boolean)
        .join('，'),
      negativePrompt: shot.negativePrompt,
      metadata: {
        shotId: shot.id,
        generationStage: 'storyboard',
        aspectRatio: project.aspectRatio,
        references: generationReferences,
        referenceAssetIds: references.map((reference) => reference.id),
      },
    })
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
    const previousShot = shotIndex > 0 ? orderedShots[shotIndex - 1] : null
    let sourceTask = continuitySourceTask
    if (continuityMode === 'continue' && previousShot && !sourceTask) {
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
    const imageTasks = tasks.filter(
      (task) =>
        task.kind === 'image' &&
        task.metadata?.shotId === shot.id &&
        task.status !== 'failed' &&
        task.status !== 'cancelled',
    )
    const existingImageTask =
      imageTasks.find((task) => task.id === shot.selectedImageTaskId) || imageTasks[0] || null
    const manualImageUrl =
      shot.imageUrl && !shot.imageUrl.startsWith('/api/v1/generation/tasks/') ? shot.imageUrl : null
    const currentImageTask = taskUsesAssetReferences(existingImageTask, references) ? existingImageTask : null
    const completedImageTask = currentImageTask?.status === 'completed' ? currentImageTask : null
    const completedImageUrl =
      manualImageUrl || (completedImageTask ? completedImageTask.resultUrl || shot.imageUrl : null)
    const storyboardImageUrl = completedImageUrl
    const images = selectVideoReferenceImages(storyboardImageUrl, references)
    const selectedResolution = videoResolutions.has(resolution) ? resolution : '720p'
    const videoPrompt = compileStoryboardVideoPrompt({
      project,
      shot,
      shots: workspace.shots,
      assets: workspace.assets,
      references,
      continuityMode,
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
        continuityMode,
        ...(sourceTask ? { continuitySourceTaskId: sourceTask.id } : {}),
        ...(storyboardImageUrl ? { storyboardImageUrl } : {}),
        images,
        videoInputMode: sourceTask
          ? 'continuity-first-frame'
          : storyboardImageUrl
            ? 'storyboard-and-assets'
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
          onOpen={async (projectId) => {
            await refreshWorkspace(projectId)
            setTasks(await api.tasks(projectId))
            navigateTo('overview')
          }}
          onRename={async (projectId, name) => {
            await api.updateProject(projectId, { name })
            if (project?.id === projectId) await refreshWorkspace(projectId)
            else setProjects(await api.projects())
            setToast('项目名称已更新')
          }}
          onDelete={async (projectId) => {
            await api.deleteProject(projectId)
            const nextProjects = await api.projects()
            setProjects(nextProjects)
            if (project?.id === projectId) {
              const nextWorkspace = nextProjects[0] ? await api.project(nextProjects[0].id) : null
              setWorkspace(nextWorkspace)
              setTasks(nextProjects[0] ? await api.tasks(nextProjects[0].id) : [])
            }
            setToast('项目已删除并归档')
          }}
        />
      )
    }
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
          assets={workspace.assets}
          billing={billing}
          tasks={tasks}
          onSave={async (script) => {
            await api.updateProject(project.id, { script })
            await refreshWorkspace()
            setToast('剧本已保存')
          }}
          onUpdateEpisodeDuration={async (episodeDurationSeconds) => {
            await api.updateProject(project.id, { episodeDurationSeconds })
            await refreshWorkspace()
            setToast(`已设置每集 ${episodeDurationSeconds} 秒，分镜会沿用该时长`)
          }}
          onGenerate={async (
            draft,
            direction,
            productionMode,
            episodeDurationSeconds,
            model,
            revisionNote,
            setPhase,
          ) => {
            setPhase?.('submitting')
            return createScriptJob(productionMode === 'web-series' ? '网剧剧本' : '快速剧本', 'generate', {
              draft,
              direction,
              mode: 'quick',
              productionMode,
              episodeDurationSeconds,
              episodeMinutes: Math.max(1, Math.ceil(episodeDurationSeconds / 60)),
              model,
              revisionNote,
            })
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
          ) => {
            setPhase?.('submitting')
            return createScriptJob(
              productionMode === 'web-series' ? '续写下一集' : '续写下一段',
              'generate',
              {
                draft,
                direction,
                mode: 'segment',
                segment,
                productionMode,
                episodeDurationSeconds,
                episodeMinutes: Math.max(1, Math.ceil(episodeDurationSeconds / 60)),
                model,
                revisionNote,
              },
            )
          }}
          onImportNovel={async (input) => {
            const result = await api.importNovel(project.id, input)
            setProjects(await api.projects())
            setToast(`小说已切分为 ${result.document.chapterCount} 章/段`)
            return result
          }}
          onPreviewNovelSplit={(input) => api.previewNovelSplit(project.id, input)}
          onListNovels={() => api.novels(project.id)}
          onGetNovel={(documentId) => api.novel(project.id, documentId)}
          onGetNovelSummaries={(documentId) => api.novelSummaries(project.id, documentId)}
          onGenerateNovelSummaries={async (documentId, input) => {
            try {
              const result = await api.generateNovelSummaries(project.id, documentId, input)
              setToast(
                result.completed ? '章节摘要已全部完成' : `已生成 ${result.generatedSummaries.length} 章摘要`,
              )
              return result
            } finally {
              await refreshBilling().catch(() => {})
            }
          }}
          onGetNovelStoryBible={(documentId) => api.novelStoryBible(project.id, documentId)}
          onGenerateNovelStoryBible={async (documentId, input) => {
            try {
              const result = await api.generateNovelStoryBible(project.id, documentId, input)
              setToast('全书故事概要已生成')
              return result
            } finally {
              await refreshBilling().catch(() => {})
            }
          }}
          onSuggestNovelAssets={async (documentId, input) => {
            const result = await api.suggestNovelAssets(project.id, documentId, input)
            setToast('小说资产建议已生成')
            return result
          }}
          onGenerateNovelChapterAdaptation={async (documentId, input) => {
            try {
              const result = await api.generateNovelChapterAdaptation(project.id, documentId, input)
              setToast('章节视频改编剧本已生成')
              return result
            } finally {
              await refreshBilling().catch(() => {})
            }
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
          onCancelTask={async (taskId) => {
            await api.deleteTask(taskId)
            setTasks(await api.tasks(project.id))
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
            await refreshWorkspace()
            return updated
          }}
          onRefreshTrustedPortrait={async (assetId) => {
            const updated = await api.refreshTrustedPortrait(project.id, assetId)
            await refreshWorkspace()
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
            return createJob(`${asset.name} · 重新生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
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
            await api.generateShots(project.id, {
              maxShots: project.contentType === 'short-drama' ? 120 : 48,
              mode,
              episodeDurationSeconds,
            })
            await refreshWorkspace()
            setToast(mode === 'beat' ? '已按动作节拍细拆分镜' : '已按场次智能生成并自动拆分动作镜头')
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
          onUpload={(file) => api.uploadMedia(project.id, file)}
          onGenerateImage={createStoryboardImage}
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
            setTasks(await api.tasks(project.id))
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
              setTasks(await api.tasks(project.id))
              setToast('任务已暂停')
            } catch (error) {
              setToast(error.message)
            }
          }}
          onResume={async (taskId) => {
            try {
              await api.resumeTask(taskId)
              setTasks(await api.tasks(project.id))
              setToast('任务已继续')
            } catch (error) {
              setToast(error.message)
            }
          }}
          onDelete={async (taskId) => {
            try {
              await api.deleteTask(taskId)
              setTasks(await api.tasks(project.id))
              await refreshBilling()
              setToast('任务已移出队列')
            } catch (error) {
              setToast(error.message)
            }
          }}
          onClear={async () => {
            await api.clearTasks(project.id)
            setTasks(await api.tasks(project.id))
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
              const task = await api.createFilmPreview(project.id, mode, false, episodeNumber)
              setTasks(await api.tasks(project.id))
              const target = mode === 'partial' ? '已完成片段' : '完整预览'
              setToast(task.status === 'completed' ? `${target}已是最新版本` : `${target}正在后台合成`)
              return task
            } catch (error) {
              setToast(error.message)
              return null
            }
          }}
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
          canEditProject={session.permissions.includes('project.write')}
          canOpenAdminConsole={canOpenAdminAccounts}
          adminConsoleUrl={adminConsoleUrl}
          onSave={updateProject}
          onChangePassword={(input) => api.changePassword(input)}
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
        projectName={activeStep === 'home' ? '项目库' : project?.name || '选择项目'}
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
        assetCount={workspace?.assets.length ?? 0}
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
      <LoaderCircle size={22} className="spin" />
      <p>正在加载页面…</p>
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
