import { ASSET_SUGGESTION_MODEL, SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'
import {
  compileStoryboardVideoPrompt,
  normalizedVideoDuration,
  VIDEO_PROMPT_VERSION,
} from '@seqora/prompting'
import { compileCharacterStagePrompt } from '../assets/promptCompiler'
import { readProjectTaskCache } from '../generation/projectTaskCache'
import { hasLastFrame, latestVideoTaskFor } from '../generation/taskMedia'
import { retryTaskInput } from '../notifications/taskNotifications'
import {
  createShotAssetReferenceIndex,
  selectShotAssetReferencesFromIndex,
  selectVideoReferenceImages,
} from '../storyboard/referenceSelector'
import {
  activeVideoTasksForShots,
  isCompatibleCompletedVideoTask,
  planSelectedVideoRegeneration,
  planVideoBatch,
} from '../storyboard/videoBatchPlanner'
import { api } from '../../services/apiClient'

const TASK_KIND_BY_LABEL = { 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' }
const VIDEO_RESOLUTIONS = new Set(['480p', '720p', '1080p', '4k'])

export function createWorkspaceCommands({
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
  assetReferenceIndex,
  generationConcurrency = 1,
}) {
  const resolvedAssetReferenceIndex = assetReferenceIndex || createShotAssetReferenceIndex(workspace?.assets)

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
      const kind = TASK_KIND_BY_LABEL[type] || 'image'
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
      const taskModel = operation === 'suggest-assets' ? ASSET_SUGGESTION_MODEL : input.model
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
        model: taskModel,
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
          model: taskModel,
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
      allowCreateContinuitySource = true,
    } = {},
  ) => {
    const references = selectShotAssetReferencesFromIndex(
      resolvedAssetReferenceIndex,
      shot,
      6,
      workspace.assets,
    )
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
      if (!sourceTask && allowCreateContinuitySource && !chain.includes(previousShot.id)) {
        sourceTask = await createStoryboardVideo(previousShot, {
          resolution,
          chain: [...chain, shot.id],
          batchId,
          batchMode,
          allowCreateContinuitySource,
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
    const selectedResolution = VIDEO_RESOLUTIONS.has(resolution) ? resolution : '720p'
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
        ...(batchId ? { batchId, batchMode, batchPlanVersion: 'v2' } : {}),
        ...(dependencyIds.length
          ? { dependsOnTaskId: dependencyIds[0], dependsOnTaskIds: dependencyIds }
          : {}),
      },
    })
  }

  const createStoryboardVideoBatch = async (
    shotsToGenerate,
    resolution,
    mode = 'parallel',
    { forceNewVersion = false, selectionMode = 'continuity' } = {},
  ) => {
    const activeTasks = activeVideoTasksForShots(tasks, shotsToGenerate)
    if (activeTasks.length) {
      const shotCount = new Set(activeTasks.map((task) => task.metadata?.shotId)).size
      throw new Error(`当前有 ${shotCount} 个分镜视频任务仍在队列中，请先在生成队列暂停或删除后再切换策略。`)
    }

    const batchId = crypto.randomUUID()
    const plan = forceNewVersion
      ? planSelectedVideoRegeneration(
          workspace.shots,
          shotsToGenerate.map((shot) => shot.id),
          selectionMode,
          generationConcurrency,
        )
      : planVideoBatch(shotsToGenerate, mode, generationConcurrency)
    if (plan.continuityUpdates.length) {
      await Promise.all(
        plan.continuityUpdates.map((update) =>
          api.updateShot(project.id, update.shotId, { continuityMode: update.continuityMode }),
        ),
      )
    }

    const completedVideoTasksByShot = new Map()
    for (const task of tasks) {
      if (task.kind !== 'video' || task.status !== 'completed') continue
      const shotId = task.metadata?.shotId
      if (!shotId) continue
      const candidates = completedVideoTasksByShot.get(shotId) || []
      candidates.push(task)
      completedVideoTasksByShot.set(shotId, candidates)
    }
    const laneResults = await Promise.all(
      plan.lanes.map(async (lane) => {
        let created = 0
        let previousVideoTask = null
        for (const [shotIndex, shot] of lane.entries()) {
          const references = selectShotAssetReferencesFromIndex(
            resolvedAssetReferenceIndex,
            shot,
            6,
            workspace.assets,
          )
          const mustProvideLastFrame = lane[shotIndex + 1]?.continuityMode === 'continue'
          const existingVideo = forceNewVersion
            ? null
            : (completedVideoTasksByShot.get(shot.id) || []).find(
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
            batchMode: forceNewVersion ? `reroll-${selectionMode}` : mode,
            allowCreateContinuitySource: !forceNewVersion,
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
    const laneCount = Math.min(plan.immediateLaneCount, created)
    if (created) {
      setToast(
        forceNewVersion
          ? `已创建 ${created} 个重做任务，旧版本仍可切换`
          : mode === 'parallel'
            ? `已创建 ${created} 个视频任务，${laneCount} 路安全并发执行`
            : mode === 'independent'
              ? `已创建 ${created} 个独立视频任务，全部并发提交`
              : `已按尾帧承接关系创建 ${created} 个视频任务`,
      )
    }
    return { created, laneCount }
  }

  return {
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
  }
}
