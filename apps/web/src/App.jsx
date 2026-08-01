import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import './App.css'
import { AppHeader, AppSidebar, NewProjectModal } from './components/AppShell'
import { IconButton } from './components/ui'
import { useAuth } from './components/AuthProvider'
import { canEditProjectSettings, canOpenAccountAdmin, getAdminConsoleUrl } from './features/account/access'
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

const kindByType = { 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' }
const videoResolutions = new Set(['480p', '720p', '1080p', '4k'])
const activeTaskStatuses = new Set(['queued', 'paused', 'running'])
const ACTIVE_TASK_POLL_MS = 2_500
const IDLE_TASK_POLL_MS = 12_000
const BACKGROUND_TASK_POLL_MS = 30_000

const AssetsPage = lazyNamed(() => import('./pages/AssetsPage'), 'AssetsPage')
const BillingPage = lazyNamed(() => import('./pages/BillingPage'), 'BillingPage')
const FilmPage = lazyNamed(() => import('./pages/FilmPage'), 'FilmPage')
const GenerationPage = lazyNamed(() => import('./pages/GenerationPage'), 'GenerationPage')
const OverviewPage = lazyNamed(() => import('./pages/OverviewPage'), 'OverviewPage')
const ScriptPage = lazyNamed(() => import('./pages/ScriptPage'), 'ScriptPage')
const SettingsPage = lazyNamed(() => import('./pages/SettingsPage'), 'SettingsPage')
const StoryboardPage = lazyNamed(() => import('./pages/StoryboardPage'), 'StoryboardPage')

function App() {
  const { session, logout, refresh: refreshSession } = useAuth()
  const [activeStep, setActiveStep] = useState('overview')
  const [projects, setProjects] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [organizations, setOrganizations] = useState([])
  const [ownSessions, setOwnSessions] = useState([])
  const [tasks, setTasks] = useState([])
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mobileNav, setMobileNav] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [currentShot, setCurrentShot] = useState(0)

  const canOpenAdminAccounts = canOpenAccountAdmin(session)
  const canUseCreativeWorkspace =
    session.account.emailVerified !== false && session.permissions.includes('project.write')
  const canManageProjectSettings = canEditProjectSettings(session)
  const adminConsoleUrl = getAdminConsoleUrl()

  useEffect(() => {
    if (!canUseCreativeWorkspace) {
      setProjects([])
      setWorkspace(null)
      setTasks([])
      setBilling({ plan: session.account.plan, credits: session.account.credits, concurrency: 0 })
      setLoading(false)
      return
    }
    setLoading(true)
    setWorkspace(null)
    setTasks([])
    Promise.all([api.projects(), api.billing()])
      .then(async ([projectList, billingSummary]) => {
        setProjects(projectList)
        setBilling(billingSummary)
        if (projectList[0]) setWorkspace(await api.project(projectList[0].id))
      })
      .catch((error) => setToast(error.message))
      .finally(() => setLoading(false))
  }, [canUseCreativeWorkspace, session.account.tenantId, session.account.plan, session.account.credits])

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
        const [nextTasks, nextWorkspace, nextBilling] = await Promise.all([
          api.tasks(workspace.project.id),
          api.project(workspace.project.id),
          api.billing(),
        ])
        if (cancelled) return
        setTasks(nextTasks)
        setWorkspace(nextWorkspace)
        setBilling(nextBilling)
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
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2_800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeStep])

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

  const refreshAccountScope = useCallback(async () => {
    const [nextOrganizations, nextSessions] = await Promise.all([api.organizations(), api.authSessions()])
    setOrganizations(nextOrganizations)
    setOwnSessions(nextSessions)
  }, [])

  const switchAccountOrganization = useCallback(
    async (organizationId) => {
      await api.switchOrganization(organizationId)
      const nextSession = await refreshSession()
      setProjects([])
      setWorkspace(null)
      setTasks([])
      if (nextSession.permissions.includes('billing.read.self')) setBilling(await api.billing())
      else
        setBilling({ plan: nextSession.account.plan, credits: nextSession.account.credits, concurrency: 0 })
      await refreshAccountScope()
      setToast('组织已切换')
    },
    [refreshAccountScope, refreshSession],
  )

  const revokeOwnSession = useCallback(
    async (sessionId) => {
      await api.revokeAuthSession(sessionId)
      await refreshAccountScope()
      setToast('Session 已撤销')
    },
    [refreshAccountScope],
  )

  if (loading || !billing)
    return (
      <div className="app-loading">
        <LoaderCircle size={24} className="spin" />
        <p>正在加载项目…</p>
      </div>
    )

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
        model: kind === 'video' ? undefined : kind === 'image' ? 'img2-default' : undefined,
        tier: options.tier ?? (kind === 'video' ? 'fast' : undefined),
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

  const createStoryboardImage = (shot) => {
    const references = selectShotAssetReferences(workspace.assets, shot)
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
        references,
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
      sourceTask = latestVideoTaskFor(tasks, previousShot.id, true)
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
    const existingImageTask = tasks.find(
      (task) =>
        task.kind === 'image' &&
        task.metadata?.shotId === shot.id &&
        task.status !== 'failed' &&
        task.status !== 'cancelled',
    )
    const manualImageUrl =
      shot.imageUrl && !shot.imageUrl.startsWith('/api/v1/generation/tasks/') ? shot.imageUrl : null
    const currentImageTask = taskUsesAssetReferences(existingImageTask, references) ? existingImageTask : null
    const imageTask = currentImageTask
    const completedImageUrl =
      manualImageUrl ||
      (currentImageTask?.status === 'completed' ? currentImageTask.resultUrl || shot.imageUrl : null)
    const storyboardImageUrl =
      completedImageUrl || (imageTask ? `/api/v1/generation/tasks/${imageTask.id}/outputs/single` : null)
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
    const dependencyIds = [
      imageTask && imageTask.status !== 'completed' ? imageTask.id : null,
      sourceTask && sourceTask.status !== 'completed' ? sourceTask.id : null,
    ].filter(Boolean)
    return createJob(`镜头 ${String(shot.order).padStart(2, '0')} · ${shot.title}`, '视频', 18, {
      prompt: videoPrompt,
      negativePrompt: shot.negativePrompt,
      metadata: {
        shotId: shot.id,
        duration: normalizedVideoDuration(shot.duration),
        requestedDuration: shot.duration,
        aspectRatio: project.aspectRatio,
        resolution: selectedResolution,
        generateAudio: false,
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
    const settingsPage = (
      <SettingsPage
        key={project?.id ?? 'profile'}
        project={project}
        account={session.account}
        canEditProject={canManageProjectSettings}
        canOpenAdminConsole={canOpenAdminAccounts}
        adminConsoleUrl={adminConsoleUrl}
        organizations={organizations}
        sessions={ownSessions}
        onLoadAccountScope={refreshAccountScope}
        onSwitchOrganization={switchAccountOrganization}
        onRevokeSession={revokeOwnSession}
        onSave={updateProject}
        onChangePassword={(input) => api.changePassword(input)}
        onRequestEmailVerification={() => api.requestEmailVerification({ email: session.account.email })}
        onLogout={logout}
      />
    )

    if (activeStep === 'settings') return settingsPage

    if (!canUseCreativeWorkspace) return settingsPage

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
          billing={billing}
          onSave={async (script) => {
            await api.updateProject(project.id, { script })
            await refreshWorkspace()
            setToast('剧本已保存')
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
          onGenerateNovelChapterAdaptation={async (documentId, input) => {
            try {
              const result = await api.generateNovelChapterAdaptation(project.id, documentId, input)
              setToast('章节视频改编剧本已生成')
              return result
            } finally {
              await refreshBilling().catch(() => {})
            }
          }}
          onSuggestNovelAssets={async (documentId, input) => {
            try {
              const result = await api.suggestNovelAssets(project.id, documentId, input)
              setToast('小说资产建议已生成')
              return result
            } finally {
              await refreshBilling().catch(() => {})
            }
          }}
          onSuggestAssets={(script, direction, model) =>
            api.suggestScriptAssets(project.id, script, direction, undefined, model)
          }
          onEnrich={async (script, direction, model) => {
            try {
              const result = await api.enrichScript(project.id, script, direction, undefined, model)
              await refreshWorkspace()
              setToast('AI 扩写已写入剧本')
              return result
            } finally {
              await refreshBilling().catch(() => {})
            }
          }}
          onCreateAsset={async (input) => {
            const created = await api.createAsset(project.id, input)
            await refreshWorkspace()
            setToast(`已加入资产：${created.name}`)
            return created
          }}
          onPlanQuickStart={(model) => api.planQuickStart(project.id, model)}
          onExecuteQuickStart={async (input) => {
            const result = await api.executeQuickStart(project.id, input)
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
            await refreshSession()
            setToast(`已创建 ${result.createdAssets.length} 项尝鲜资产`)
            return result
          }}
          onNext={() => navigateTo('assets')}
        />
      ),
      assets: (
        <AssetsPage
          project={project}
          assets={workspace.assets}
          tasks={tasks}
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
          onRegisterVirtualPortrait={async (assetId) => {
            const updated = await api.registerVirtualPortrait(project.id, assetId)
            await refreshWorkspace()
            return updated
          }}
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
          onGenerate={(asset) => {
            if (asset.sourceMode === 'import') {
              setToast('直接导入资产已使用原图，不会创建 Img2 任务')
              return null
            }
            return createJob(`${asset.name} · 重新生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
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
          }}
          onGenerateAll={(selectedAssets) =>
            Promise.all(
              selectedAssets
                .filter((asset) => asset.sourceMode === 'generate')
                .map((asset) =>
                  createJob(`${asset.name} · 资产生成`, asset.kind === 'audio' ? '音频' : '图片', 6, {
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
                ),
            )
          }
          onNext={() => navigateTo('storyboard')}
        />
      ),
      storyboard: (
        <StoryboardPage
          shots={workspace.shots}
          assets={workspace.assets}
          tasks={tasks}
          concurrency={billing.concurrency}
          onRegenerate={async (mode = 'scene') => {
            await api.generateShots(project.id, {
              maxShots: mode === 'beat' ? 36 : 8,
              mode,
            })
            await refreshWorkspace()
            setToast(mode === 'beat' ? '已按动作节拍细拆分镜' : '已按场次重新拆分分镜')
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
                  ? `已创建 ${created} 个视频任务，${laneCount} 路并发执行`
                  : `已按原衔接关系创建 ${created} 个视频任务`,
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
          onComposePreview={async (mode = 'full') => {
            try {
              const task = await api.createFilmPreview(project.id, mode)
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
      billing: <BillingPage billing={billing} />,
      settings: settingsPage,
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
        creativeEnabled={canUseCreativeWorkspace}
        onOpenNav={() => setMobileNav(true)}
        onProjectClick={() => canUseCreativeWorkspace && setProjectMenuOpen(true)}
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
        creativeEnabled={canUseCreativeWorkspace}
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
      {projectMenuOpen && canUseCreativeWorkspace && (
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

function latestVideoTaskFor(tasks, shotId, needsLastFrame = false) {
  return (
    tasks.find(
      (task) =>
        task.kind === 'video' &&
        task.metadata?.shotId === shotId &&
        task.status !== 'cancelled' &&
        (task.status === 'queued' || task.status === 'paused' || task.status === 'running'),
    ) ||
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

export default App
