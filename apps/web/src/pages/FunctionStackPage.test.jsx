import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FunctionStackPage } from './FunctionStackPage'

describe('function stack pages', () => {
  it('keeps one-line filmmaking unavailable and offers the project workflow', () => {
    const html = renderToStaticMarkup(<FunctionStackPage tool="agent-studio" />)
    expect(html).toContain('一句成片筹备中')
    expect(html).toContain('筹备中 · 暂未开放')
    expect(html).toContain('前往项目创作')
    expect(html).not.toContain('制作任务')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('开始制作')
  })

  it('shows a safe connection state while the external module is unavailable', () => {
    const html = renderToStaticMarkup(<FunctionStackPage tool="writing-studio" />)

    expect(html).toContain('正在准备你的剧本工作台…')
    expect(html).toContain('返回单集剧本')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('长剧本能力尚未接入当前版本')
  })

  it('renders image-studio as the formal image2 workspace', () => {
    const html = renderToStaticMarkup(<FunctionStackPage tool="image-studio" />)

    expect(html).toContain('生图大师')
    expect(html).toContain('aria-label="生图大师工作台"')
    expect(html).not.toContain('UI 预览 · 开发中')
  })
})
