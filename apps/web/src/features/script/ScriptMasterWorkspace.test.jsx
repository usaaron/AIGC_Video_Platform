import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  createHostNavigationMessage,
  embeddedScriptMasterFrameUrl,
  scriptMasterFrameUrl,
  standaloneScriptMasterFrameUrl,
  SeriesCreationWorkspace,
} from './ScriptMasterWorkspace'

describe('embedded script workspace address', () => {
  const origin = 'https://studio.example'
  it('preserves the authenticated project launch on the host service', () => {
    const launchUrl = '/script-master?host_project_id=one#host_token=test-ticket'
    expect(scriptMasterFrameUrl({ enabled: true, launchUrl }, origin)).toBe(origin + launchUrl)
  })

  it('keeps an independent launch free of a host project binding', () => {
    const launchUrl = '/script-master#host_token=test-ticket'
    const scope = { surface: 'standalone', projectId: null }
    const launch = { enabled: true, surface: 'standalone', launchUrl, project: null }
    expect(scriptMasterFrameUrl(launch, origin, scope)).toBe(origin + launchUrl)
    for (const changed of [
      { surface: 'embedded' },
      { project: { id: 'project-1' } },
      { launchUrl: '/script-master?host_project_id=project-1#host_token=test-ticket' },
    ]) {
      expect(() => scriptMasterFrameUrl({ ...launch, ...changed }, origin, scope)).toThrow('范围不一致')
    }
  })

  it('uses the stable standalone entry so the iframe owns its single auth launch', () => {
    expect(standaloneScriptMasterFrameUrl(origin)).toBe(
      origin + '/script-master?surface=standalone&module=standalone',
    )
  })

  it('uses a stable project-scoped entry so the iframe owns its single auth launch', () => {
    expect(embeddedScriptMasterFrameUrl(origin, 'project-1')).toBe(
      origin + '/script-master?surface=embedded&module=project-script&host_project_id=project-1',
    )
    expect(() => embeddedScriptMasterFrameUrl(origin, '')).toThrow('请先进入一个主项目')
  })

  it('uses the host navigation protocol understood by the embedded script master', () => {
    expect(createHostNavigationMessage({ projectId: 'one', view: 'storyboard' })).toEqual({
      type: 'seqora:host:navigate',
      surface: 'embedded',
      projectId: 'one',
      view: 'storyboard',
    })
    expect(createHostNavigationMessage({ projectId: 'one', view: 'unsupported' })).toEqual({
      type: 'seqora:host:navigate',
      surface: 'embedded',
      projectId: 'one',
      view: 'script',
    })
  })

  it('only accepts the project requested by the embedded workspace', () => {
    const scope = { surface: 'embedded', projectId: 'one' }
    const launch = {
      enabled: true,
      surface: 'embedded',
      project: { id: 'one' },
      launchUrl: '/script-master?host_project_id=one#host_token=test-ticket',
    }
    expect(scriptMasterFrameUrl(launch, origin, scope)).toBe(origin + launch.launchUrl)
    expect(() => scriptMasterFrameUrl(launch, origin, { ...scope, projectId: 'two' })).toThrow('范围不一致')
  })
  it('rejects a launch URL whose surface or legacy module alias disagrees with the ticket', () => {
    const scope = { surface: 'standalone', projectId: null }
    const launch = {
      enabled: true,
      surface: 'standalone',
      module: 'standalone',
      project: null,
      launchUrl: '/script-master?surface=embedded&module=project-script#host_token=test-ticket',
    }
    expect(() => scriptMasterFrameUrl(launch, origin, scope)).toThrow('范围不一致')
    expect(() => scriptMasterFrameUrl({
      ...launch,
      launchUrl: '/script-master?surface=standalone&module=project-script#host_token=test-ticket',
    }, origin, scope)).toThrow('范围不一致')
    expect(() => scriptMasterFrameUrl({
      ...launch,
      launchUrl: '/script-master?surface=standalone&module=standalone&host_project_id=main#host_token=test-ticket',
    }, origin, scope)).toThrow('范围不一致')
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
    expect(html).not.toContain('class="series-creation-pane"')
    expect(html).not.toContain('aria-label="网剧创作工作台"')
  })

  it('protects navigation during a pending save and shows the existing delivered count', () => {
    const html = renderWorkspace({ view: 'production', episodeCount: 2, busy: true })
    expect(html).toContain('<strong>已交付版本</strong><small>2 集</small>')
    expect(html).toContain('class="series-workspace-secondary" disabled=""')
    expect(html).toContain('此处编辑不会回写「剧本创作」')
    expect(html).not.toContain('暂无已交付剧集')
  })
})
