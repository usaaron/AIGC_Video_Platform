import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FunctionStackPage } from './FunctionStackPage'

describe('function stack pages', () => {
  it.each([
    ['agent-studio', '对话一句成片', '一句成片 Agent 工作台'],
    ['image-studio', '图片大师', '图片大师预览'],
    ['writing-studio', '剧本大师', '剧本大师预览'],
  ])('renders %s as a standalone workspace', (tool, title, region) => {
    const html = renderToStaticMarkup(<FunctionStackPage tool={tool} />)

    expect(html).toContain(title)
    expect(html).toContain(`aria-label="${region}"`)
    expect(html).toContain(tool === 'agent-studio' ? '自动编排已启用' : 'UI 预览 · 开发中')
  })
})
