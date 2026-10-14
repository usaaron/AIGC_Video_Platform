import { selectCharacterShotAppearance, characterVariantName, type Asset, type Shot } from '@seqora/contracts'
import {
  bindVideoAssetReferences,
  orderedVideoReferenceImages,
  shotReferenceImages,
  validateShotReferences,
} from '@seqora/prompting'
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
    const selected = selectCharacterShotAppearance(
      asset,
      shot,
      assets.filter((item) => item.kind === 'character').map((item) => item.name),
    )
    const variant = selected?.variant
    return {
      id,
      url: selected ? selected.videoUrl : asset.imageUrl,
      appearanceUrl: selected?.appearanceUrl,
      role: selected?.role || '外观',
      appearanceRole: selected?.appearanceRole,
      view: selected?.view,
      ...(variant
        ? {
            appearance: {
              name: characterVariantName(asset.name, variant.name),
              description: [variant.description, variant.prompt]
                .filter((value): value is string => Boolean(value?.trim()))
                .join('\n'),
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
  return {
    manualReferenceImages,
    images,
    references: bindVideoAssetReferences(references, images, continuity),
  }
}
