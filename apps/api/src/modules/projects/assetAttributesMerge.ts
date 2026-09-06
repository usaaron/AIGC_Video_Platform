import type { Asset } from '@seqora/contracts'

type CharacterAttributes = Extract<Asset['attributes'], { type: 'character' }>

export function mergeAssetAttributes(
  current: Asset,
  incoming: Asset['attributes'] | undefined,
): Asset['attributes'] {
  if (!incoming || current.attributes.type !== 'character' || incoming.type !== 'character') {
    return incoming ?? current.attributes
  }

  const currentPortrait = current.attributes.trustedPortrait
  const incomingPortrait = incoming.trustedPortrait

  if (!sameMediaReference(current.attributes.faceReference, incoming.faceReference)) {
    // A provider callback can finish after the user has confirmed a different face. Never let
    // that stale callback restore the old portrait or overwrite the newer face confirmation.
    if (incomingPortrait) return preserveCurrentFace(current.attributes, incoming, currentPortrait)

    // A newly confirmed face intentionally clears the old trusted portrait. The binding field
    // lets us distinguish that action from an older editor snapshot with no portrait metadata.
    if (currentPortrait?.faceReferenceId === incoming.faceReference?.id) {
      return preserveCurrentFace(current.attributes, incoming, currentPortrait)
    }
    return incoming
  }

  if (!currentPortrait) return incoming
  if (!incomingPortrait) {
    return {
      ...incoming,
      portraitSource: current.attributes.portraitSource,
      trustedPortrait: currentPortrait,
    }
  }

  const preserveCurrent =
    (currentPortrait.status === 'active' && incomingPortrait.status !== 'active') ||
    Date.parse(currentPortrait.checkedAt) > Date.parse(incomingPortrait.checkedAt)
  if (!preserveCurrent) return incoming
  return {
    ...incoming,
    portraitSource: current.attributes.portraitSource,
    trustedPortrait: currentPortrait,
  }
}

function preserveCurrentFace(
  current: CharacterAttributes,
  incoming: CharacterAttributes,
  currentPortrait: CharacterAttributes['trustedPortrait'],
): CharacterAttributes {
  return {
    ...incoming,
    faceStatus: current.faceStatus,
    faceReference: current.faceReference,
    bodyStatus: current.bodyStatus,
    bodyReference: current.bodyReference,
    portraitSource: current.portraitSource,
    trustedPortrait: currentPortrait,
    activeAppearanceVariantId: current.activeAppearanceVariantId,
  }
}

function sameMediaReference(
  left: { id: string; url: string } | null | undefined,
  right: { id: string; url: string } | null | undefined,
): boolean {
  if (!left && !right) return true
  return Boolean(left && right && left.id === right.id && left.url === right.url)
}
