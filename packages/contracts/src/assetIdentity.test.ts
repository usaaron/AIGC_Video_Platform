import { describe, expect, it } from 'vitest'
import {
  assetDisplayName,
  characterAppearance,
  characterVariantKey,
  characterVariantName,
  mergeCharacterVariants,
} from './assetIdentity.js'
import { createAssetSchema, type Asset } from './project.js'

const now = '2026-09-17T00:00:00Z'
const variant = (id: string, name: string) => ({
  id,
  name,
  description: '',
  bodyReference: null,
  turnaroundReferences: [],
  turnaroundLayout: 'sheet' as const,
  createdAt: now,
  updatedAt: now,
})
const character = createAssetSchema.parse({
  kind: 'character',
  name: '顾砚',
  sourceMode: 'generate',
  attributes: {
    type: 'character',
    subjectType: 'human',
    gender: 'male',
    ageGroup: 'young',
    exactAge: null,
    species: '',
    anthropomorphic: false,
    visualStyle: 'cinematic-cg',
    framing: 'full',
    bodyType: 'balanced',
    background: 'solid',
    faceStatus: 'pending',
    bodyStatus: 'pending',
    faceReference: null,
    bodyReference: null,
    legStretch: false,
    turnaround: false,
    turnaroundLayout: 'sheet',
    activeAppearanceVariantId: 'standard',
    appearanceVariants: [variant('standard', '顾砚-标准版'), variant('formal', '顾砚-礼服版本')],
  },
})

describe('character identity and appearances', () => {
  it('normalizes old names and user-entered outfit labels without repeating the person name', () => {
    expect(characterVariantName('顾砚')).toBe('顾砚-标准版本')
    expect(characterVariantName('顾砚', '礼服')).toBe('顾砚-礼服版本')
    expect(characterVariantName('顾砚', '顾砚—礼服版')).toBe('顾砚-礼服版本')
    expect(characterVariantName('顾宁', '顾砚-礼服版')).toBe('顾宁-礼服版本')
    expect(characterVariantKey('顾砚-礼服版')).toBe(characterVariantKey('顾砚-礼服版本'))
    expect(assetDisplayName(character)).toBe('顾砚-标准版本')
  })
  it('uses the appearance named by the shot, accepting legacy suffixes and preserving the active one', () => {
    expect(characterAppearance(character, '顾砚-礼服版走进大厅')?.id).toBe('formal')
    expect(characterAppearance(character, '顾砚走进大厅')?.id).toBe('standard')
    expect(assetDisplayName(character)).toBe('顾砚-标准版本')
  })
  it('merges repeated scans without replacing saved images or the active appearance', () => {
    const existing = { ...character, id: 'character-1' } as Asset
    const input = createAssetSchema.parse({
      ...character,
      attributes: {
        ...character.attributes,
        appearanceVariants: [variant('new-id', '顾砚-标准版本'), variant('work', '顾砚-工装版本')],
      },
    })
    const merged = mergeCharacterVariants(existing, input)
    expect(merged.attributes).toMatchObject({
      activeAppearanceVariantId: 'standard',
      appearanceVariants: [{ id: 'standard' }, { id: 'formal' }, { id: 'work' }],
    })
  })
})
