import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageStudioPage } from './ImageStudioPage'

describe('ImageStudioPage', () => {
  it('surfaces the provider unavailable state without exposing any key UI', () => {
    const html = renderToStaticMarkup(
      <ImageStudioPage
        project={{ id: 'project-1', name: 'Demo Project' }}
        billing={{ billingScope: 'project', credits: 24 }}
        tasks={[]}
        image2ProviderStatus="local-mock"
      />,
    )

    expect(html).toContain('序幕 image2 服务尚未配置')
    expect(html).toContain('aria-label="序幕 image2 工作台"')
    expect(html).toContain('aria-label="结果画廊"')
    expect(html).toContain('aria-label="提示词编写"')
    expect(html).toContain('aria-label="生成设置"')
    expect(html).toContain('图片尺寸')
    expect(html).toContain('自适应 auto')
    expect(html).toContain('2160×3840')
    expect(html).not.toContain('API Key')
    expect(html).not.toContain('API 地址')
    expect(html).not.toContain('等待第一个 image2 批次')
    expect(html.indexOf('aria-label="结果画廊"')).toBeLessThan(html.indexOf('aria-label="提示词编写"'))
    expect(html.indexOf('aria-label="生成设置"')).toBeLessThan(html.indexOf('提交批次'))
  })
})
