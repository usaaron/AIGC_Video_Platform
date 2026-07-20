import type { Asset, GenerationTask } from '@seqora/contracts'
import type { AppState, StoredMedia } from '../../infra/store.js'

type ImageOutput = GenerationTask['outputs'][number]
type CharacterGenerationStage = 'face' | 'body' | 'turnaround'

export function completeTaskWithOutputs(
  state: AppState,
  task: GenerationTask,
  outputs: GenerationTask['outputs'],
  now: string,
): void {
  task.status = 'completed'
  task.progress = 100
  task.outputs = outputs
  task.resultUrl = outputs[0]?.url ?? null
  task.error = null
  task.updatedAt = now

  if (task.kind === 'image') writeImageOutputsToAsset(state, task, outputs, now)
  if (task.kind === 'audio') writeAudioOutputsToAsset(state, task, outputs, now)
}

export function addGeneratedMedia(state: AppState, media: StoredMedia[]): void {
  for (const item of media) {
    if (!state.media.some((stored) => stored.id === item.id)) state.media.unshift(item)
  }
}

function writeImageOutputsToAsset(
  state: AppState,
  task: GenerationTask,
  outputs: GenerationTask['outputs'],
  now: string,
): void {
  const assetId = stringValue(task.metadata.assetId, '')
  const imageOutputs = outputs.filter((output) => output.mediaType === 'image' && output.url)
  if (!assetId || imageOutputs.length === 0) return

  const asset = state.assets.find(
    (item) => item.id === assetId && item.projectId === task.projectId && item.tenantId === task.tenantId,
  )
  if (!asset) return

  const stage = characterGenerationStageFor(task.metadata.generationStage, task.metadata.turnaround)
  const primaryOutput = primaryImageOutputFor(stage, imageOutputs)
  asset.imageUrl = primaryOutput.url
  asset.status = 'confirmed'
  asset.updatedAt = now

  if (asset.kind !== 'character' || asset.attributes.type !== 'character' || !stage) return

  if (stage === 'face') {
    asset.attributes.faceStatus = 'approved'
    asset.attributes.faceReference = mediaReferenceForOutput(asset, primaryOutput, 'face')
    asset.attributes.bodyStatus = 'pending'
    asset.attributes.bodyReference = null
    asset.attributes.turnaround = false
    asset.attributes.turnaroundReferences = []
  }
  if (stage === 'body') {
    asset.attributes.bodyStatus = 'approved'
    asset.attributes.bodyReference = mediaReferenceForOutput(asset, primaryOutput, 'body')
    asset.attributes.turnaround = false
    asset.attributes.turnaroundReferences = []
  }
  if (stage === 'turnaround') {
    asset.attributes.turnaround = true
    asset.attributes.turnaroundReferences = mergeTurnaroundOutputs(
      asset.attributes.turnaroundReferences,
      imageOutputs,
    )
  }
}

function writeAudioOutputsToAsset(
  state: AppState,
  task: GenerationTask,
  outputs: GenerationTask['outputs'],
  now: string,
): void {
  const assetId = stringValue(task.metadata.assetId, '')
  const audioOutputs = outputs.filter((output) => output.mediaType === 'audio' && output.url)
  if (!assetId || audioOutputs.length === 0) return

  const asset = state.assets.find(
    (item) =>
      item.id === assetId &&
      item.projectId === task.projectId &&
      item.tenantId === task.tenantId &&
      item.kind === 'audio',
  )
  if (!asset) return

  asset.references = audioOutputs.slice(0, 3).map((output) => ({
    id: output.id,
    url: output.url,
    name: `${asset.name}-audio`,
  }))
  asset.status = 'confirmed'
  asset.updatedAt = now
}

function primaryImageOutputFor(
  stage: CharacterGenerationStage | null,
  outputs: GenerationTask['outputs'],
): ImageOutput {
  if (stage === 'turnaround') return outputs.find((output) => output.view === 'front') ?? outputs[0]!
  return outputs.find((output) => output.view === 'single') ?? outputs[0]!
}

function mediaReferenceForOutput(
  asset: Asset,
  output: ImageOutput,
  stage: CharacterGenerationStage,
): Asset['references'][number] {
  return {
    id: output.id,
    url: output.url,
    name: `${asset.name}-${stage}`,
  }
}

function mergeTurnaroundOutputs(
  currentOutputs: GenerationTask['outputs'],
  nextOutputs: GenerationTask['outputs'],
): GenerationTask['outputs'] {
  const orderedViews = ['front', 'side', 'back'] as const
  return orderedViews
    .map(
      (view) =>
        nextOutputs.find((output) => output.view === view) ??
        currentOutputs.find((output) => output.view === view),
    )
    .filter((output): output is ImageOutput => Boolean(output))
    .slice(0, 3)
}

function characterGenerationStageFor(value: unknown, turnaround: unknown): CharacterGenerationStage | null {
  if (value === 'face' || value === 'body' || value === 'turnaround') return value
  return turnaround === true ? 'turnaround' : null
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}
