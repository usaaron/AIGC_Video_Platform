import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderCompletionReceipt, ProviderCompletionRequirement } from './ProviderCompletionReceipt'
import { providerCompletionReceiptView } from './providerCompletionView'

const checkedAt = '2026-10-14T10:00:00.000Z'
const receipt = {
  version: 'seqora.provider-completion.v1',
  attestation: 'server-observed-completion',
  tenantId: 'tenant-1',
  projectId: 'project-1',
  taskId: 'task-1',
  provider: 'seedance',
  providerName: 'dora-router-seedance',
  providerTaskId: 'private-upstream-task-id',
  attempts: 2,
  completedAt: checkedAt,
  mediaVersion: 'private-media-version',
  media: {
    view: 'single',
    storageKey: 'private-storage-key',
    contentType: 'video/mp4',
    size: 1024 * 1024,
    sha256: 'a'.repeat(64),
  },
}

function snapshot(overrides = {}) {
  return {
    taskId: 'task-1',
    contract: {
      version: 'seqora.delivery.v1',
      contractHash: 'b'.repeat(64),
      frozenAt: checkedAt,
      intent: { mode: 'shot', projectId: 'project-1', episodeId: null, shotIds: [] },
      expectedArtifact: { type: 'video', count: 1 },
      must: [{ id: 'provider-completed', statement: '服务端完成回执', source: 'provider' }],
    },
    evidence: [
      {
        evidenceId: 'provider-evidence',
        kind: 'provider',
        status: 'passed',
        requirementIds: ['provider-accepted', 'provider-completed'],
        refType: 'provider-task',
        refId: 'task-1',
        observedAt: checkedAt,
        scope: {
          tenantId: 'tenant-1',
          projectId: 'project-1',
          taskId: 'task-1',
          taskUpdatedAt: checkedAt,
          mediaVersion: receipt.mediaVersion,
        },
        details: { provider: 'seedance', completion: { reason: 'verified', receipt }, ...overrides },
      },
    ],
    verification: null,
  }
}

function proof(status) {
  return {
    status,
    reason:
      status === 'failed' ? 'checksum-mismatch' : status === 'pending' ? 'storage-unavailable' : 'verified',
    contentType: 'video/mp4',
    expectedSize: receipt.media.size,
    actualSize: receipt.media.size,
    expectedSha256: receipt.media.sha256,
    actualSha256: status === 'failed' ? 'f'.repeat(64) : receipt.media.sha256,
  }
}

const render = (value) => renderToStaticMarkup(<ProviderCompletionReceipt snapshot={value} enabled />)

