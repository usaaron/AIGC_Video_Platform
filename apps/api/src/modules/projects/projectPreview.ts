import type { Asset, GenerationTask, ProjectGenerationSummary, Shot } from '@seqora/contracts'

export type ProjectPreviewTask = Pick<
  GenerationTask,
  'id' | 'projectId' | 'label' | 'kind' | 'status' | 'progress' | 'metadata' | 'outputs' | 'updatedAt'
>

export type ProjectPreviewAsset = Pick<
  Asset,
  'projectId' | 'kind' | 'references' | 'attributes' | 'imageUrl' | 'updatedAt'
>

export type ProjectPreviewShot = Pick<Shot, 'projectId' | 'order' | 'imageUrl'>

export type ProjectPreviewState = {
  tasks: ProjectPreviewTask[]
  assets: ProjectPreviewAsset[]
  shots: ProjectPreviewShot[]
}

export function projectPreviewUrl(projectId: string, state: ProjectPreviewState): string | null {
  const completedVideoFrame = state.tasks
    .filter((task) => task.projectId === projectId && task.kind === 'video' && task.status === 'completed')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap((task) => task.outputs)
    .find((output) => output.mediaType === 'image' && output.view === 'last-frame')
  if (completedVideoFrame?.url) return completedVideoFrame.url

  const storyboardImage = state.tasks
    .filter((task) => task.projectId === projectId && task.kind === 'image' && task.status === 'completed')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap((task) => task.outputs)
    .find((output) => output.mediaType === 'image' && output.view === 'single')
  if (storyboardImage?.url) return storyboardImage.url

  const shotImage = state.shots
    .filter((shot) => shot.projectId === projectId && shot.imageUrl)
    .sort((left, right) => left.order - right.order)
    .find((shot) => shot.imageUrl)?.imageUrl
  if (shotImage) return shotImage

  const asset = state.assets
    .filter((item) => item.projectId === projectId && item.kind !== 'audio')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((item) => assetPreviewUrl(item))
  return asset ? assetPreviewUrl(asset) : null
}

export function projectGenerationSummary(
  projectId: string,
  state: Pick<ProjectPreviewState, 'tasks'>,
): ProjectGenerationSummary {
  const relevantStatuses = new Set(['queued', 'paused', 'running', 'failed'])
  const tasks = state.tasks
    .filter(
      (task) =>
        task.projectId === projectId &&
        relevantStatuses.has(task.status) &&
        typeof task.metadata?.queueHiddenAt !== 'string',
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return {
    queued: tasks.filter((task) => task.status === 'queued').length,
    paused: tasks.filter((task) => task.status === 'paused').length,
    running: tasks.filter((task) => task.status === 'running').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    latest: tasks.slice(0, 3).map((task) => ({
      id: task.id,
      label: task.label,
      kind: task.kind,
      status: task.status as 'queued' | 'paused' | 'running' | 'failed',
      progress: task.progress,
      updatedAt: task.updatedAt,
    })),
  }
}

function assetPreviewUrl(asset: ProjectPreviewAsset): string | null {
  if (asset.imageUrl) return asset.imageUrl
  const attributes = asset.attributes as Record<string, unknown>
  const faceReference = attributes.faceReference as { url?: unknown } | null | undefined
  if (typeof faceReference?.url === 'string') return faceReference.url
  return asset.references?.[0]?.url ?? null
}
