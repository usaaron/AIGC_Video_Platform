import { describe, expect, it } from 'vitest'
import {
  characterReferenceName,
  characterShotView,
  selectCharacterShotAppearance,
  shotMentionsVisibleCharacter,
} from './shotAssetAppearance.js'
import type { Asset } from './project.js'

function actor() {
  return {
    kind: 'character',
    name: '林岚',
    imageUrl: '/old.png',
    attributes: {
      type: 'character',
      faceStatus: 'approved',
      faceReference: { url: '/face.png' },
      bodyReference: { url: '/wrong-body.png' },
      activeAppearanceVariantId: 'rain',
      appearanceVariants: [
        {
          id: 'rain',
          name: '雨衣',
          bodyReference: { url: '/rain.png' },
          turnaroundReferences: ['back', 'front', 'side'].map((view) => ({ url: `/rain-${view}.png`, view })),
        },
        { id: 'formal', name: '礼服', bodyReference: null, turnaroundReferences: [] },
      ],
    },
  } as unknown as Asset
}

describe('shot-specific character views', () => {
  it('matches a legacy base-appearance label without changing its saved identity or images', () => {
    const asset = actor()
    asset.name = 'Elena Ward 基础外观'
    const before = structuredClone(asset)
    expect(shotMentionsVisibleCharacter(asset.name, { prompt: 'Elena Ward侧对镜头。' })).toBe(true)
    expect(selectCharacterShotAppearance(asset, { prompt: 'Elena Ward侧对镜头。' })).toMatchObject({
      url: '/rain-side.png',
      view: 'side',
    })
    expect(asset).toEqual(before)
  })
  it('strips only the known separated suffix, preserving offscreen and distinct-name exclusions', () => {
    expect(characterReferenceName('Elena Ward 基础外观-行动装版本')).toBe('Elena Ward')
    expect(characterReferenceName('基础外观设计师')).toBe('基础外观设计师')
    expect(characterReferenceName('林岚（姐姐）')).toBe('林岚（姐姐）')
    expect(shotMentionsVisibleCharacter('Elena Ward 基础外观', { prompt: '画外音：Elena Ward回答。' })).toBe(
      false,
    )
    expect(shotMentionsVisibleCharacter('Elena Ward 基础外观', { prompt: 'Elena Wells走进来。' })).toBe(false)
  })
  it('lets an explicit shot opening override cast mentions in the shared scene context', () => {
    const prompt =
      '场景上下文\nElena Ward与Dain Mercer争执。\n首帧与空间调度\nElena尚未入画；Dain持终端。\n格式模式\n单一镜头\n动作时序\n人群推挤；Dain保持位置。\n表演\n保持动作。'
    const names = ['Elena Ward 基础外观', 'Dain Mercer 基础外观']
    expect(shotMentionsVisibleCharacter(names[0]!, { prompt }, names)).toBe(false)
    expect(shotMentionsVisibleCharacter(names[1]!, { prompt }, names)).toBe(true)
    expect(
      shotMentionsVisibleCharacter(
        names[0]!,
        { prompt: prompt.replace('人群推挤；', 'Elena随后入画；') },
        names,
      ),
    ).toBe(true)
    expect(shotMentionsVisibleCharacter(names[0]!, { prompt }, [...names, 'Elena Wells'])).toBe(true)
    expect(
      shotMentionsVisibleCharacter(
        names[0]!,
        { prompt: prompt.replace('Elena尚未入画', 'Elena Ward尚未入画') },
        [...names, 'Elena Wells'],
      ),
    ).toBe(false)
  })
  it.each([
    ['林岚背对镜头站立。', 'back'],
    ['林岚侧对摄影机。', 'side'],
    ['林岚正面入镜。', 'front'],
    ['林岚面部特写。', 'face'],
    ['林岚背对镜头，随后林岚转身正对镜头。', 'back'],
    ['林岚不背对镜头。', null],
    ['对白：林岚说“我的背影”。', null],
    ['林岚看向周宁的背影。', null],
    ['林岚与周宁侧对镜头。', null],
    ['林岚背对镜头。林岚正对镜头。', null],
    ['林岚拿起背面写字的信封。', null],
    ['林岚看到远处一个背影。', null],
    ['画外音：林岚的背影消失了。', null],
  ])('resolves only unambiguous opening cues: %s', (prompt, view) => {
    expect(characterShotView('林岚', { prompt }, ['林岚', '周宁'])).toBe(view)
  })
  it('keeps two actors independent in an over-shoulder composition', () => {
    const shot = { prompt: '前景林岚背对镜头，周宁正对镜头。' }
    expect(characterShotView('林岚', shot, ['林岚', '周宁'])).toBe('back')
    expect(characterShotView('周宁', shot, ['林岚', '周宁'])).toBe('front')
  })
  it('uses close framing only for a single identified face subject', () => {
    expect(characterShotView('林岚', { prompt: '林岚停下。', framing: '面部特写' }, ['林岚', '周宁'])).toBe(
      'face',
    )
    expect(
      characterShotView('林岚', { prompt: '林岚与周宁交谈。', framing: '面部特写' }, ['林岚', '周宁']),
    ).toBeNull()
    expect(characterShotView('林岚', { prompt: '林岚签名。', framing: '手部特写' }, ['林岚'])).toBeNull()
  })
  it('selects tagged views regardless of source order and keeps identity as a supplement', () => {
    const asset = actor(),
      before = structuredClone(asset)
    expect(selectCharacterShotAppearance(asset, { prompt: '林岚背对镜头。' })).toMatchObject({
      url: '/rain-back.png',
      view: 'back',
      appearanceUrl: '/face.png',
      appearanceRole: '面部身份',
    })
    expect(asset).toEqual(before)
  })
  it('does not leak active or base clothes into an explicitly selected unfinished appearance', () => {
    expect(selectCharacterShotAppearance(actor(), { prompt: '林岚-礼服版本侧对镜头。' })).toMatchObject({
      url: '/face.png',
      view: 'face',
      variant: { id: 'formal' },
    })
  })
  it('uses matching-look fallback if requested view is missing and never labels it as that view', () => {
    const asset = actor()
    if (asset.attributes.type !== 'character') throw new Error()
    asset.attributes.appearanceVariants[0]!.turnaroundReferences = []
    expect(selectCharacterShotAppearance(asset, { prompt: '林岚背对镜头。' })).toMatchObject({
      url: '/rain.png',
      view: 'body',
      requestedView: 'back',
    })
  })
  it('uses the legacy positional view only for a complete wholly untagged set', () => {
    const asset = actor()
    if (asset.attributes.type !== 'character') throw new Error()
    asset.attributes.appearanceVariants[0]!.turnaroundReferences = ['front', 'side', 'back'].map((view) => ({
      id: view,
      name: view,
      url: `/legacy-${view}.png`,
    }))
    expect(selectCharacterShotAppearance(asset, { prompt: '林岚背对镜头。' })?.url).toBe('/legacy-back.png')
    asset.attributes.appearanceVariants[0]!.turnaroundReferences[0]!.view = 'front'
    expect(selectCharacterShotAppearance(asset, { prompt: '林岚背对镜头。' })?.url).toBe('/rain.png')
  })
  it('retains trusted identity while selecting the current view as clothing/structure reference', () => {
    const asset = actor()
    if (asset.attributes.type !== 'character') throw new Error()
    asset.attributes.trustedPortrait = {
      status: 'active',
      assetId: 'trusted',
    } as typeof asset.attributes.trustedPortrait
    expect(selectCharacterShotAppearance(asset, { prompt: '林岚侧对镜头。' })).toMatchObject({
      videoUrl: 'asset://trusted',
      url: '/rain-side.png',
      appearanceUrl: '/rain-side.png',
      appearanceRole: '侧面造型',
    })
  })
})
