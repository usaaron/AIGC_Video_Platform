import { describe, expect, it } from 'vitest'
import { countPropMentions, propAssetDecisionReason, shouldCreatePropAsset } from './propAssetPolicy'

describe('prop asset policy', () => {
  it('keeps one-off ordinary props out of the asset list', () => {
    expect(
      shouldCreatePropAsset({
        name: '路边纸杯',
        description: '背景里随手出现一次',
        shotPrompts: ['主角经过夜市，路边有纸杯和杂物。'],
      }),
    ).toBe(false)
  })

  it('allows a plot-critical prop even when it appears once', () => {
    expect(
      shouldCreatePropAsset({
        name: '旧铁盒',
        description: '关键线索，里面保存父亲留下的胶片',
        shotPrompts: ['周野把旧铁盒放到长椅上。'],
      }),
    ).toBe(true)
  })

  it('allows recurring props that need visual consistency', () => {
    const shots = ['林夏撑着透明雨伞走入站台。', '透明雨伞上的雨滴反射信号灯。']

    expect(countPropMentions('透明雨伞', shots)).toBe(2)
    expect(
      shouldCreatePropAsset({
        name: '透明雨伞',
        description: '普通日用品',
        shotPrompts: shots,
      }),
    ).toBe(true)
  })

  it('returns a user-facing reason for the decision', () => {
    expect(propAssetDecisionReason({ name: '', shotPrompts: [] })).toBe('先填写明确的物件名称。')
    expect(propAssetDecisionReason({ name: '背景椅子', shotPrompts: ['角落里有椅子。'] })).toBe(
      '建议写进单个镜头提示词，不单独建资产。',
    )
  })
})
