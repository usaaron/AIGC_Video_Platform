import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GenerationPage } from './GenerationPage'

describe('generation membership entry', () => {
  it('offers upgrades to a free personal account', () => {
    const html = renderToStaticMarkup(<GenerationPage jobs={[]} concurrency={1} member={false} />)
    expect(html).toContain('查看会员方案')
  })

  it('does not offer personal upgrades to an organization account', () => {
    const html = renderToStaticMarkup(
      <GenerationPage jobs={[]} concurrency={1} member={false} billingScope="organization" />,
    )
    expect(html).not.toContain('查看会员方案')
  })
})
