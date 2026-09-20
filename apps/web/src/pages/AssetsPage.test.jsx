import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AssetsPage } from './AssetsPage'

const project = {
  id: 'quick-host-test',
  name: '已交付作品',
  contentType: 'short-drama',
  aspectRatio: '9:16',
  visualStyle: 'cinematic-cg',
}
const episode = {
  id: 'episode-1',
  episodeNumber: 1,
  status: 'saved',
  content: '场次：S01｜角色：林澈｜场景：档案室｜动作：林澈打开档案。',
  continuityState: {},
}

describe('delivered script assets entry', () => {
  it('shows a ready-to-use extraction entry after script-only delivery into an empty project', () => {
    const scan = vi.fn()
    const create = vi.fn()
    const html = renderToStaticMarkup(
      <AssetsPage
        project={project}
        assets={[]}
        scriptEpisodes={[episode]}
        tasks={[]}
        billing={{ plan: 'free' }}
        onSuggestAssetsFast={scan}
        onCreate={create}
      />,
    )
    expect(html).toContain('剧本资产')
    expect(html).toContain('刷新剧本资料')
    expect(html).toContain('class="delivered-script-assets" open=""')
    expect(html).not.toContain('后台生成资产建议')
    expect(create).not.toHaveBeenCalled()
  })

  it('does not imply asset extraction is available for a draft-only or empty series', () => {
    for (const scriptEpisodes of [[], [{ ...episode, status: 'draft' }]]) {
      const html = renderToStaticMarkup(
        <AssetsPage
          project={project}
          assets={[]}
          scriptEpisodes={scriptEpisodes}
          tasks={[]}
          billing={{ plan: 'free' }}
          onSuggestAssetsFast={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      expect(html).not.toContain('class="delivered-script-assets"')
      expect(html).toContain('添加人物')
    }
  })

  it('keeps extraction available but collapsed after assets have been created', () => {
    const assets = [
      { id: 'asset-1', kind: 'scene', name: '档案室', sourceMode: 'generate', attributes: { type: 'scene' } },
    ]
    const html = renderToStaticMarkup(
      <AssetsPage
        project={project}
        assets={assets}
        scriptEpisodes={[episode]}
        tasks={[]}
        billing={{ plan: 'free' }}
        onSuggestAssetsFast={vi.fn()}
        onCreate={vi.fn()}
      />,
    )
    expect(html).toContain('class="delivered-script-assets"')
    expect(html).not.toContain('class="delivered-script-assets" open=')
  })
})
