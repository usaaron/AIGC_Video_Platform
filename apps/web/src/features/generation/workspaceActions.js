import { completedVideoTaskForShot, latestVideoTaskForShot } from './taskResults'
import { api } from '../../services/apiClient'
import { negativePromptForVideoProject, negativeTermsFromPrompt } from '../prompts/negativePromptPresets'
import {
  advancedVideoMetadataForShot,
  advancedVideoModeById,
  advancedVideoPromptForShot,
  agentFilmPlanForProject,
} from '../storyboard/advancedVideoTools'

const kindByType = { 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' }
const assetKindLabels = { character: '角色', scene: '场景', prop: '道具', costume: '服装', audio: '音频' }
const transientTaskMetadataKeys = new Set([
  'providerName',
  'providerState',
  'providerTaskId',
  'providerPolledAt',
  'providerPollErrors',
  'cancelledAt',
  'refundCredits',
  'refundPolicy',
])

export function createWorkspaceActions({
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
}) {
  const createJob = async (label, type = '图片', cost = 6, options = {}) => {
    if (!project) return
    try {
      const kind = kindByType[type] || 'image'
      const provider =
        options.provider ??
        (kind === 'image' ? 'img2' : kind === 'video' ? 'seedance' : kind === 'audio' ? 'audio' : 'local')
      await api.createTask({
        clientRequestId: crypto.randomUUID(),
        projectId: project.id,
        kind,
        label,
        prompt: options.prompt,
        negativePrompt: options.negativePrompt,
        provider,
        model:
          options.model ??
          (kind === 'video' ? 'doubao-seedance-2-0-260128' : kind === 'image' ? 'img2-default' : undefined),
        estimatedCredits: cost,
        metadata: options.metadata,
      })
      setTasks(await api.tasks(project.id))
      await refreshBilling()
      setToast(`${label} 已加入生成队列`)
    } catch (error) {
      setToast(error.message)
      if (options.rethrow) throw error
    }
  }

  const retryJob = async (job) => {
    try {
      await api.retryTask(job.id)
      await refreshTasks()
      setToast(`${job.label} 已重新加入队列`)
    } catch (error) {
      setToast(error.message)
      throw error
    }
  }

  const rerunJob = async (job) => {
    try {
      await createJob(job.label, typeLabelForKind(job.kind), job.estimatedCredits, {
        provider: job.provider,
        model: job.model ?? undefined,
        prompt: job.prompt,
        negativePrompt: job.negativePrompt,
        metadata: cleanTaskMetadata(job.metadata),
        rethrow: true,
      })
      setToast(`${job.label} 已重新创建`)
    } catch (error) {
      setToast(error.message)
      throw error
    }
  }

  const createShotVideoJob = (shot, options = {}) => {
    const referencedAssets = referencedAssetsForShot(workspace?.assets ?? [], shot)
    const promptParts = splitShotPromptForGeneration(shot.prompt)
    const metadata = baseVideoMetadataForShot(project, shot, referencedAssets)
    return createJob(`镜头 ${String(shot.order).padStart(2, '0')} · ${shot.title}`, '视频', 18, {
      prompt: videoPromptForShot({ ...shot, prompt: promptParts.prompt }, referencedAssets),
      negativePrompt: mergeNegativePrompts([
        negativePromptForVideoProject(project),
        promptParts.negativePrompt,
      ]),
      metadata: {
        ...metadata,
        videoMode: 'text-to-video',
      },
      rethrow: options.rethrow,
    })
  }

  const createAdvancedVideoJob = (shot, modeId, options = {}) => {
    const referencedAssets = referencedAssetsForShot(workspace?.assets ?? [], shot)
    const promptParts = splitShotPromptForGeneration(shot.prompt)
    const mode = advancedVideoModeById(modeId)
    const baseMetadata = baseVideoMetadataForShot(project, shot, referencedAssets)
    const advancedMetadata = advancedVideoMetadataForShot(shot, mode.id, options)
    const prompt = advancedVideoPromptForShot({ ...shot, prompt: promptParts.prompt }, mode.id, options)
    return createJob(
      `镜头 ${String(shot.order).padStart(2, '0')} · ${mode.title}`,
      '视频',
      options.estimatedCredits ?? mode.estimatedCredits,
      {
        prompt: videoPromptForShot({ ...shot, prompt }, referencedAssets),
        negativePrompt: mergeNegativePrompts([
          negativePromptForVideoProject(project),
          promptParts.negativePrompt,
          options.negativePrompt,
        ]),
        metadata: {
          ...baseMetadata,
          ...advancedMetadata,
          images: uniqueUrls([...(baseMetadata.images || []), ...(advancedMetadata.images || [])]),
        },
        rethrow: options.rethrow,
      },
    )
  }

  const createAgentFilmJob = async (templateId) => {
    const plan = agentFilmPlanForProject(project, workspace?.shots ?? [], workspace?.assets ?? [], templateId)
    for (const item of plan.items) {
      await createAdvancedVideoJob(item.shot, item.modeId, {
        ...item.options,
        estimatedCredits: plan.template.estimatedCreditsPerShot,
        rethrow: true,
      })
    }
    setToast(`Agent 整片已提交 ${plan.items.length} 个镜头任务`)
  }

  const retryShotVideoJob = async (shot) => {
    const latestTask = latestVideoTaskForShot(tasks, shot.id)
    if (latestTask && (latestTask.status === 'failed' || latestTask.status === 'cancelled')) {
      await retryJob(latestTask)
      return
    }
    await createShotVideoJob(shot)
  }

  const exportFilmMp4 = async (options = {}) => {
    if (!workspace?.shots.length) return
    const sourceTaskIds = exportTaskIdsForFilm(options, workspace?.shots ?? [], tasks)
    if (sourceTaskIds.length !== (options.timeline?.length || workspace.shots.length)) {
      setToast('请先完成所有镜头视频，再导出 MP4')
      return
    }
    const audioTaskIds = Array.isArray(options.audioTaskIds)
      ? options.audioTaskIds
      : tasks
          .filter((task) => task.kind === 'audio' && task.status === 'completed' && task.outputs?.length)
          .map((task) => task.id)
    await createJob(`${project.name} · 成片 MP4`, '视频', 8, {
      provider: 'film-export',
      model: null,
      prompt: `按${options.exportOptions?.ratio || project.aspectRatio}比例导出《${project.name}》成片 MP4`,
      metadata: {
        exportType: 'film-mp4',
        sourceTaskIds,
        audioTaskIds,
        exportOptions: options.exportOptions || {},
      },
    })
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

  return {
    createJob,
    retryJob,
    rerunJob,
    createShotVideoJob,
    createAdvancedVideoJob,
    createAgentFilmJob,
    retryShotVideoJob,
    exportFilmMp4,
    createProject,
    updateProject,
  }
}

function splitShotPromptForGeneration(prompt) {
  const value = String(prompt || '')
  const marker = '负面约束：'
  const index = value.indexOf(marker)
  if (index === -1) return { prompt: value, negativePrompt: '' }
  return {
    prompt: value
      .slice(0, index)
      .replace(/[，。；;\s]+$/g, '')
      .trim(),
    negativePrompt: value.slice(index + marker.length).trim(),
  }
}

function referencedAssetsForShot(assets, shot) {
  const ids = new Set(shot.assetIds || [])
  return assets.filter((asset) => ids.has(asset.id))
}

function baseVideoMetadataForShot(project, shot, referencedAssets) {
  return {
    shotId: shot.id,
    assetIds: referencedAssets.map((asset) => asset.id),
    referencedAssets: referencedAssets.map(assetSummary),
    duration: shot.duration,
    aspectRatio: project.aspectRatio,
    resolution: '720p',
    generateAudio: false,
    watermark: false,
    images: imageUrlsForShot(shot, referencedAssets),
  }
}

function videoPromptForShot(shot, assets) {
  const basePrompt = shot.prompt || `${shot.title}，${shot.framing}，电影感`
  const context = assets.map(assetPromptLine).filter(Boolean).join('；')
  return context ? `${basePrompt}\n固定引用资产：${context}` : basePrompt
}

function assetPromptLine(asset) {
  const label = assetKindLabels[asset.kind] || asset.kind
  const detail = asset.description || asset.prompt
  return detail ? `${label}「${asset.name}」：${detail}` : `${label}「${asset.name}」`
}

function imageUrlsForShot(shot, assets) {
  const urls = [shot.imageUrl]
  for (const asset of assets) {
    if (asset.kind === 'audio') continue
    urls.push(asset.imageUrl)
    urls.push(...(asset.references || []).map((reference) => reference.url))
  }
  return [...new Set(urls.filter(Boolean))].slice(0, 4)
}

function mergeNegativePrompts(prompts) {
  return prompts
    .flatMap((prompt) => negativeTermsFromPrompt(String(prompt || '')))
    .filter((term, index, terms) => term && terms.indexOf(term) === index)
    .join('；')
}

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))]
}

function assetSummary(asset) {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    description: asset.description,
    imageUrl: asset.imageUrl,
  }
}

function typeLabelForKind(kind) {
  return { text: '文本', image: '图片', video: '视频', audio: '音频' }[kind] || '图片'
}

function cleanTaskMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(([key]) => !transientTaskMetadataKeys.has(key)),
  )
}

function exportTaskIdsForFilm(options, shots, tasks) {
  if (Array.isArray(options.sourceTaskIds) && options.sourceTaskIds.length > 0) return options.sourceTaskIds
  return shots
    .map((shot) => completedVideoTaskForShot(tasks, shot.id))
    .filter(Boolean)
    .map((task) => task.id)
}
