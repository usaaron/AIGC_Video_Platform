import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AssetSuggestionsPanel } from './AssetSuggestionsPanel'

function render(assets) {
  return renderToStaticMarkup(
    <AssetSuggestionsPanel status="ready" result={{ assets }} showPrompt={false} showExport={false} />,
  )
}

describe('delivered asset fact display', () => {
  it('shows explicit appearance and ordered fixed details on character, scene and prop cards', () => {
    const html = render([
      { kind: 'character', name: '林澈', sourceFacts: { 外观: '短发，穿灰色外套' } },
      {
        kind: 'scene',
        name: '档案室',
        sourceFacts: { 外观: '红砖墙与木柜', 固定细节2: '右侧一扇窗', 固定细节1: '门在左侧' },
      },
      {
        kind: 'prop',
        name: '铜钥匙',
        sourceFacts: { 外观: '黄铜色旧钥匙', 固定细节1: '圆形匙柄', 固定细节2: '三个齿' },
      },
    ])
    expect(html).toContain('<b>固定外形</b><em>短发，穿灰色外套</em>')
    expect(html).toContain('<b>发型</b><em>未补充</em>')
    expect(html).toContain('<b>材质色彩</b><em>红砖墙与木柜</em>')
    expect(html).toContain('<b>固定布局</b><em>门在左侧、右侧一扇窗</em>')
    expect(html).toContain('<b>外观</b><em>黄铜色旧钥匙</em>')
    expect(html).toContain('<b>固定结构</b><em>圆形匙柄、三个齿</em>')
  })

  it('prefers named visual facts and removes repeated fixed details', () => {
    const html = render([
      { kind: 'character', name: '林澈', sourceFacts: { 固定外形: '已有完整外形', 外观: '较短简介' } },
      {
        kind: 'scene',
        name: '档案室',
        sourceFacts: {
          材质: '木材',
          外观: '较短简介',
          固定布局: '门在左侧',
          固定细节1: '门在左侧',
          固定细节2: '右侧一扇窗',
        },
      },
    ])
    expect(html).toContain('<b>固定外形</b><em>已有完整外形</em>')
    expect(html).toContain('<b>材质色彩</b><em>木材</em>')
    expect(html).toContain('<b>固定布局</b><em>门在左侧、右侧一扇窗</em>')
  })
})
