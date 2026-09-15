import type { Asset, GenerationTask } from '@seqora/contracts'

/** Store each outfit against its queued identity snapshot, without switching the selected outfit. */
export function writeCharacterAppearance(asset: Asset, task: GenerationTask): boolean {
  if (asset.attributes.type !== 'character') return true
  const snapshot = task.metadata.attributes as Record<string, unknown> | undefined
  const variantId = snapshot?.activeAppearanceVariantId
  const stage = task.metadata.generationStage
  if (typeof variantId !== 'string' || !['body', 'turnaround'].includes(String(stage))) return true
  const face = snapshot?.faceReference as { id?: string } | undefined
  if (face?.id !== asset.attributes.faceReference?.id) return false
  const variant = asset.attributes.appearanceVariants.find((item) => item.id === variantId)
  if (!variant) return false
  const references = task.outputs
    .filter((item) => item.mediaType === 'image')
    .map((item) => ({ id: item.id, url: item.url, name: variant.name }))
  if (stage === 'body' && references[0]) variant.bodyReference = references[0]
  if (stage === 'turnaround') variant.turnaroundReferences = references.slice(0, 3)
  variant.updatedAt = task.updatedAt
  return variantId === asset.attributes.activeAppearanceVariantId
}
