import { describe, expect, it } from 'vitest'
import { createDefaultAttributes } from './assetOptions'
import {
  applyAssetCreationMode,
  ASSET_CREATION_MODES,
  buildAssetInput,
  confirmCharacterFace,
  inferAssetCreationMode,
} from './assetDraft'

const reference = { id: 'media-1', url: '/api/v1/media/media-1', name: 'hero.png' }
const sceneReferences = [
  reference,
  { id: 'media-2', url: '/api/v1/media/media-2', name: 'scene-side.png' },
  { id: 'media-3', url: '/api/v1/media/media-3', name: 'scene-detail.png' },
]

function draft(overrides = {}) {
  return {
    sourceMode: 'generate',
    name: '林夏',
    description: '青年引路者',
    promptMode: 'advanced',
    customPromptMode: 'append',
    customPrompt: '银色短发',
    negativePrompt: '文字水印',
    references: [reference],
    imageUrl: null,
    attributes: createDefaultAttributes('character'),
    ...overrides,
  }
}

describe('asset creation modes', () => {
  it('stores a direct upload without generation prompts', () => {
    const input = buildAssetInput({
      asset: { kind: 'character' },
      draft: applyAssetCreationMode(draft(), ASSET_CREATION_MODES.DIRECT),
      kind: 'character',
      aspectRatio: '9:16',
      creationMode: ASSET_CREATION_MODES.DIRECT,
    })

    expect(input).toMatchObject({
      sourceMode: 'import',
      prompt: '',
      customPrompt: '',
      negativePrompt: '',
      imageUrl: reference.url,
      references: [reference],
    })
  })

  it('keeps up to three direct references for scenes', () => {
    const sceneDraft = {
      ...draft({ references: sceneReferences }),
      attributes: createDefaultAttributes('scene'),
    }
    const next = applyAssetCreationMode(sceneDraft, ASSET_CREATION_MODES.DIRECT, 'scene')
    expect(next.references).toHaveLength(3)
  })

  it('keeps references and prompt constraints for reference generation', () => {
    const input = buildAssetInput({
      asset: { kind: 'character' },
      draft: applyAssetCreationMode(draft(), ASSET_CREATION_MODES.REFERENCE),
      kind: 'character',
      aspectRatio: '9:16',
      creationMode: ASSET_CREATION_MODES.REFERENCE,
    })

    expect(input.sourceMode).toBe('generate')
    expect(input.references).toEqual([reference])
    expect(input.prompt).toContain('严格保持导入参考图')
    expect(input.prompt).toContain('银色短发')
  })

  it('stores the face-stage prompt instead of a stale full-body override', () => {
    const attributes = createDefaultAttributes('character')
    attributes.stagePrompts = {
      face: '面部阶段完整提示词，画面比例1:1',
      body: '全身阶段完整提示词，画面比例9:16',
      turnaround: '',
    }
    const input = buildAssetInput({
      asset: { kind: 'character' },
      draft: draft({ attributes, customPromptMode: 'replace', customPrompt: '旧全身提示词' }),
      kind: 'character',
      aspectRatio: '9:16',
      creationMode: ASSET_CREATION_MODES.TEXT,
    })

    expect(input.prompt).toBe('面部阶段完整提示词，画面比例1:1')
    expect(input.prompt).not.toContain('旧全身提示词')
  })

  it('drops old references when switching to text-only generation', () => {
    const next = applyAssetCreationMode(draft({ imageUrl: reference.url }), ASSET_CREATION_MODES.TEXT)
    expect(next).toMatchObject({ sourceMode: 'generate', references: [], imageUrl: null })
    expect(inferAssetCreationMode(next)).toBe(ASSET_CREATION_MODES.TEXT)
  })

  it('uses the selected direct upload instead of an older approved face image', () => {
    const attributes = {
      ...createDefaultAttributes('character'),
      faceStatus: 'approved',
      faceReference: { id: 'old-face', url: '/media/old-face', name: 'old-face.png' },
    }
    const input = buildAssetInput({
      asset: { id: 'character-1', kind: 'character', sourceMode: 'generate', status: 'draft' },
      draft: applyAssetCreationMode(draft({ attributes }), ASSET_CREATION_MODES.DIRECT),
      kind: 'character',
      aspectRatio: '9:16',
      creationMode: ASSET_CREATION_MODES.DIRECT,
    })

    expect(input.imageUrl).toBe(reference.url)
  })

  it('keeps the approved full-body reference as the character cover image', () => {
    const attributes = {
      ...createDefaultAttributes('character'),
      faceStatus: 'approved',
      bodyStatus: 'approved',
      faceReference: { id: 'face-1', url: '/media/face-1', name: 'face.png' },
      bodyReference: { id: 'body-1', url: '/media/body-1', name: 'body.png' },
    }
    const input = buildAssetInput({
      asset: { id: 'character-1', kind: 'character', sourceMode: 'generate', status: 'draft' },
      draft: draft({ attributes, imageUrl: '/media/face-1' }),
      kind: 'character',
      aspectRatio: '9:16',
      creationMode: ASSET_CREATION_MODES.TEXT,
    })

    expect(input.imageUrl).toBe('/media/body-1')
  })

  it('clears an old trusted portrait only when the approved face changes', () => {
    const attributes = {
      ...createDefaultAttributes('character'),
      faceStatus: 'approved',
      faceReference: reference,
      trustedPortrait: { assetId: 'trusted-1', status: 'active' },
    }

    expect(confirmCharacterFace(attributes, reference, 'Hero').trustedPortrait).toBe(
      attributes.trustedPortrait,
    )
    expect(
      confirmCharacterFace(
        attributes,
        { id: 'media-2', url: '/api/v1/media/media-2', name: 'new-face.png' },
        'Hero',
      ).trustedPortrait,
    ).toBeNull()
  })
})
