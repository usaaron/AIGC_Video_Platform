import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TrustedPortraitPanel } from './TrustedPortraitPanel'

const props = {
  assetId: 'test-character',
  attributes: {
    subjectType: 'human',
    portraitSource: 'ai-virtual',
    faceStatus: 'approved',
    faceReference: { id: 'test-face' },
    trustedPortrait: null,
  },
}

describe('trusted portrait provider capabilities', () => {
  it.each(['AIGC', 'LivenessFace'])('explains source-image video compatibility for %s', (groupType) => {
    const html = renderToStaticMarkup(
      <TrustedPortraitPanel
        {...props}
        attributes={{
          ...props.attributes,
          trustedPortrait: { assetId: 'test', status: 'active', groupType },
        }}
        configuration={{
          configured: true,
          realValidationReady: false,
          virtualRegistrationReady: true,
          videoReferenceMode: 'source-image',
        }}
      />,
    )
    expect(html).toContain(groupType === 'AIGC' ? '使用已确认的面部原图' : '暂不能用于生成')
    expect(html).not.toContain('后续视频任务会自动使用这个人像资源')
  })
  it('keeps AI registration available and explains unavailable real-person verification', () => {
    const html = renderToStaticMarkup(
      <TrustedPortraitPanel
        {...props}
        configuration={{ configured: true, virtualRegistrationReady: true, realValidationReady: false }}
      />,
    )
    expect(html).toContain('创建 AI 人像资源')
    expect(html).toContain('当前未开放新建真人认证')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?真人认证暂未开放/)
    expect(html).toContain('已有授权真人资源')
    expect(html).not.toContain('用手机完成一次真人认证')
  })

  it('only enables real-person verification when the provider declares support', () => {
    const html = renderToStaticMarkup(
      <TrustedPortraitPanel
        {...props}
        configuration={{ configured: true, virtualRegistrationReady: true, realValidationReady: true }}
      />,
    )
    const button = html.match(/<button[^>]*class="button primary"[^>]*>/)?.[0]
    expect(button).toBeDefined()
    expect(button).not.toContain('disabled')
    expect(html).toContain('请由演员本人完成认证')
  })

  it('keeps verification disabled until capabilities have loaded', () => {
    const html = renderToStaticMarkup(<TrustedPortraitPanel {...props} />)
    expect(html.match(/<button[^>]*class="button primary"[^>]*>/)?.[0]).toContain('disabled')
  })

  it('identifies active AI portraits as library assets and explains independent video review', () => {
    const html = renderToStaticMarkup(
      <TrustedPortraitPanel
        {...props}
        attributes={{
          ...props.attributes,
          trustedPortrait: { assetId: 'ai-1', groupType: 'AIGC', status: 'active' },
        }}
        configuration={{
          configured: true,
          videoReferenceMode: 'source-image',
          virtualRegistrationReady: true,
          realValidationReady: false,
        }}
      />,
    )
    expect(html).toContain('AI人物已入库')
    expect(html).toContain('当前视频通道仍会独立审核生成内容')
    expect(html).not.toContain('AI 人像已可用')
    expect(html).not.toContain('确认面部后自动加白')
    expect(html).toContain('未确认全身造型，视频服装和体型可能变化')
  })

  it('does not mark an unapproved real portrait as authorized or warn after body confirmation', () => {
    const html = renderToStaticMarkup(
      <TrustedPortraitPanel
        {...props}
        attributes={{
          ...props.attributes,
          bodyStatus: 'approved',
          trustedPortrait: { assetId: 'real-1', groupType: 'LivenessFace', status: 'processing' },
        }}
        configuration={{ configured: true, videoReferenceMode: 'asset-uri' }}
      />,
    )
    expect(html).not.toContain('真人授权素材已入库')
    expect(html).not.toContain('未确认全身造型')
    expect(html).not.toContain('当前视频通道仍会独立审核生成内容')
  })
})
