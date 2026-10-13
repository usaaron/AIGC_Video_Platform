import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeliveryVerificationDialog, GenerationPage } from './GenerationPage'

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

  it('shows scoped verification results without offering a write action', () => {
    const html = renderToStaticMarkup(
      <DeliveryVerificationDialog
        dialog={{
          job: { label: '镜头 01' },
          status: 'ready',
          error: '',
          snapshot: {
            contract: { contractHash: 'a'.repeat(64) },
            evidence: [{}, {}],
            verification: {
              status: 'partial',
              rationale: '部分交付要求已通过，其余要求仍待证据',
              satisfiedRequirementIds: ['media-url'],
              pendingRequirementIds: ['content-review'],
              failedRequirementIds: [],
            },
          },
        }}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('部分要求已满足')
    expect(html).toContain('content-review')
    expect(html).not.toContain('保存')
  })
})
