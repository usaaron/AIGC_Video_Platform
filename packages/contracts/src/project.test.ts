import { describe, expect, it } from 'vitest'
import { createAssetSchema } from './project.js'

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
  legStretch: false,
  turnaround: false,
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

    expect(createAssetSchema.safeParse(input).success).toBe(true)
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
})
