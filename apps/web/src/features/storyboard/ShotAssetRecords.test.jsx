import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ShotRow } from './StoryboardComponents'
import { ShotAssetShortcuts } from './ShotAssetShortcuts'

const assets = [
  { id: 'silent', kind: 'character', name: '沉默者', attributes: { type: 'character' } },
  { id: 'mentioned', kind: 'character', name: '来客', imageUrl: '/guest.png' },
  { id: 'room', kind: 'scene', name: '档案室', imageUrl: '/room.png' },
]
const shot = {
  id: 'shot-1',
  order: 1,
  duration: 5,
  title: '开门',
  framing: '中景',
  prompt: '场景：档案室\n角色：沉默者\n关键物件：无\n动作：推门。\n对白：“来客到了吗？”',
}

describe('storyboard asset records', () => {
  it('shows undesigned cast beside ready assets without enabling automatic generation', () => {
    const generate = vi.fn()
    const html = renderToStaticMarkup(
      <ShotRow shot={shot} assets={assets} tasks={[]} resolution="720p" onGenerateVideo={generate} />,
    )
    expect(html).toContain('aria-label="本镜头关联资产"')
    expect(html).toContain('class="pending-design"')
    expect(html).toContain('沉默者 · 待设计')
    expect(html).toContain('title="已有图像参考">档案室')
    expect(html).not.toContain('title="已有图像参考">来客')
    expect(generate).not.toHaveBeenCalled()
  })

  it('shows silent cast in prompt shortcuts while preserving uploaded references', () => {
    const insert = vi.fn()
    const html = renderToStaticMarkup(
      <ShotAssetShortcuts
        shot={shot}
        assets={assets}
        tasks={[]}
        prompt={shot.prompt}
        onInsert={insert}
        referenceImages={[{ url: '/manual.png', name: '我的参考' }]}
      />,
    )
    expect(html).toContain('aria-label="插入人物 沉默者"')
    expect(html).toContain('待设计')
    expect(html).not.toContain('aria-label="插入人物 来客"')
    expect(html).toContain('title="我的参考"')
    expect(html).toContain('src="/manual.png"')
    expect(insert).not.toHaveBeenCalled()
  })
})
