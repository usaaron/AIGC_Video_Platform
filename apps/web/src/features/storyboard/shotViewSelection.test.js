import { describe, expect, it } from 'vitest'
import { selectShotAssetReferences, selectVideoReferenceImages } from './referenceSelector'

const character = (id, name) => ({ id, kind: 'character', name, imageUrl: `/${id}-old`, attributes: {
  type: 'character', faceReference: { url: `/${id}-face` }, activeAppearanceVariantId: 'rain',
  appearanceVariants: [{ id: 'rain', name: '雨衣', bodyReference: { url: `/${id}-body` },
    turnaroundReferences: ['front','side','back'].map((view) => ({ view, url: `/${id}-${view}` })) }],
} })

describe('storyboard view suggestions', () => {
  it('includes legacy base-appearance actors with the current look and confirmed identity', () => {
    const elena = character('elena', 'Elena Ward 基础外观')
    elena.attributes.trustedPortrait = { status: 'active', assetId: 'elena-trusted' }
    const dain = character('dain', 'Dain Mercer 基础外观')
    const before = structuredClone([elena, dain])
    const refs = selectShotAssetReferences([elena, dain], { prompt: 'Elena Ward侧对镜头，Dain Mercer正对镜头。' })
    expect(refs.map((ref) => ref.id)).toEqual(['elena', 'dain'])
    expect(refs[0]).toMatchObject({ url: '/elena-side', videoUrl: 'asset://elena-trusted', appearanceUrl: '/elena-side' })
    expect(refs[1]).toMatchObject({ url: '/dain-front' })
    expect([elena, dain]).toEqual(before)
    expect(selectShotAssetReferences([elena], { prompt: '画外音：Elena Ward回答。' })).toEqual([])
  })
  it('does not add a scene-level actor who has not entered the current shot', () => {
    const refs = selectShotAssetReferences([character('elena', 'Elena Ward 基础外观'), character('dain', 'Dain Mercer 基础外观')], {
      prompt: '场景上下文\nElena Ward与Dain Mercer争执。\n首帧与空间调度\nElena尚未入画；Dain持终端。\n格式模式\n单一连续镜头\n动作时序\nDain守在闸口。\n表演\n维持秩序。',
    })
    expect(refs.map((ref) => ref.id)).toEqual(['dain'])
  })
  it.each(['周宁说“林岚在哪里？”', '画外音：林岚回答。', '林岚不入画，周宁看向门口。'])('does not introduce a merely mentioned or offscreen person: %s', (prompt) => {
    expect(selectShotAssetReferences([character('lin', '林岚')], { title: '林岚回应', prompt })).toEqual([])
  })
  it('selects each actor angle separately and keeps all principal images before supplements', () => {
    const selected = selectShotAssetReferences([character('lin','林岚'), character('zhou','周宁')], { prompt: '前景林岚背对镜头，周宁正对镜头。' })
    expect(selected.map((item) => item.url)).toEqual(['/lin-back','/zhou-front'])
    expect(selectVideoReferenceImages(['/manual'], selected)).toEqual(['/manual','/lin-back','/zhou-front','/lin-face','/zhou-face'])
  })
  it('does not attach an arbitrary location or an unrelated costume merely because its owner appears', () => {
    const selected = selectShotAssetReferences([character('lin','林岚'),
      { id: 'scene', kind: 'scene', name: '医院', imageUrl: '/hospital' },
      { id: 'costume', kind: 'costume', name: '晚宴礼服', imageUrl: '/formal', attributes: { type: 'costume', characterAssetId: 'lin' } },
    ], { prompt: '林岚背对镜头站在门边。' })
    expect(selected.map((item) => item.id)).toEqual(['lin'])
  })
  it('supports a character that has only independent sources for the selected look', () => {
    const asset = character('lin','林岚')
    asset.imageUrl = null; asset.attributes.faceReference = null; asset.attributes.appearanceVariants[0].bodyReference = null
    expect(selectShotAssetReferences([asset], { prompt: '林岚侧对镜头。' })[0]?.url).toBe('/lin-side')
  })
})
