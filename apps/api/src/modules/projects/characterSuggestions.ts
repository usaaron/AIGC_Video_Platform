import { createHash } from 'node:crypto'
import {
  assetIdentityKey,
  characterIdentity,
  mergeCharacterVariants,
  type Asset,
  type ScriptAssetSuggestion,
} from '@seqora/contracts'

export function mergeProjectSuggestions(
  suggestions: ScriptAssetSuggestion[],
  existingAssets: Asset[],
  drama: boolean,
) {
  const merged = new Map<string, ScriptAssetSuggestion>()
  for (let input of suggestions) {
    if (drama && input.kind === 'costume') {
      const owner = input.sourceFacts?.['归属'] || input.sourceFacts?.['所属人物']
      const character = suggestions
        .filter((item) => item.kind === 'character')
        .sort((a, b) => b.name.length - a.name.length)
        .find((item) => {
          const name = item.sourceFacts?.['基础人物'] || characterIdentity(item.name).name
          return owner ? owner === name : input.name.startsWith(name)
        })
      if (!character) continue
      const name = character.sourceFacts?.['基础人物'] || characterIdentity(character.name).name
      const label = input.name.replace(name, '').replace(/^[-—·\s]+/u, '')
      input = {
        ...character,
        sourceFacts: {
          ...character.sourceFacts,
          基础人物: name,
          版本: label.endsWith('版') ? label : `${label}版`,
          服装: input.description,
        },
      }
    }
    let suggestion = input
    if (input.kind === 'character') {
      const identity = characterIdentity(input.name)
      const name = input.sourceFacts?.['基础人物'] || identity.name
      const variantName = `${name}-${input.sourceFacts?.['版本'] || identity.variant}`.replace(/版本$/u, '版')
      const variantId = `look-${createHash('sha256').update(variantName).digest('hex').slice(0, 24)}`
      const now = new Date().toISOString()
      suggestion = {
        ...input,
        name,
        attributes: {
          ...input.attributes,
          activeAppearanceVariantId: variantId,
          appearanceVariants: [
            {
              id: variantId,
              name: variantName,
              description: input.sourceFacts?.['服装'] || input.sourceFacts?.['造型'] || input.description,
              bodyReference: null,
              turnaroundReferences: [],
              turnaroundLayout: 'sheet',
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      }
    }
    const key = assetIdentityKey(suggestion)
    const previous = merged.get(key)
    merged.set(key, previous ? mergeCharacterVariants(previous, suggestion) : suggestion)
  }
  return [...merged.values()].filter((suggestion) => {
    const existing = existingAssets.find((asset) => assetIdentityKey(asset) === assetIdentityKey(suggestion))
    if (!existing) return true
    if (existing.attributes.type !== 'character' || suggestion.attributes.type !== 'character') return false
    // A legacy character already represents its standard look; only recommend genuinely new outfits.
    const known = new Set(
      [`${existing.name}-标准版`, ...existing.attributes.appearanceVariants.map((item) => item.name)].map(
        (name) => assetIdentityKey({ kind: 'character', name }),
      ),
    )
    suggestion.attributes.appearanceVariants = suggestion.attributes.appearanceVariants.filter(
      (item) => !known.has(assetIdentityKey({ kind: 'character', name: item.name })),
    )
    return suggestion.attributes.appearanceVariants.length > 0
  })
}
