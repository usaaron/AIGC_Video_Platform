import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { scriptMasterFrameUrl, SeriesCreationWorkspace } from './ScriptMasterWorkspace'

describe('embedded script workspace address', () => {
  const origin = 'https://studio.example'
  it('preserves the authenticated project launch on the host service', () => {
    const launchUrl = '/script-master?host_project_id=one#host_token=test-ticket'
    expect(scriptMasterFrameUrl({ enabled: true, launchUrl }, origin)).toBe(origin + launchUrl)
  })
  it('does not send a launch ticket to another origin or another application', () => {
    for (const launchUrl of [
      'https://other.example/script-master',
      '//other.example/script-master',
      'javascript:alert(1)',
      '/admin/',
      '/script-master-fake',
      'https://user:pass@studio.example/script-master',
    ]) {
      expect(() => scriptMasterFrameUrl({ enabled: true, launchUrl }, origin)).toThrow()
    }
    expect(() => scriptMasterFrameUrl({ enabled: false }, origin)).toThrow('暂未配置')
  })
})

describe('series creation and delivered versions', () => {
  function renderWorkspace(props = {}) {
    return renderToStaticMarkup(
      <SeriesCreationWorkspace projectId="series-one" episodeCount={0} view="creation" {...props} />,
    )
  }

  it('keeps creation primary and makes the delivered copy a secondary destination', () => {
    const html = renderWorkspace({ episodeCount: 3 })
    expect(html).toContain('<strong>剧本创作</strong>')
    expect(html).toContain('查看用于资产与分镜制作的剧本版本')
    expect(html).toContain('<span>已交付版本</span><small>3 集</small>')
    expect(html).toContain('aria-label="网剧创作工作台"')
    expect(html).not.toContain('暂无已交付剧集')
  })

  it('explains the empty delivery state while retaining the creation workspace', () => {
    const html = renderWorkspace({ view: 'production' })
    expect(html).toContain('暂无已交付剧集')
    expect(html).toContain('同步已保存的分集正文')
    expect(html).toContain('此处编辑不会回写「剧本创作」')
    expect(html).toContain('返回剧本创作')
    expect(html).toContain('class="series-creation-pane" hidden=""')
    expect(html).toContain('aria-label="网剧创作工作台"')
  })

  it('protects navigation during a pending save and shows the existing delivered count', () => {
    const html = renderWorkspace({ view: 'production', episodeCount: 2, busy: true })
    expect(html).toContain('<strong>已交付版本</strong><small>2 集</small>')
    expect(html).toContain('class="series-workspace-secondary" disabled=""')
    expect(html).toContain('此处编辑不会回写「剧本创作」')
    expect(html).not.toContain('暂无已交付剧集')
  })
})
