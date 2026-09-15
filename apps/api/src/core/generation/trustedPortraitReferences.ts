import type { Asset } from '@seqora/contracts'
import { AppError } from '../errors.js'

/** Validate the portrait before charging and again when the worker submits it. */
export function trustedPortraitAliases(assets: Asset[], providerName: string): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const asset of assets) {
    const attributes = asset.attributes
    if (attributes.type !== 'character') continue
    const portrait = attributes.trustedPortrait
    const usesSourceImage = providerName === 'dora-router-seedance'
    if (
      usesSourceImage &&
      (attributes.portraitSource === 'authorized-real' || portrait?.groupType === 'LivenessFace')
    ) {
      throw new AppError(
        409,
        'REAL_PORTRAIT_VIDEO_UNSUPPORTED',
        `人物「${asset.name}」是真人授权素材，当前视频通道尚未接通真人授权资源；请联系管理员配置支持该素材库的视频通道`,
      )
    }
    if (portrait?.status !== 'active') continue
    const assetUri = `asset://${portrait.assetId}`
    let target = assetUri
    if (usesSourceImage) {
      const face = attributes.faceReference
      if (
        portrait.groupType !== 'AIGC' ||
        attributes.portraitSource !== 'ai-virtual' ||
        attributes.faceStatus !== 'approved' ||
        !face?.url ||
        (portrait.faceReferenceId && portrait.faceReferenceId !== face.id)
      ) {
        throw new AppError(
          409,
          'AI_PORTRAIT_SOURCE_REQUIRED',
          `人物「${asset.name}」缺少与已入库 AI 人像对应的面部原图，请重新确认面部并完成 AI 入库`,
        )
      }
      // A material ID belongs to its library. DoraRouter accepts image bytes/URLs only.
      target = face.url
    }
    for (const value of [
      assetUri,
      asset.imageUrl,
      attributes.faceReference?.url,
      attributes.bodyReference?.url,
    ]) {
      if (value) aliases.set(value, target)
    }
  }
  return aliases
}
