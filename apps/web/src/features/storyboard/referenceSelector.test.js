import { describe, expect, it } from 'vitest'
import {
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
  it('ranks named characters and their costume before generic assets', () => {
    const references = selectShotAssetReferences(assets, {
      title: '林夏抵达',
      prompt: '林夏撑伞走进候车厅，黑色风衣被雨打湿。',
    })

    expect(references.map((reference) => reference.id).slice(0, 2)).toEqual(['character-lin', 'costume-lin'])
    expect(references[0].url).toBe('/body.png')
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
