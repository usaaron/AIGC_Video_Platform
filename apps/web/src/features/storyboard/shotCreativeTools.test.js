import { describe, expect, it } from 'vitest'
import {
  applyNegativePromptTemplate,
  applyShotPromptTemplate,
  characterConsistencyIssues,
  negativePromptOptions,
  suggestedAssetIdsForShot,
  suggestedAssetsForShot,
} from './shotCreativeTools'

const character = (overrides = {}) => ({
  id: 'character-lin',
  kind: 'character',
  name: '林夏',
  description: '短发，深色风衣',
  prompt: '东亚女性，电影感',
  attributes: {
    faceStatus: 'approved',
    bodyStatus: 'approved',
    faceReference: { id: 'face', url: '/face.jpg', name: '面部基准' },
    bodyReference: { id: 'body', url: '/body.jpg', name: '全身基准' },
    turnaround: true,
    turnaroundReferences: [{ view: 'front' }, { view: 'side' }, { view: 'back' }],
  },
  ...overrides,
})

describe('shot creative tools', () => {
  it('suggests assets from shot text and keeps existing references first', () => {
    const assets = [
      { id: 'scene-station', kind: 'scene', name: '站台场景', description: '雨夜车站', prompt: '' },
      character(),
      { id: 'prop-letter', kind: 'prop', name: '无署名的信', description: '关键线索', prompt: '' },
    ]

    expect(
      suggestedAssetIdsForShot(
        {
          title: '林夏抵达站台',
          prompt: '雨夜，林夏撑伞走入站台，手里拿着无署名的信',
          assetIds: ['character-lin'],
        },
        assets,
      ),
    ).toEqual(['character-lin', 'prop-letter', 'scene-station'])
    expect(suggestedAssetsForShot({ title: '空镜', prompt: '街道', assetIds: [] }, assets)[0].asset.id).toBe(
      'scene-station',
    )
  })

  it('applies a prompt template without duplicating the template marker', () => {
    const first = applyShotPromptTemplate('林夏走入站台', 'character-action', {
      shot: { framing: '中近景' },
      assets: [character()],
    })
    const second = applyShotPromptTemplate(first, 'character-action', {
      shot: { framing: '中近景' },
      assets: [character()],
    })

    expect(first).toContain('镜头模板：角色行动')
    expect(second.match(/镜头模板：角色行动/g)).toHaveLength(1)
  })

  it('checks face, body and turnaround references for characters', () => {
    const issues = characterConsistencyIssues(
      { title: '林夏回头', prompt: '人物回头看向车站', assetIds: ['character-lin'] },
      [
        character({
          attributes: {
            faceStatus: 'pending',
            bodyStatus: 'approved',
            faceReference: null,
            bodyReference: { id: 'body', url: '/body.jpg', name: '全身基准' },
            turnaround: true,
            turnaroundReferences: [{ view: 'front' }],
          },
        }),
      ],
    )

    expect(issues.map((issue) => issue.code)).toEqual(['face-reference-missing', 'turnaround-incomplete'])
  })

  it('supports project negative prompt templates and local shot constraints', () => {
    const options = negativePromptOptions({ contentType: 'advertisement' })
    const prompt = applyNegativePromptTemplate('产品在桌面上旋转', 'productAd', {
      contentType: 'advertisement',
    })

    expect(options.map((option) => option.id)).toContain('project')
    expect(prompt).toContain('负面约束：')
    expect(prompt).toContain('不要塑料感')
  })
})
