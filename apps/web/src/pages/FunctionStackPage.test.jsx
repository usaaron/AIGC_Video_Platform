import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FunctionStackPage } from './FunctionStackPage'

describe('function stack pages', () => {
  it.each([
    ['agent-studio', '对话一句成片', '一句成片 Agent 工作台'],
    ['writing-studio', '剧本大师', '剧本大师接入说明'],
  ])('renders %s as a standalone workspace', (tool, title, region) => {
    const html = renderToStaticMarkup(<FunctionStackPage tool={tool} />)

    expect(html).toContain(title)
    expect(html).toContain(`aria-label="${region}"`)
    expect(html).toContain(tool === 'agent-studio' ? '自动编排已启用' : '外部模块 · 等待接入')
  })

  it('does not present fake long-form progress while the external module is unavailable', () => {
    const html = renderToStaticMarkup(<FunctionStackPage tool="writing-studio" />)

    expect(html).toContain('返回单集剧本')
    expect(html).toContain('不会创建生成任务')
    expect(html).not.toContain('结构草稿 · 自动保存')
    expect(html).not.toContain('当前阶段')
  })

  it('renders image-studio as the formal image2 workspace', () => {
    const html = renderToStaticMarkup(<FunctionStackPage tool="image-studio" />)

    expect(html).toContain('生图大师')
    expect(html).toContain('aria-label="生图大师工作台"')
    expect(html).not.toContain('UI 预览 · 开发中')
  })
})
