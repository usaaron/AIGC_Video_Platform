import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectHomePage } from './ProjectHomePage'

const noop = () => {}

describe('project home', () => {
  it('renders a dedicated welcome experience before the first project', () => {
    const html = renderToStaticMarkup(
      <ProjectHomePage projects={[]} onCreate={noop} onOpen={noop} onRename={noop} onDelete={noop} />,
    )

    expect(html).toContain('aria-label="新项目欢迎页"')
    expect(html).toContain('欢迎来到序幕 TV')
    expect(html).toContain('创建第一个项目')
    expect(html).toContain('“序幕起，')
    expect(html).not.toContain('aria-label="项目列表"')
    expect(html).not.toContain('aria-label="功能栈"')
  })

  it('keeps the populated project library focused on project management', () => {
    const html = renderToStaticMarkup(
      <ProjectHomePage
        projects={[
          {
            id: 'project-1',
            name: '天穹回想',
            contentType: 'short-drama',
            visualStyle: 'cinematic-cg',
            aspectRatio: '9:16',
            updatedAt: '2026-08-10T00:00:00.000Z',
            previewUrl: null,
            generationSummary: null,
          },
        ]}
        onCreate={noop}
        onOpen={noop}
        onRename={noop}
        onDelete={noop}
      />,
    )

    expect(html).toContain('aria-label="项目列表"')
    expect(html).toContain('天穹回想')
    expect(html).not.toContain('aria-label="新项目欢迎页"')
  })
})
