import { describe, expect, it } from 'vitest'
import {
  createAssetSchema,
  createShotSchema,
  enrichScriptRequestSchema,
  generateScriptAssetSuggestionsRequestSchema,
  generateScriptRequestSchema,
  generateShotsRequestSchema,
  scriptAssetSuggestionsResultSchema,
  scriptReviewResultSchema,
  updateAssetSchema,
  updateShotSchema,
} from './project.js'

const character = {
  type: 'character' as const,
  subjectType: 'human' as const,
  gender: 'female' as const,
  ageGroup: 'young' as const,
  exactAge: null,
  species: '',
  anthropomorphic: false,
  visualStyle: 'cinematic-cg' as const,
  framing: 'full' as const,
  bodyType: 'balanced' as const,
  background: 'solid' as const,
  faceStatus: 'pending' as const,
  bodyStatus: 'pending' as const,
  faceReference: null,
  bodyReference: null,
  legStretch: false,
  turnaround: false,
  turnaroundLayout: 'sheet' as const,
}

const reference = (index: number) => ({ id: `media-${index}`, url: `/media/${index}`, name: `${index}.png` })

describe('asset contracts', () => {
  it('accepts at most three imported reference images', () => {
    const input = {
      kind: 'character',
      sourceMode: 'import',
      name: '林夏',
      attributes: character,
      references: [reference(1), reference(2), reference(3)],
    }

    const parsed = createAssetSchema.parse(input)
    expect(parsed.attributes).toMatchObject({
      portraitSource: 'ai-virtual',
      trustedPortrait: null,
    })
    expect(
      createAssetSchema.safeParse({ ...input, references: [...input.references, reference(4)] }).success,
    ).toBe(false)
  })

  it('rejects attributes belonging to another asset type', () => {
    expect(
      createAssetSchema.safeParse({
        kind: 'scene',
        sourceMode: 'generate',
        name: '车站',
        attributes: character,
      }).success,
    ).toBe(false)
  })

  it('does not inject create defaults into partial asset updates', () => {
    expect(updateAssetSchema.parse({ status: 'confirmed' })).toEqual({ status: 'confirmed' })
    expect(updateAssetSchema.safeParse({}).success).toBe(false)
  })
})

describe('shot contracts', () => {
  it('stores a bounded continuity context and defaults it for older clients', () => {
    expect(createShotSchema.parse({ title: '镜头 01' }).continuityNote).toBe('')
    expect(updateShotSchema.parse({ continuityNote: '上一场人物停在门口，本场从推门动作继续。' })).toEqual({
      continuityNote: '上一场人物停在门口，本场从推门动作继续。',
    })
  })

  it('does not inject create defaults into partial shot updates', () => {
    expect(updateShotSchema.parse({ prompt: '更稳定的运镜' })).toEqual({ prompt: '更稳定的运镜' })
    expect(updateShotSchema.safeParse({}).success).toBe(false)
  })
})

describe('script workflow contracts', () => {
  it('applies safe defaults to script generation and shot splitting requests', () => {
    expect(generateScriptRequestSchema.parse({ draft: '雨夜车站' }).direction).toMatchObject({
      style: 'auto',
      composition: 'auto',
      lighting: 'auto',
      camera: 'auto',
      focus: 'balanced',
    })
    expect(enrichScriptRequestSchema.parse({ script: '场次：1｜剧情：找到胶片' }).direction).toMatchObject({
      style: 'auto',
      composition: 'auto',
      lighting: 'auto',
      camera: 'auto',
      focus: 'balanced',
    })
    expect(
      generateScriptAssetSuggestionsRequestSchema.parse({ script: 'scene: river crossing' }),
    ).toMatchObject({
      script: 'scene: river crossing',
      direction: expect.objectContaining({ style: 'auto' }),
    })
    expect(generateShotsRequestSchema.parse({})).toMatchObject({ maxShots: 8, mode: 'scene' })
    expect(generateShotsRequestSchema.parse({ mode: 'beat', maxShots: 36 })).toMatchObject({
      maxShots: 36,
      mode: 'beat',
    })
  })

  it('validates structured professional review results', () => {
    const dimensions = ['plot', 'character', 'dialogue', 'style', 'composition', 'lighting', 'camera'].map(
      (key) => ({ key, score: 80, finding: '问题明确', suggestion: '给出可执行修改' }),
    )
    expect(
      scriptReviewResultSchema.safeParse({
        score: 80,
        verdict: '具备制作基础',
        dimensions,
        priorityActions: ['补足角色目标'],
        generatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })

  it('validates generated asset suggestions from a script', () => {
    expect(
      scriptAssetSuggestionsResultSchema.safeParse({
        summary: '建议先建立核心角色、复用场景和关键道具。',
        assets: [
          {
            kind: 'character',
            name: '翠翠',
            description: '十三岁的湘西少女，老船夫抚养长大。',
            prompt: '十三岁湘西少女，朴素衣着，清澈眼神，青山绿水间长大。',
            negativePrompt: '',
            reason: '主角需要跨镜头保持一致。',
            priority: 5,
            attributes: {
              ...character,
              ageGroup: 'teen',
              exactAge: 13,
            },
          },
        ],
        generatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })
})
