import type { Asset, FaceConfirmationRequest, TrustedPortrait, UpdateAsset } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import { mergeAssetAttributes, sameMediaReference } from './assetAttributesMerge.js'

export type PortraitWriteIntent = 'callback' | 'bind'

export function confirmedFaceUpdate(
  asset: Asset,
  face: FaceConfirmationRequest['faceReference'],
): UpdateAsset {
  if (asset.kind !== 'character' || asset.attributes.type !== 'character') {
    throw new AppError(400, 'CHARACTER_ASSET_REQUIRED', '只有人物资产可以确认面部基准')
  }
  const current = asset.attributes
  const changed = !sameMediaReference(current.faceReference, face)
  return {
    attributes: {
      ...current,
      faceStatus: 'approved',
      faceReference: { ...face, name: `${asset.name}-面部基准` },
      portraitSource:
        current.trustedPortrait?.groupType === 'LivenessFace' ? 'authorized-real' : current.portraitSource,
      ...(changed
        ? {
            bodyStatus: 'pending',
            bodyReference: null,
            trustedPortrait: null,
            activeAppearanceVariantId: null,
          }
        : {}),
    },
  }
}

export function trustedPortraitUpdate(
  current: Asset,
  observed: Asset,
  portrait: TrustedPortrait,
  source: 'ai-virtual' | 'authorized-real',
  intent: PortraitWriteIntent = 'callback',
): UpdateAsset {
  if (
    current.attributes.type !== 'character' ||
    observed.attributes.type !== 'character' ||
    !sameMediaReference(current.attributes.faceReference, observed.attributes.faceReference) ||
    current.attributes.faceStatus !== observed.attributes.faceStatus ||
    current.sourceMode !== observed.sourceMode ||
    current.attributes.subjectType !== observed.attributes.subjectType ||
    current.attributes.portraitSource !== observed.attributes.portraitSource
  ) {
    throw new AppError(409, 'FACE_CONFIRMATION_CHANGED', '面部或人物来源已更换，本次旧资源不会覆盖当前确认')
  }
  const binding = current.attributes.trustedPortrait
  const original = observed.attributes.trustedPortrait
  if (
    binding?.assetId !== original?.assetId ||
    binding?.groupId !== original?.groupId ||
    binding?.groupType !== original?.groupType
  ) {
    throw new AppError(409, 'PORTRAIT_BINDING_CHANGED', '人像资源绑定已更换，本次旧资源结果不会覆盖当前绑定')
  }
  const attributes = { ...current.attributes, portraitSource: source, trustedPortrait: portrait }
  // Explicit selection can replace an active resource with a different processing resource.
  // Background callbacks retain the existing status/timestamp merge protection.
  return { attributes: intent === 'bind' ? attributes : mergeAssetAttributes(current, attributes) }
}
