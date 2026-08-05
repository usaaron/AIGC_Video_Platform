import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AssetShortcutBar, findAssetMentions } from './AssetShortcutBar'

const assets = [
  { id: 'character-1', kind: 'character', name: '方砚', attributes: {} },
  { id: 'scene-1', kind: 'scene', name: '天台', attributes: {} },
  { id: 'prop-1', kind: 'prop', name: '铜镜', attributes: {} },
  { id: 'costume-1', kind: 'costume', name: '黑色长袍', attributes: {} },
]

describe('asset shortcuts', () => {
  it('keeps exact text offsets when classifying inline asset mentions', () => {
    const value = '三分之后，方砚走上天台，举起铜镜。'

    expect(findAssetMentions(value, assets)).toMatchObject([
      { text: '方砚', start: 5, end: 7, asset: { kind: 'character' } },
      { text: '天台', start: 9, end: 11, asset: { kind: 'scene' } },
      { text: '铜镜', start: 14, end: 16, asset: { kind: 'prop' } },
    ])
  })

  it('renders a collapsed launcher with separate asset categories', () => {
    const html = renderToStaticMarkup(
      <AssetShortcutBar assets={assets} tasks={[]} value="方砚走上天台" onChange={() => {}} />,
    )

    expect(html).toContain('<details class="asset-shortcut-bar placement-bottom">')
    expect(html).toContain('正文已引用 2 项')
    expect(html).toContain('asset-shortcut-group kind-character')
    expect(html).toContain('asset-shortcut-group kind-scene')
    expect(html).toContain('asset-shortcut-group kind-prop')
    expect(html).toContain('asset-shortcut-group kind-costume')
  })
})
