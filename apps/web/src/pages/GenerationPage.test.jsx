import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  buildDeliveryContractDraft,
  canFreezeDeliveryContract,
  DeliveryContractFreezeDialog,
  DeliveryVerificationDialog,
  GenerationPage,
} from './GenerationPage'

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

  it('builds a server-hashed shot contract draft from a completed video task', () => {
    const task = {
      id: 'task-1',
      projectId: 'project-1',
      kind: 'video',
      status: 'completed',
      resultUrl: '/media/task-1.mp4',
      metadata: { shotId: 'shot-1', rigidPhysicsAudit: { status: 'failed' } },
    }
    const draft = buildDeliveryContractDraft(task)

    expect(canFreezeDeliveryContract(task)).toBe(true)
    expect(draft).toMatchObject({
      version: 'seqora.delivery.v1',
      contractHash: null,
      frozenAt: null,
      intent: { mode: 'shot', projectId: 'project-1', shotIds: ['shot-1'] },
      expectedArtifact: { type: 'video', count: 1 },
    })
    expect(draft.must.map((item) => item.id)).toEqual(['task-completed', 'media-url', 'physical-review'])
  })

  it('only exposes the freeze action for an unfrozen completed video result', () => {
    const base = {
      projectId: 'project-1',
      kind: 'video',
      status: 'completed',
      resultUrl: '/media/task-1.mp4',
      metadata: {},
    }
    expect(canFreezeDeliveryContract(base)).toBe(true)
    expect(canFreezeDeliveryContract({ ...base, kind: 'image' })).toBe(false)
    expect(canFreezeDeliveryContract({ ...base, metadata: { deliveryContract: { contractHash: 'a'.repeat(64) } } })).toBe(
      false,
    )
  })

  it('shows the formal freeze review and server-owned hash boundary', () => {
    const html = renderToStaticMarkup(
      <DeliveryContractFreezeDialog
        dialog={{
          job: { label: '镜头 01', metadata: {} },
          draft: buildDeliveryContractDraft({
            projectId: 'project-1',
            kind: 'video',
            status: 'completed',
            resultUrl: '/media/task-1.mp4',
            metadata: {},
          }),
          status: 'editing',
          result: null,
          error: '',
        }}
        onClose={() => undefined}
        onSubmit={() => undefined}
        onTogglePhysicalReview={() => undefined}
      />,
    )

    expect(html).toContain('正式业务入口')
    expect(html).toContain('确认冻结合同')
    expect(html).toContain('服务器会在冻结时生成时间戳和合同哈希。')
    expect(html).not.toContain('a'.repeat(64))
  })
})
