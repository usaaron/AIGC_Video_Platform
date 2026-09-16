import { characterAppearance, characterVariantName, type Asset, type Shot } from '@seqora/contracts'
import { orderedVideoReferenceImages, shotReferenceImages, validateShotReferences } from '@seqora/prompting'
import { AppError } from '../../core/errors.js'

/** Rebuild image order from saved shot/assets, never from a stale or modified client image list. */
export function storyboardReferences(shot: Shot, assets: Asset[], ids: string[], continuity: boolean) {
  const manualReferenceImages = shotReferenceImages(shot)
  try {
    validateShotReferences(shot.prompt, manualReferenceImages.length, continuity)
  } catch (error) {
    throw new AppError(400, 'INVALID_SHOT_REFERENCES', (error as Error).message)
  }
  const references = [...new Set(ids)].map((id) => {
    const asset = assets.find((item) => item.id === id)
    if (!asset)
      throw new AppError(400, 'REFERENCE_ASSET_NOT_FOUND', '引用的项目资产不存在，请刷新分镜后重试。')
    const attributes = asset.attributes
    const variant = characterAppearance(asset, `${shot.title}\n${shot.prompt}`)
    const portrait = attributes.type === 'character' ? attributes.trustedPortrait : null
    const imageUrl =
      attributes.type === 'character'
        ? variant
          ? variant.bodyReference?.url || attributes.faceReference?.url
          : attributes.bodyReference?.url || attributes.faceReference?.url || asset.imageUrl
        : asset.imageUrl
    return {
      id,
      url: portrait?.status === 'active' ? `asset://${portrait.assetId}` : imageUrl,
      appearanceUrl: variant?.bodyReference?.url,
      ...(variant
        ? {
            appearance: {
              name: characterVariantName(asset.name, variant.name),
              description: variant.description || '',
            },
          }
        : {}),
    }
  })
  const images = orderedVideoReferenceImages(
    manualReferenceImages.map((image) => image.url),
    [...references.map((item) => item.url), ...references.map((item) => item.appearanceUrl)],
    continuity ? 8 : 9,
  )
  return { manualReferenceImages, images, references }
}
