import { describe, expect, it } from 'vitest'
import {
  createShotAssetReferenceIndex,
  selectShotAssetsFromIndex,
  selectShotAssetReferences,
  selectVideoReferenceImages,
  taskUsesAssetReferences,
} from './referenceSelector'

const assets = [
  asset('character-lin', 'character', '林夏', '年轻导演', '/face.png', '/body.png'),
  asset('scene-station', 'scene', '雨夜旧火车站', '废弃站台和候车厅', '/station.png'),
  asset('prop-film', 'prop', '父亲留下的胶片铁盒', '锈迹铁盒和泛黄胶片', '/prop.png'),
  asset('costume-lin', 'costume', '林夏黑色雨夜风衣', '女主角雨夜戏服', '/coat.png'),
]

describe('selectShotAssetReferences', () => {
  it('associates silent participants from the explicit cast and excludes dialogue-only mentions', () => {
    const records = [
      asset('silent', 'character', '林', '', '/silent.png'),
      asset('speaker', 'character', '林夏', '', '/speaker.png'),
      asset('mentioned', 'character', 'Anna', '', '/anna.png'),
      asset('similar', 'character', 'Ann', '', '/ann.png'),
    ]
    const shot = {
      prompt: '角色：林、林夏\n场景：无\n关键物件：无\n动作：两人保持沉默。\n对白：林夏说：“Anna 还没来。”',
    }
    expect(selectShotAssetReferences(records, shot).map((item) => item.id)).toEqual(['silent', 'speaker'])
    expect(
      selectShotAssetReferences(records, { prompt: '角色：Anna\n对白：Anna 提起林夏。' }).map(
        (item) => item.id,
      ),
    ).toEqual(['mentioned'])
    expect(
      selectShotAssetReferences(records, { prompt: '林夏与 Anna 走进门。' })
        .map((item) => item.id)
        .sort(),
    ).toEqual(['mentioned', 'speaker'])
  })

  it('respects explicit empty cast and props including outfits linked to absent participants', () => {
    const records = [
      ...assets,
      {
        ...assets[3],
        attributes: { type: 'costume', characterAssetId: 'character-lin' },
      },
    ]
    records.splice(3, 1)
    const shot = {
      prompt:
        '场景：雨夜旧火车站\n角色：无\n关键物件：无\n动作：林夏的黑色雨夜风衣和胶片铁盒出现在回忆文字中。',
    }
    expect(selectShotAssetReferences(records, shot).map((item) => item.id)).toEqual(['scene-station'])
  })

  it('matches stable scene identity with time metadata without cross-linking day and night variants', () => {
    const records = [
      asset('day', 'scene', '档案室 - 日', '', '/day.png'),
      asset('night', 'scene', '档案室（夜）', '', '/night.png'),
      asset('stable', 'scene', '档案室', '', '/room.png'),
      asset('another', 'scene', '办公室', '', '/office.png'),
      asset('named-parentheses', 'scene', '档案室（旧馆）', '', '/old.png'),
    ]
    expect(
      selectShotAssetReferences(records, { prompt: '场景：档案室（档案室 - 夜，内景）' }).map(
        (item) => item.id,
      ),
    ).toEqual(['night', 'stable'])
    expect(
      selectShotAssetReferences(records, { prompt: '场景：档案室（旧馆）' }).map((item) => item.id),
    ).toEqual(['named-parentheses'])
    expect(
      selectShotAssetReferences(records, { prompt: '场景：档案室（旧馆）（档案室（旧馆） - 夜，内景）' }).map(
        (item) => item.id,
      ),
    ).toEqual(['named-parentheses'])
    expect(
      selectShotAssetReferences(records, { prompt: '场景：档案室（day）' }).map((item) => item.id),
    ).toEqual(['day', 'stable'])
    expect(selectShotAssetReferences(records, { prompt: '场景：陌生码头\n动作：驶离海岸。' })).toEqual([])
    expect(selectShotAssetReferences(records, { prompt: '一片空白。' })).toEqual([])
  })

  it('keeps undesigned records linked without consuming media slots or changing manual choices', () => {
    const records = [
      asset('pending', 'character', '沉默者', '', null),
      asset('ready', 'prop', '铜钥匙', '', '/key.png'),
      asset('pending-room', 'scene', '档案室', '', null),
    ]
    const shot = {
      prompt: '场景：档案室\n角色：沉默者\n关键物件：铜钥匙',
      referenceImages: [{ url: '/manual.png' }],
    }
    const original = structuredClone({ records, shot })
    expect(
      selectShotAssetsFromIndex(createShotAssetReferenceIndex(records), shot).map((item) => item.id),
    ).toEqual(['pending-room', 'pending', 'ready'])
    const references = selectShotAssetReferences(records, shot, 1)
    expect(references.map((item) => item.id)).toEqual(['ready'])
    expect(
      selectVideoReferenceImages(
        shot.referenceImages.map((item) => item.url),
        references,
      ),
    ).toEqual(['/manual.png', '/key.png'])
    expect({ records, shot }).toEqual(original)
  })

  it.each([
    '档案室（档案室 - 日，内外景）',
    '档案室（档案室，内外景）',
    'INT./EXT. 档案室 - 日',
    'EXT. / INT. 档案室 - 日',
    '内外景 档案室 - 日',
  ])('links mixed interior/exterior scene %s without imposing a single space', (scene) => {
    const records = [
      asset('stable', 'scene', '档案室', '', '/room.png'),
      asset('interior', 'scene', 'INT. 档案室', '', '/inside.png'),
      asset('exterior', 'scene', 'EXT. 档案室', '', '/outside.png'),
    ]
    expect(selectShotAssetReferences(records, { prompt: `场景：${scene}` }).map((item) => item.id)).toEqual([
      'stable',
    ])
    expect(
      selectShotAssetReferences([asset('mixed', 'scene', 'INT./EXT. 档案室', '', '/mixed.png')], {
        prompt: `场景：${scene}`,
      }).map((item) => item.id),
    ).toEqual(['mixed'])
  })

  it('keeps all participant identities before optional outfits when the provider reference limit is reached', () => {
    const references = [
      { videoUrl: 'asset://first', url: '/first.png', appearanceUrl: '/first-outfit.png' },
      { videoUrl: 'asset://second', url: '/second.png', appearanceUrl: '/second-outfit.png' },
      { url: '/scene.png' },
    ]
    expect(selectVideoReferenceImages('/tail.png', references, 4)).toEqual([
      '/tail.png',
      'asset://first',
      'asset://second',
      '/scene.png',
    ])
    expect(selectVideoReferenceImages(null, references, 9)).toEqual([
      'asset://first',
      'asset://second',
      '/scene.png',
      '/first-outfit.png',
      '/second-outfit.png',
    ])
  })
  it('uses the requested outfit with its shared portrait instead of the globally selected outfit', () => {
    const character = asset('gu', 'character', '顾砚', '年轻男性', '/face.png', '/standard.png')
    character.attributes.activeAppearanceVariantId = 'standard'
    character.attributes.trustedPortrait = { assetId: 'portrait-gu', status: 'active' }
    character.attributes.appearanceVariants = [
      { id: 'standard', name: '顾砚-标准版', bodyReference: { url: '/standard.png' } },
      { id: 'formal', name: '顾砚-礼服版', description: '黑色礼服', bodyReference: { url: '/formal.png' } },
      { id: 'work', name: '顾砚-工装版本', description: '蓝色工装', bodyReference: null },
    ]
    const references = selectShotAssetReferences([character], { prompt: '顾砚-礼服版本走进大厅。' })
    expect(references[0]).toMatchObject({
      url: '/formal.png',
      appearance: { name: '顾砚-礼服版本', description: '黑色礼服' },
    })
    expect(selectVideoReferenceImages(null, references)).toEqual(['asset://portrait-gu', '/formal.png'])
    expect(selectShotAssetReferences([character], { prompt: '顾砚-工装版本进门。' })[0].url).toBe('/face.png')
    expect(character.attributes.activeAppearanceVariantId).toBe('standard')
  })
  it('ranks named characters and their costume before generic assets', () => {
    const references = selectShotAssetReferences(assets, {
      title: '林夏抵达',
      prompt: '林夏撑伞走进候车厅，黑色风衣被雨打湿。',
    })

    expect(references.map((reference) => reference.id).slice(0, 2)).toEqual(['character-lin', 'costume-lin'])
    expect(references[0].url).toBe('/body.png')
  })

  it('automatically attaches one costume explicitly linked to a named character', () => {
    const linkedAssets = [
      assets[0],
      {
        ...assets[3],
        name: '轻度战损变体',
        description: '肩部破损的战斗服',
        attributes: { type: 'costume', characterAssetId: 'character-lin' },
      },
      {
        ...assets[3],
        id: 'costume-lin-alt',
        name: '林夏宴会礼服',
        attributes: { type: 'costume', characterAssetId: 'character-lin' },
      },
    ]

    const references = selectShotAssetReferences(linkedAssets, {
      title: '林夏受伤',
      prompt: '林夏从地面撑起身体，肩部衣料已经撕裂。',
    })

    expect(references.map((reference) => reference.id)).toEqual(['character-lin', 'costume-lin'])
  })

  it('ranks a matching scene and prop from the shot description', () => {
    const references = selectShotAssetReferences(assets, {
      title: '打开铁盒',
      prompt: '废弃旧火车站候车厅里，林夏打开父亲留下的锈迹胶片铁盒。',
    })

    expect(references.map((reference) => reference.id)).toEqual([
      'character-lin',
      'prop-film',
      'scene-station',
      'costume-lin',
    ])
  })

  it('detects storyboard tasks generated without the current asset set', () => {
    const references = selectShotAssetReferences(assets, { title: '林夏抵达', prompt: '林夏走进车站。' })

    expect(taskUsesAssetReferences({ metadata: { references: [] } }, references)).toBe(false)
    expect(
      taskUsesAssetReferences(
        { metadata: { referenceAssetIds: references.map((reference) => reference.id) } },
        references,
      ),
    ).toBe(true)
  })

  it('does not attach an unrelated character to a scene-only establishing shot', () => {
    const references = selectShotAssetReferences(assets, {
      title: '雨夜空镜',
      prompt: '废弃旧火车站站台，铁轨尽头灯光闪烁。',
    })

    expect(references.map((reference) => reference.id)).toEqual(['scene-station'])
  })

  it('does not attach a character from generic description overlap', () => {
    const character = asset(
      'character-iris',
      'character',
      'Iris',
      'future space station inspector',
      '/iris.png',
    )

    const references = selectShotAssetReferences([character], {
      title: 'Empty control room',
      prompt: 'A future space station control room with no people in frame.',
    })

    expect(references).toEqual([])
  })

  it('attaches a named brand asset to an advertising shot', () => {
    const brand = asset('brand-xumu', 'brand', '序幕TV', '平台品牌 Logo', '/brand.png')
    const references = selectShotAssetReferences([brand], {
      title: '品牌落版',
      prompt: '序幕TV 标志居中出现，保持文字和图形结构准确。',
    })

    expect(references).toMatchObject([{ id: 'brand-xumu', assetKind: 'brand', url: '/brand.png' }])
  })

  it('generates video directly from assets when no storyboard image exists', () => {
    const references = selectShotAssetReferences(assets, {
      title: '林夏抵达',
      prompt: '林夏走进雨夜旧火车站。',
    })

    expect(selectVideoReferenceImages(null, references)).toEqual(references.map((reference) => reference.url))
  })

  it('uses an available storyboard image before asset references and removes duplicates', () => {
    expect(
      selectVideoReferenceImages('/storyboard.png', [
        { url: '/character.png' },
        { url: '/storyboard.png' },
        { url: '/scene.png' },
      ]),
    ).toEqual(['/storyboard.png', '/character.png', '/scene.png'])
    expect(selectVideoReferenceImages(null, [])).toEqual([])
  })

  it('uses an active Ark asset URI for video without changing the image preview URL', () => {
    const character = asset('character-live', 'character', '演员甲', '已授权真人', '/face.png')
    character.attributes.trustedPortrait = { assetId: 'asset-live-1', status: 'active' }
    const references = selectShotAssetReferences([character], {
      title: '演员甲近景',
      prompt: '演员甲看向镜头。',
    })

    expect(references[0]).toMatchObject({ url: '/face.png', videoUrl: 'asset://asset-live-1' })
    expect(selectVideoReferenceImages(null, references)).toEqual(['asset://asset-live-1'])
  })

  it('keeps continuity references bounded so the tail frame remains the visual anchor', () => {
    const references = [
      { id: 'character-lin', url: '/character.png' },
      { id: 'scene-station', url: '/scene.png' },
      { id: 'prop-film', url: '/prop.png' },
      { id: 'costume-lin', url: '/costume.png' },
    ]

    expect(selectVideoReferenceImages('/tail.png', references, 4)).toEqual([
      '/tail.png',
      '/character.png',
      '/scene.png',
      '/prop.png',
    ])
  })
})

function asset(id, kind, name, description, imageUrl, bodyUrl = null) {
  return {
    id,
    kind,
    name,
    description,
    imageUrl,
    attributes:
      kind === 'character'
        ? {
            type: 'character',
            faceReference: { url: imageUrl },
            bodyReference: bodyUrl ? { url: bodyUrl } : null,
          }
        : { type: kind },
  }
}
