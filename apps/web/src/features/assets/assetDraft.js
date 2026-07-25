import { compileAssetPrompt } from './promptCompiler'

export const ASSET_CREATION_MODES = {
  DIRECT: 'direct',
  REFERENCE: 'reference',
  TEXT: 'text',
}

export function inferAssetCreationMode(asset) {
  if (asset.sourceMode === 'import') return ASSET_CREATION_MODES.DIRECT
  if (asset.references?.length) return ASSET_CREATION_MODES.REFERENCE
  return ASSET_CREATION_MODES.TEXT
}

export function applyAssetCreationMode(draft, mode) {
  if (mode === ASSET_CREATION_MODES.DIRECT) {
    return {
      ...draft,
      sourceMode: 'import',
      promptMode: 'standard',
      customPromptMode: 'append',
      customPrompt: '',
      negativePrompt: '',
      references: draft.references.slice(0, 1),
    }
  }
  if (mode === ASSET_CREATION_MODES.TEXT) {
    return { ...draft, sourceMode: 'generate', references: [], imageUrl: null }
  }
  return { ...draft, sourceMode: 'generate' }
}

export function confirmCharacterFace(attributes, candidate, assetName) {
  const faceReference = {
    id: candidate.id,
    url: candidate.url,
    name: `${assetName || '人物'}-面部基准`,
  }
  const faceChanged =
    attributes.faceReference?.id !== faceReference.id || attributes.faceReference?.url !== faceReference.url
  return {
    ...attributes,
    faceStatus: 'approved',
    faceReference,
    bodyStatus: 'pending',
    bodyReference: null,
    ...(faceChanged ? { portraitSource: 'ai-virtual', trustedPortrait: null } : {}),
  }
}

export function buildAssetInput({ asset, draft, kind, aspectRatio, creationMode }) {
  const direct = creationMode === ASSET_CREATION_MODES.DIRECT
  const references = creationMode === ASSET_CREATION_MODES.TEXT ? [] : draft.references
  const normalized = {
    ...draft,
    sourceMode: direct ? 'import' : 'generate',
    references,
    ...(direct
      ? {
          promptMode: 'standard',
          customPromptMode: 'append',
          customPrompt: '',
          negativePrompt: '',
        }
      : {}),
  }
  const input = {
    ...(asset.id ? {} : { kind }),
    ...normalized,
    prompt: direct ? '' : compileAssetPrompt(normalized, aspectRatio),
    imageUrl:
      kind === 'audio'
        ? null
        : direct
          ? references[0]?.url || null
          : normalized.attributes.bodyReference?.url ||
            normalized.imageUrl ||
            normalized.attributes.faceReference?.url ||
            references[0]?.url ||
            null,
  }
  if (asset.id) {
    input.status = direct ? 'confirmed' : asset.sourceMode === 'import' ? 'draft' : asset.status
  }
  return input
}
