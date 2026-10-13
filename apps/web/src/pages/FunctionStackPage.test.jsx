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

  it('keeps the standalone script master isolated from the host project', () => {
    const html = renderToStaticMarkup(<FunctionStackPage tool="writing-studio" />)

    expect(html).toContain('独立剧本大师工作台')
    expect(html).not.toContain('host_project_id')
  })

  it('renders image-studio as the formal image2 workspace', () => {
    const html = renderToStaticMarkup(<FunctionStackPage tool="image-studio" />)

    expect(html).toContain('生图大师')
    expect(html).toContain('aria-label="生图大师工作台"')
    expect(html).not.toContain('UI 预览 · 开发中')
  })
})
