import { completedShotVideoTask, sourceVideoTaskIds, isCurrentFilmPreview } from '../film/filmPreview'

export const WORKFLOW_STEPS = [
  { id: 'overview', label: '项目概览', shortLabel: '概览', detail: '查看项目与制作进度' },
  { id: 'script', label: '剧本', shortLabel: '剧本', detail: '确定故事与每集内容' },
  { id: 'assets', label: '资产设计', shortLabel: '资产', detail: '确认人物、场景与造型' },
  { id: 'storyboard', label: '分镜', shortLabel: '分镜', detail: '检查每个镜头的画面' },
  { id: 'generate', label: '生成队列', shortLabel: '生成', detail: '查看后台制作状态' },
  { id: 'film', label: '成片', shortLabel: '成片', detail: '预览与下载你的作品' },
]

export function getWorkflowGuide({ project, assets = [], shots = [], tasks = [] }) {
  const hasScript = Boolean(project?.script?.trim())
  const visualAssets = assets.filter((asset) => asset.kind !== 'audio')
  const confirmedAssets = visualAssets.filter((asset) => asset.status === 'confirmed')
  const completedShots = shots.filter((shot) => completedShotVideoTask(tasks, shot)).length
  const sourceIds = sourceVideoTaskIds(tasks, shots)
  const currentPreview = tasks.find(
    (task) =>
      task.metadata?.generationStage === 'film-preview' &&
      task.status === 'completed' &&
      isCurrentFilmPreview(task, sourceIds),
  )
  const activeTasks = tasks.filter((task) => ['queued', 'running', 'paused'].includes(task.status))
  const taskTarget = (task) =>
    [
      task.kind,
      task.metadata?.shotId || task.metadata?.assetId || task.metadata?.textAction || task.title,
      task.metadata?.generationStage,
    ].join(':')
  const latestByTarget = new Map()
  for (const task of tasks) {
    const key = taskTarget(task)
    const previous = latestByTarget.get(key)
    if (!previous || String(task.createdAt || '') > String(previous.createdAt || ''))
      latestByTarget.set(key, task)
  }
  const failedTasks = [...latestByTarget.values()].filter(
    (task) => task.status === 'failed' && !task.metadata?.queueHiddenAt,
  )
  const ready = {
    overview: Boolean(project),
    script: hasScript,
    assets: visualAssets.length > 0 && confirmedAssets.length === visualAssets.length,
    storyboard: shots.length > 0,
    generate: shots.length > 0 && completedShots === shots.length,
    film: Boolean(currentPreview),
  }

  if (failedTasks.length)
    return {
      ready,
      step: 'generate',
      title: '有任务需要处理',
      detail: `${failedTasks.length} 项任务未完成，可查看原因后重试。`,
      action: '查看任务',
      tone: 'warning',
    }
  if (activeTasks.length)
    return {
      ready,
      step: 'generate',
      title: '作品正在制作中',
      detail: `${activeTasks.length} 项任务在队列中，结果会自动保存。`,
      action: '查看进度',
      tone: 'working',
    }
  if (ready.generate)
    return {
      ready,
      step: 'film',
      title: ready.film ? '你的作品已就绪' : '最后一步，连成完整故事',
      detail: ready.film ? '打开成片，检查效果并下载。' : '镜头视频已完成，可以合成与预览。',
      action: '查看成片',
      tone: 'complete',
    }
  if (!hasScript)
    return {
      ready,
      step: 'script',
      title: '先确定你的故事',
      detail: '写下人物、冲突或几个想法，开始第一集。',
      action: '开始写剧本',
      tone: 'default',
    }
  if (!ready.assets)
    return {
      ready,
      step: 'assets',
      title: '让故事中的人物与场景成形',
      detail: visualAssets.length
        ? `${confirmedAssets.length} / ${visualAssets.length} 项视觉资产已确认。`
        : '从剧本提取核心资产，再确认角色形象。',
      action: '准备资产',
      tone: 'default',
    }
  if (!shots.length)
    return {
      ready,
      step: 'storyboard',
      title: '把故事变成镜头',
      detail: '资产已就绪，接下来安排画面、对白与镜头节奏。',
      action: '制作分镜',
      tone: 'default',
    }
  return {
    ready,
    step: 'storyboard',
    title: '镜头准备好后，即可开始制作',
    detail: `${shots.length} 个镜头，${completedShots} 个已有视频。`,
    action: '检查并生成',
    tone: 'default',
  }
}
