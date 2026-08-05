import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectHomePage } from './ProjectHomePage'

const noop = () => {}

describe('project home', () => {
  it('keeps the project library focused on project management', () => {
    const html = renderToStaticMarkup(
      <ProjectHomePage projects={[]} onCreate={noop} onOpen={noop} onRename={noop} onDelete={noop} />,
    )

    expect(html).toContain('aria-label="项目列表"')
    expect(html).toContain('新建项目')
    expect(html).not.toContain('aria-label="功能栈"')
    expect(html).not.toContain('对话一句成片')
  })
})
