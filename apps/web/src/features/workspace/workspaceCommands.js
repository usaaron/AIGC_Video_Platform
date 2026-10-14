import { bindVideoAssetReferences, shotReferenceImages, validateShotReferences } from '@seqora/prompting'
import { ASSET_SUGGESTION_MODEL, SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'
import {
  compileStoryboardVideoPrompt,
  normalizedVideoDuration,
  VIDEO_PROMPT_VERSION,
} from '@seqora/prompting'
import { compileCharacterStagePrompt } from '../assets/promptCompiler'
import { assetGenerationReferences } from '../assets/assetGenerationReferences'
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
import {
  isActiveWorkspaceProject,
  normalizeTasks,
  normalizeWorkspace,
  workflowNavigationBlockMessage,
  workflowNavigationAccess,
} from './workspaceLoadingPolicy'

const TASK_KIND_BY_LABEL = { 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' }
const VIDEO_RESOLUTIONS = new Set(['480p', '720p', '1080p', '4k'])

export function createWorkspaceCommands({
  project,
  projects,
  workspace,
  tasks,
  workspaceCacheRef,
  activeProjectIdRef,
  projectCreationInFlightRef,
  assetOperationInFlightRef,
  replaceTasks,
  refreshSession,
  markNotificationRead,
  setActiveStep,
  setScriptMasterOpened,
  setMobileNav,
  setWorkspace,
  setActiveProject,
  setTasks,
  setBilling,
  setProjects,
  setNewProjectOpen,
  setToast,
  assetReferenceIndex,
  generationConcurrency = 1,
  workflowAccess = null,
}) {
  const resolvedAssetReferenceIndex = assetReferenceIndex || createShotAssetReferenceIndex(workspace?.assets)
  const creationLock = projectCreationInFlightRef || { current: null }
  const assetLock = assetOperationInFlightRef || { current: new Map() }
  if (!(assetLock.current instanceof Map)) assetLock.current = new Map()
  const isCurrentProject = (projectId) => isActiveWorkspaceProject(activeProjectIdRef?.current, projectId)

  const runAssetOperation = (operation, input, work) => {
    const key = `${project?.id || 'unknown'}:${operation}:${stableOperationValue(input)}`
    return runSingleFlight(assetLock.current, key, work)
  }

  const refreshWorkspace = async (projectId = project?.id) => {
    if (!projectId) return
    const next = normalizeWorkspace(await api.project(projectId))
    if (!next) throw new Error('项目数据格式异常，请重新打开项目。')
    workspaceCacheRef.current.set(projectId, next)
    if (isCurrentProject(projectId)) setWorkspace(next)
    void api
      .projects()
      .then((nextProjects) => {
        if (isCurrentProject(projectId)) setProjects(nextProjects)
      })
      .catch((error) => {
        if (isCurrentProject(projectId)) setToast(error.message || '项目列表暂时无法同步。')
      })
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
    if (!isCurrentProject(project.id)) return
    const safeWorkspace = normalizeWorkspace(nextWorkspace)
    if (!safeWorkspace) throw new Error('项目数据格式异常，请重新打开项目。')
    workspaceCacheRef.current.set(project.id, safeWorkspace)
    setWorkspace(safeWorkspace)
    setTasks(normalizeTasks(nextTasks))
    setBilling(nextBilling)
    setProjects(nextProjects)
  }

  // Asset writes can be triggered from both the script handoff and the asset
  // page. Keep the lock above the network boundary so a rapid double click
  // shares the same accepted write and never queues two follow-up generations.
  const persistAsset = async (input) => {
    if (!project) throw new Error('请先打开一个项目')
    return api.createAsset(project.id, input)
  }

  const createAsset = async (input) =>
    runAssetOperation('create', input, async () => {
      const created = await persistAsset(input)
      await refreshWorkspace()
      setToast(`已加入资产：${created.name}`)
      return created
    })

  const importAssets = async (inputs) => {
    const list = Array.isArray(inputs) ? inputs : []
    if (!list.length) return []
    return runAssetOperation('import', list, async () => {
      const results = await Promise.allSettled(list.map((input) => persistAsset(input)))
      await refreshWorkspace()
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) {
        throw new Error(failed.reason?.message || '部分资产未能加入，已加入的资产已保留，请重试。')
      }
      const created = results.map((result) => result.value)
      setToast(`已加入 ${created.length} 项资产`)
      return created
    })
  }

  const createJob = (label, type = '图片', cost = 6, options = {}) => {
    if (!project) return Promise.resolve(undefined)
    try {
      const kind = TASK_KIND_BY_LABEL[type] || 'image'
      const assetId = options.metadata?.assetId
      const singleFlightKey =
        options.singleFlightKey ||
        (assetId
          ? `asset-job:${project.id}:${kind}:${assetId}:${options.metadata?.generationStage || label}`
          : null)
      const submit = async () => {
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
        if (options.refreshAfterCreate !== false) {
          // Once accepted, a failed refresh must not invite another paid submission.
          if (isCurrentProject(project.id)) {
            setTasks((current) => [created, ...current.filter((task) => task.id !== created.id)])
          }
          const refreshed = await Promise.allSettled([
            api.tasks(project.id).then((next) => {
              if (isCurrentProject(project.id)) replaceTasks(project.id, next)
            }),
            refreshBilling(),
          ])
          setToast(
            refreshed.some((result) => result.status === 'rejected')
              ? `${label} 已加入生成队列，状态同步稍有延迟，请勿重复提交`
              : `${label} 已加入生成队列`,
          )
        }
        return created
      }
      const operation = () =>
        submit().catch((error) => {
          setToast(error.message)
          return null
        })
      return singleFlightKey ? runSingleFlight(assetLock.current, singleFlightKey, operation) : operation()
    } catch (error) {
      setToast(error.message)
      return Promise.resolve(null)
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

  const createAndGenerateAsset = async (input) =>
    runAssetOperation('create-and-generate', input, async () => {
      const created = await persistAsset(input)
      await refreshWorkspace()
      const currentTasks = await api.tasks(project.id)
      if (
        created.imageUrl ||
        (created.attributes.type === 'character' && created.attributes.faceReference) ||
        currentTasks.some(
          (task) =>
            task.metadata?.assetId === created.id &&
            task.kind === 'image' &&
            ['queued', 'paused', 'running', 'completed'].includes(task.status),
        )
      ) {
        setToast(`${created.name}已复用；新造型可在人物设计中选择后生成`)
        return created
      }
      const task =
        created.kind === 'character'
          ? await createCharacterFaceJob(created, 'img2-default', '资产建议 · 面部大头照')
          : await createJob(`${created.name} · 资产建议生成`, created.kind === 'audio' ? '音频' : '图片', 6, {
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
    })

  const createTrustedPortraitJob = async (assetId, assetName = '人物', faceReferenceId) => {
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
        ...(faceReferenceId ? { faceReferenceId } : {}),
      },
    })
    replaceTasks(project.id, await api.tasks(project.id))
    await refreshBilling()
    setToast('AI 人像资源已进入后台任务，完成后会自动同步状态')
    return task
  }

  const confirmCharacterFace = async (assetId, faceReference) => {
    const projectId = project?.id
    if (!projectId) throw new Error('请先打开人物所属项目')
    const result = await api.confirmCharacterFace(projectId, assetId, faceReference)
    if (isCurrentProject(projectId)) mergeWorkspaceAsset(result.asset)
    // Confirmation has already succeeded. A refresh failure must not report it as a failed save.
    const refreshed = await Promise.allSettled([
      api.tasks(projectId).then((next) => replaceTasks(projectId, next)),
      refreshBilling(),
    ])
    if (isCurrentProject(projectId)) {
      setToast(
        result.registrationError ||
          (refreshed.some((item) => item.status === 'rejected')
            ? '面部已确认，状态同步暂时失败，请稍后刷新'
            : result.registrationTask
              ? '面部已确认，AI 人像加白任务已提交，可继续制作全身'
              : '面部已确认'),
      )
    }
    return result
  }

  const createScriptJob = async (label, operation, input) => {
    if (!project) return null
    const submit = async () => {
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
          estimatedCredits: input.episodePlan
            ? SCRIPT_OPERATION_CREDITS.generate * input.episodePlan.episodes.length
            : operation === 'enrich'
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
    if (operation !== 'suggest-assets') return submit()
    return runAssetOperation(
      'suggest-assets',
      {
        sourceScriptFingerprint: input.sourceScriptFingerprint,
        assetRevision: input.assetRevision,
        script: input.script,
      },
      submit,
    )
  }

  const navigateTo = (id) => {
    if (workflowAccess && Object.hasOwn(workflowAccess, id) && workflowAccess[id] === false) {
      setToast(workflowNavigationBlockMessage(id, workflowAccess))
      return false
    }
    if (id === 'writing-studio') {
      setScriptMasterOpened?.(true)
    }
    setActiveStep(id)
    setMobileNav(false)
    if (id === 'home') {
      activeProjectIdRef.current = null
      setActiveProject?.(null)
    }
    if (id === 'home') {
      void api
        .projects()
        .then(setProjects)
        .catch((error) => setToast(error.message))
    }
    return true
  }

  const openProject = async (projectId) => {
    activeProjectIdRef.current = projectId
    setActiveProject?.(projectId)
    let projectSummary = projects.find((item) => item.id === projectId)
    if (!projectSummary) {
      try {
        const next = normalizeWorkspace(await api.project(projectId))
        projectSummary = next?.project
        if (next) workspaceCacheRef.current.set(projectId, next)
      } catch (error) {
        if (!isCurrentProject(projectId)) return null
        if (isCurrentProject(projectId)) setWorkspace(null)
        setToast(error.message || '项目暂时无法打开，请稍后重试。')
        return null
      }
    }
    if (!isCurrentProject(projectId)) return null
    if (!projectSummary) {
      setWorkspace(null)
      setToast('项目不存在或暂时无法访问。')
      return null
    }
    const cachedWorkspace = normalizeWorkspace(workspaceCacheRef.current.get(projectId))
    if (!cachedWorkspace) workspaceCacheRef.current.delete(projectId)
    setWorkspace(cachedWorkspace || null)
    replaceTasks(projectId, readProjectTaskCache(projectId))
    navigateTo('overview')
    return projectSummary
  }

  const openNotification = async (notification) => {
    markNotificationRead(notification.id)
    const opened = await openProject(notification.projectId)
    if (!opened || !isCurrentProject(notification.projectId)) return false

    // A project summary is enough for the library, but a notification target
    // needs the complete workspace so its stage gate is evaluated against the
    // destination project rather than the project that was previously open.
    let nextWorkspace = normalizeWorkspace(workspaceCacheRef.current.get(notification.projectId))
    if (!nextWorkspace) {
      try {
        nextWorkspace = normalizeWorkspace(await api.project(notification.projectId))
      } catch (error) {
        if (isCurrentProject(notification.projectId)) {
          setToast(error.message || '项目内容暂时无法加载，请稍后重试。')
        }
        return false
      }
      if (!isCurrentProject(notification.projectId)) return false
    }
    if (!nextWorkspace) {
      setToast('项目内容暂时无法加载，请稍后重试。')
      return false
    }
    workspaceCacheRef.current.set(notification.projectId, nextWorkspace)
    setWorkspace(nextWorkspace)
    const access = workflowNavigationAccess(nextWorkspace)
    if (access[notification.target] === false) {
      setToast(workflowNavigationBlockMessage(notification.target, access))
      return false
    }
    setActiveStep(notification.target)
    setMobileNav(false)
    return true
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
    if (creationLock.current) return creationLock.current
    const idempotencyKey =
      globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const operation = (async () => {
      try {
        const created = await api.createProject(input, idempotencyKey)
        activeProjectIdRef.current = created.id
        setActiveProject?.(created.id)
        await refreshWorkspace(created.id)
        replaceTasks(created.id, readProjectTaskCache(created.id))
        setNewProjectOpen(false)
        navigateTo('script')
        setToast('新项目已创建')
        return created
      } catch (error) {
        setToast(error.message)
        return null
      }
    })()

    creationLock.current = operation
    try {
      return await operation
    } finally {
      if (creationLock.current === operation) creationLock.current = null
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
      refreshAfterCreate = true,
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
    const manualReferenceImages = shotReferenceImages(shot)
    validateShotReferences(shot.prompt, manualReferenceImages.length, actualContinuityMode === 'continue')
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
    const manualReferenceUrl = manualReferenceImages[0]?.url || null
    const images = selectVideoReferenceImages(
      manualReferenceImages.map((image) => image.url),
      references,
      actualContinuityMode === 'continue' ? 8 : 9,
    )
    const selectedResolution = VIDEO_RESOLUTIONS.has(resolution) ? resolution : '720p'
    const videoPrompt = compileStoryboardVideoPrompt({
      project,
      shot,
      shots: workspace.shots,
      assets: workspace.assets,
      references: bindVideoAssetReferences(references, images, actualContinuityMode === 'continue'),
      continuityMode: actualContinuityMode,
      manualReferenceCount: manualReferenceImages.length,
    })
    const dependencyIds = [sourceTask && sourceTask.status !== 'completed' ? sourceTask.id : null].filter(
      Boolean,
    )
    return createJob(`镜头 ${String(shot.order).padStart(2, '0')} · ${shot.title}`, '视频', 18, {
      refreshAfterCreate,
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
        manualReferenceImages,
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
    for (const lane of plan.lanes)
      for (const shot of lane)
        validateShotReferences(
          shot.prompt,
          shotReferenceImages(shot).length,
          shot.continuityMode === 'continue',
        )
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
                    manualReferenceImages: shotReferenceImages(shot),
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
            refreshAfterCreate: false,
          })
          if (!createdTask) break
          previousVideoTask = createdTask
          created += 1
        }
        return created
      }),
    )
    const created = laneResults.reduce((total, count) => total + count, 0)
    const [, nextTasks] = await Promise.all([refreshWorkspace(), api.tasks(project.id)])
    replaceTasks(project.id, nextTasks)
    if (created) await refreshBilling()
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
    updateShot: async (shotId, input, { successMessage = '分镜已更新' } = {}) => {
      const saved = await api.updateShot(project.id, shotId, input)
      await refreshWorkspace()
      setToast(successMessage)
      return saved
    },
    assetCommands: {
      onCreate: createAsset,
      onUpdate: async (assetId, input) => {
        const updated = await api.updateAsset(project.id, assetId, input)
        await refreshWorkspace()
        setToast('资产已更新')
        return updated
      },
      onDelete: async (assetId) => {
        await api.deleteAsset(project.id, assetId)
        await refreshWorkspace()
        setToast('资产已删除')
      },
      onBindTrustedPortrait: async (assetId, providerAssetId) => {
        const updated = await api.bindTrustedPortrait(project.id, assetId, providerAssetId)
        mergeWorkspaceAsset(updated)
        return updated
      },
      onRefreshTrustedPortrait: async (assetId) => {
        const updated = await api.refreshTrustedPortrait(project.id, assetId)
        mergeWorkspaceAsset(updated)
        return updated
      },
      onRegisterVirtualPortrait: createTrustedPortraitJob,
      onConfirmFace: confirmCharacterFace,
    },
    refreshWorkspace,
    mergeWorkspaceAsset,
    refreshBilling,
    refreshCurrentProjectData,
    createJob,
    createAsset,
    importAssets,
    createAndGenerateAsset,
    createCharacterFaceJob,
    createTrustedPortraitJob,
    confirmCharacterFace,
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

export function createCharacterStageJob(createJob, project, asset, stage, prompt, model) {
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
}

function runSingleFlight(lockMap, key, operation) {
  const existing = lockMap.get(key)
  if (existing) return existing
  const promise = Promise.resolve().then(operation)
  lockMap.set(key, promise)
  promise.then(
    () => {
      if (lockMap.get(key) === promise) lockMap.delete(key)
    },
    () => {
      if (lockMap.get(key) === promise) lockMap.delete(key)
    },
  )
  return promise
}

function stableOperationValue(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableOperationValue).join(',')}]`
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableOperationValue(value[key])}`)
    .join(',')}}`
}