describe('server provider receipt display', () => {
  it('renders a passed server observation with a minimal safe summary', () => {
    const value = snapshot({ secretExtraField: 'private-metadata-value' })
    const html = render(value)
    expect(html).toContain('data-status="passed"')
    expect(html).toContain('服务端完成回执已核验')
    expect(html).toContain('DoraRouter / Seedance')
    expect(html).toContain('第 2 次')
    expect(html).toContain('2026-10-14 10:00:00 UTC')
    expect(html).toContain('1.0 MiB')
    expect(html).toContain('aaaaaaaaaaaa…aaaaaaaa')
    expect(html).toContain('此回执不代表上游签名或内容质量验收')
    for (const secret of [
      'private-upstream-task-id',
      'private-storage-key',
      'private-media-version',
      'private-metadata-value',
      'storageKey',
      'mediaVersion',
      'a'.repeat(64),
    ]) {
      expect(html).not.toContain(secret)
      expect(JSON.stringify(providerCompletionReceiptView(value))).not.toContain(secret)
    }
  })

  it.each(['pending', 'failed', 'observed'])(
    'never upgrades server %s evidence just because a receipt exists',
    (status) => {
      const value = snapshot()
      value.evidence[0].status = status
      expect(providerCompletionReceiptView(value).status).toBe(status)
      expect(render(value)).not.toContain('服务端完成回执已核验')
    },
  )

  it.each(['pending', 'failed'])('downgrades passed receipts when current media is %s', (status) => {
    const value = snapshot({ currentMediaProof: proof(status) })
    const html = render(value)
    expect(providerCompletionReceiptView(value).status).toBe(status)
    expect(html).not.toContain('服务端完成回执已核验')
    expect(html).toContain(status === 'failed' ? '当前主视频媒体核验失败' : '当前主视频媒体仍待核验')
  })

  it.each([null, {}, { status: 'passed' }, { status: 'green' }])(
    'keeps malformed current media proof pending: %j',
    (currentMediaProof) => {
      const value = snapshot({ currentMediaProof })
      expect(providerCompletionReceiptView(value).status).toBe('pending')
      expect(render(value)).not.toContain('服务端完成回执已核验')
    },
  )

  it('cannot upgrade failed server evidence with a passed current-media proof', () => {
    const value = snapshot({ currentMediaProof: proof('passed') })
    value.evidence[0].status = 'failed'
    expect(providerCompletionReceiptView(value).status).toBe('failed')
  })

  it('states that a legacy contract omitted this requirement without changing its delivery result', () => {
    const value = snapshot()
    value.contract.must = [{ id: 'task-completed', statement: '任务完成', source: 'system' }]
    value.evidence[0].status = 'observed'
    value.evidence[0].details.completion = { reason: 'missing-receipt', receipt: null }
    const before = structuredClone(value)
    expect(render(value)).toContain('此冻结合同未纳入 Provider 完成回执要求')
    expect(render(value)).toContain('整体交付以服务器门禁为准')
    expect(render(value)).not.toContain('不能交付')
    expect(value).toEqual(before)
  })

  it('recognizes provider-accepted in a legacy contract as an existing receipt requirement', () => {
    const value = snapshot()
    value.contract.must[0].id = 'provider-accepted'
    expect(providerCompletionReceiptView(value).contractRequirement).toBe('required')
    expect(render(value)).not.toContain('未纳入')
  })

  it.each(['missing-receipt', 'invalid-receipt', 'receipt-mismatch', 'task-not-completed'])(
    'explains %s without claiming a trusted receipt',
    (reason) => {
      const value = snapshot({ completion: { reason, receipt: null } })
      value.evidence[0].status = reason === 'missing-receipt' ? 'observed' : 'pending'
      const html = render(value)
      expect(html).not.toContain('服务端完成回执已核验')
      expect(html).toContain('不会自动补签')
      expect(html).toContain('不会自动付费重新生成')
      if (reason === 'task-not-completed') expect(html).toContain('任务尚未完成')
      if (reason === 'invalid-receipt' || reason === 'receipt-mismatch')
        expect(html).toContain('回执无效或与当前任务媒体不一致')
    },
  )

  it.each([
    'receipt',
    'scope',
    'project',
    'refId',
    'refType',
    'requirements',
    'duplicate',
    'evidence',
    'task',
  ])('fails closed on mismatched or malformed %s', (field) => {
    const value = structuredClone(snapshot())
    if (field === 'receipt') value.evidence[0].details.completion.receipt.media.sha256 = 'invalid'
    if (field === 'scope') value.evidence[0].scope.mediaVersion = 'different-version'
    if (field === 'project') value.contract.intent.projectId = 'other-project'
    if (field === 'refId') value.evidence[0].refId = 'other-task'
    if (field === 'refType') value.evidence[0].refType = 'generation-task'
    if (field === 'requirements') value.evidence[0].requirementIds = ['media-url']
    if (field === 'duplicate') value.evidence.push(value.evidence[0])
    if (field === 'evidence') value.evidence = [null, { kind: 'provider', status: 'passed' }]
    if (field === 'task') value.taskId = 'other-task'
    expect(providerCompletionReceiptView(value, true).status).toBe('pending')
    expect(render(value)).not.toContain('服务端完成回执已核验')
  })

  it.each([undefined, null, {}, { evidence: 'wrong' }, { evidence: [null, false] }])(
    'renders missing or malformed snapshots conservatively: %j',
    (value) => {
      expect(() => render(value)).not.toThrow()
      expect(render(value)).toContain('完成回执待补证据')
      expect(render(value)).not.toContain('服务端完成回执已核验')
    },
  )

  it.each([
    { kind: 'image', provider: 'img2' },
    { kind: 'video', provider: 'local-compose' },
    { kind: 'video', provider: 'other' },
  ])('does not add a mandatory provider receipt checkbox for $kind/$provider', (job) => {
    expect(renderToStaticMarkup(<ProviderCompletionRequirement job={job} />)).toBe('')
  })

  it('does not invent a receipt panel for unrelated provider evidence', () => {
    const value = snapshot()
    value.contract = null
    value.evidence[0].details.provider = 'local-compose'
    expect(providerCompletionReceiptView(value)).toBeNull()
  })
})
