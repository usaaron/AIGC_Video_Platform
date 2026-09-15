import type { GenerationTask } from '@seqora/contracts'
import { compileQualityRules, type QualityRuleInput } from '@seqora/prompting'
import type { AppState } from '../../infra/store.js'

/** Compile against the task snapshot, filling missing asset data only within its project and tenant. */
export function compileImageTaskPrompt(task: GenerationTask, state: Pick<AppState, 'projects' | 'assets'>) {
  const project = state.projects.find((item) => item.id === task.projectId && item.tenantId === task.tenantId)
  const asset = state.assets.find(
    (item) =>
      item.id === task.metadata.assetId &&
      item.projectId === task.projectId &&
      item.tenantId === task.tenantId,
  )
  const snapshot = task.metadata.attributes
  const attributes: Record<string, unknown> = {
    ...asset?.attributes,
    ...(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {}),
  }
  const assetKind = imageAssetKind(task.metadata.assetKind ?? attributes.type ?? asset?.kind)
  const userNegativePrompt =
    typeof task.metadata.userNegativePrompt === 'string'
      ? task.metadata.userNegativePrompt
      : task.negativePrompt
  const quality = compileQualityRules({
    mediaKind: 'image',
    assetKind,
    subjectType: attributes.subjectType === 'animal' ? 'animal' : 'human',
    visualStyles: typeof attributes.visualStyle === 'string' ? [attributes.visualStyle] : [],
    emptyScene: attributes.emptyScene === true,
    sourcePrompt: task.prompt,
    customNegativePrompt: userNegativePrompt,
    ...(project ? { contentType: project.contentType } : {}),
    ...(typeof attributes.weather === 'string' ? { weather: attributes.weather } : {}),
  })
  return { attributes, assetKind, quality, userNegativePrompt }
}

function imageAssetKind(value: unknown): NonNullable<QualityRuleInput['assetKind']> {
  if (
    value === 'character' ||
    value === 'scene' ||
    value === 'prop' ||
    value === 'costume' ||
    value === 'brand'
  ) {
    return value
  }
  return 'storyboard'
}
