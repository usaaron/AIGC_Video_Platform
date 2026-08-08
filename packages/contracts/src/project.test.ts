import { describe, expect, it } from 'vitest'
import {
  autoSplitShotsRequestSchema,
  createAssetSchema,
  createShotSchema,
  costumeAttributesSchema,
  enrichScriptRequestSchema,
  generateScriptAssetSuggestionsRequestSchema,
  generateScriptRequestSchema,
  generateShotsRequestSchema,
  scriptAssetSuggestionsResultSchema,
  reviewScriptRequestSchema,
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
      name: 'Lin Xia',
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
        name: 'Station',
        attributes: character,
      }).success,
    ).toBe(false)
  })

  it('does not inject create defaults into partial asset updates', () => {
    expect(updateAssetSchema.parse({ status: 'confirmed' })).toEqual({ status: 'confirmed' })
    expect(updateAssetSchema.safeParse({}).success).toBe(false)
  })

  it('keeps old costume assets compatible and validates an optional character binding', () => {
    const costume = {
      type: 'costume',
      audience: 'male',
      category: 'ancient',
      season: 'all-season',
      design: 'chinese',
      presentation: 'flat',
      visualStyle: 'cinematic-cg',
      turnaround: false,
    }

    expect(costumeAttributesSchema.parse(costume).characterAssetId).toBeNull()
    expect(
      costumeAttributesSchema.parse({
        ...costume,
        characterAssetId: '123e4567-e89b-42d3-a456-426614174000',
      }).characterAssetId,
    ).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(costumeAttributesSchema.safeParse({ ...costume, characterAssetId: '侠客' }).success).toBe(false)
  })
})

describe('shot contracts', () => {
  it('stores a bounded continuity context and defaults it for older clients', () => {
    expect(createShotSchema.parse({ title: 'Shot 01' })).toMatchObject({
      continuityMode: 'continue',
      continuityNote: '',
      episodeBreakBefore: false,
      episodeNumber: 1,
      episodeTitle: '主故事',
      episodeKind: 'standard',
    })
    expect(updateShotSchema.parse({ continuityNote: 'previous action continues' })).toEqual({
      continuityNote: 'previous action continues',
    })
    expect(createShotSchema.parse({ title: 'Inserted shot', insertAfterShotId: 'shot-2' })).toMatchObject({
      insertAfterShotId: 'shot-2',
    })
    expect(createShotSchema.parse({ title: 'Opening shot', insertAfterShotId: null })).toMatchObject({
      insertAfterShotId: null,
    })
  })

  it('does not inject create defaults into partial shot updates', () => {
    expect(updateShotSchema.parse({ prompt: 'steady camera' })).toEqual({ prompt: 'steady camera' })
    expect(updateShotSchema.safeParse({}).success).toBe(false)
  })
})

describe('script workflow contracts', () => {
  it('applies safe defaults to script generation and shot splitting requests', () => {
    expect(generateScriptRequestSchema.parse({ draft: 'story draft' })).toMatchObject({
      draft: 'story draft',
      mode: 'quick',
      segment: { goal: '', targetMinutes: 5 },
      productionMode: 'short-video',
      episodeMinutes: 1,
      model: 'glm-5.2',
      revisionNote: '',
      direction: {
        style: 'auto',
        composition: 'auto',
        lighting: 'auto',
        camera: 'auto',
        focus: 'balanced',
      },
    })
    expect(
      generateScriptAssetSuggestionsRequestSchema.parse({ script: 'scene: river crossing' }),
    ).toMatchObject({
      script: 'scene: river crossing',
      direction: expect.objectContaining({ style: 'auto' }),
    })
    expect(enrichScriptRequestSchema.parse({ script: 'scene: river crossing' }).direction).toMatchObject({
      style: 'auto',
      composition: 'auto',
      lighting: 'auto',
      camera: 'auto',
      focus: 'balanced',
    })
    expect(enrichScriptRequestSchema.parse({ script: 'scene: river crossing' })).toMatchObject({
      model: 'glm-5.2',
      revisionNote: '',
    })
    expect(reviewScriptRequestSchema.parse({ script: 'scene: river crossing' })).toMatchObject({
      model: 'glm-5.2',
    })
    expect(generateShotsRequestSchema.parse({})).toMatchObject({
      maxShots: 8,
      mode: 'scene',
      episodeDurationSeconds: 60,
    })
    expect(autoSplitShotsRequestSchema.parse({})).toEqual({ episodeDurationSeconds: 60 })
    expect(autoSplitShotsRequestSchema.parse({ episodeDurationSeconds: 300 })).toEqual({
      episodeDurationSeconds: 300,
    })
    expect(generateShotsRequestSchema.parse({ episodeDurationSeconds: 90 })).toMatchObject({
      episodeDurationSeconds: 90,
    })
    expect(autoSplitShotsRequestSchema.parse({ episodeDurationSeconds: 90 })).toEqual({
      episodeDurationSeconds: 90,
    })
    expect(
      generateScriptRequestSchema.parse({
        draft: 'web series',
        productionMode: 'web-series',
        episodeMinutes: 5,
      }),
    ).toMatchObject({ productionMode: 'web-series', episodeMinutes: 5 })
    expect(generateShotsRequestSchema.parse({ mode: 'beat', maxShots: 36 })).toMatchObject({
      maxShots: 36,
      mode: 'beat',
    })
  })

  it('validates generated asset suggestions from a script', () => {
    expect(
      scriptAssetSuggestionsResultSchema.safeParse({
        summary: 'Suggestions',
        assets: [],
        generatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })

  it('validates structured professional review results', () => {
    const dimensions = ['plot', 'character', 'dialogue', 'style', 'composition', 'lighting', 'camera'].map(
      (key) => ({ key, score: 80, finding: 'clear issue', suggestion: 'provide a concrete fix' }),
    )
    expect(
      scriptReviewResultSchema.safeParse({
        score: 80,
        verdict: 'production ready',
        dimensions,
        priorityActions: ['strengthen character goal'],
        generatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })
})
