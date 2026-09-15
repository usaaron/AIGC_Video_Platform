import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FunctionStackPage } from './FunctionStackPage'

describe('function stack pages', () => {
  it.each([
    ['agent-studio', '对话一句成片', '一句成片 Agent 工作台'],
    ['writing-studio', '剧本大师', '剧本大师工作台'],
  ])('renders %s as a standalone workspace', (tool, title, region) => {
    const html = renderToStaticMarkup(<FunctionStackPage tool={tool} />)

    expect(html).toContain(title)
    expect(html).toContain(`aria-label="${region}"`)
    expect(html).toContain(tool === 'agent-studio' ? '自动编排已启用' : '正在打开剧本大师')
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
