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

function imageSnapshot(views = ['front', 'side', 'back']) {
  const value = structuredClone(snapshot())
  value.contract.expectedArtifact = { type: 'image', count: 1 }
  value.contract.intent.mode = 'asset'
  value.evidence[0].details.provider = 'img2'
  value.evidence[0].details.completion.receipt = {
    version: 'seqora.provider-image-completion.v1',
    attestation: 'server-observed-completion',
    tenantId: 'tenant-1',
    projectId: 'project-1',
    taskId: 'task-1',
    provider: 'img2',
    providerName: 'tokenadvent-img2',
    requestId: 'private-image-idempotency-key',
    attempts: 2,
    completedAt: checkedAt,
    mediaVersion: receipt.mediaVersion,
    outputs: views.map((view, index) => ({
      view,
      storageKey: `private-image-storage-key-${view}`,
      contentType: 'image/png',
      size: (index + 1) * 1024,
      sha256: String(index + 1).repeat(64),
    })),
  }
  value.evidence[0].details.currentMediaProof = imageProof(value)
  return value
}

function imageProof(value, status = 'passed') {
  const outputs = value.evidence[0].details.completion.receipt.outputs
  return {
    status,
    reason: status === 'passed' ? 'verified' : status === 'failed' ? 'output-failed' : 'output-pending',
    expectedOutputCount: outputs.length,
    verifiedOutputCount: status === 'passed' ? outputs.length : outputs.length - 1,
    outputs: outputs.map((output, index) => ({
      view: output.view,
      storageProof: {
        status: index === outputs.length - 1 ? status : 'passed',
        reason:
          index !== outputs.length - 1 || status === 'passed'
            ? 'verified'
            : status === 'failed'
              ? 'checksum-mismatch'
              : 'read-timeout',
        contentType: output.contentType,
        expectedSize: output.size,
        actualSize: status === 'pending' && index === outputs.length - 1 ? null : output.size,
        expectedSha256: output.sha256,
        actualSha256:
          index !== outputs.length - 1 || status === 'passed'
            ? output.sha256
            : status === 'failed'
              ? 'f'.repeat(64)
              : null,
      },
    })),
  }
}

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
    { kind: 'image', provider: 'other' },
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

describe('image provider receipt display', () => {
  it.each([['single'], ['front', 'side', 'back']])(
    'summarizes %j output views without private identifiers',
    (...views) => {
      const value = imageSnapshot(views)
      const html = render(value)
      const display = providerCompletionReceiptView(value)
      expect(html).toContain('服务端完成回执已核验')
      expect(html).toContain('TokenAdvent / Image2')
      expect(html).toContain('回执覆盖视图')
      expect(html).toContain('当前全部图片字节通过核验')
      expect(html).toContain('正式下载仍仅包含当前主图（1 个图片文件）')
      expect(html).toContain('不会打包下载全部视图')
      expect(html).not.toContain('主视频')
      expect(display.receipt.viewCount).toBe(views.length)
      expect(display.receipt.outputs).toHaveLength(views.length)
      for (const secret of [
        'private-image-idempotency-key',
        'private-image-storage-key',
        'private-media-version',
        'requestId',
        'storageKey',
        'mediaVersion',
        '1'.repeat(64),
      ]) {
        expect(html).not.toContain(secret)
        expect(JSON.stringify(display)).not.toContain(secret)
      }
    },
  )

  it.each(['pending', 'failed', 'observed'])(
    'keeps final server %s status even with a valid image receipt',
    (status) => {
      const value = imageSnapshot()
      value.evidence[0].status = status
      expect(providerCompletionReceiptView(value).status).toBe(status)
      expect(render(value)).not.toContain('服务端完成回执已核验')
    },
  )

  it.each(['pending', 'failed'])('does not show passed when a secondary view is %s', (status) => {
    const value = imageSnapshot()
    value.evidence[0].details.currentMediaProof = imageProof(value, status)
    expect(providerCompletionReceiptView(value).status).toBe(status)
    expect(render(value)).not.toContain('服务端完成回执已核验')
    expect(render(value)).toContain(status === 'failed' ? '当前图片输出核验失败' : '当前图片输出仍待核验')
  })

  it.each(['absent', 'null', 'wrong-view', 'wrong-count', 'video-proof'])(
    'keeps incomplete image proof %s pending',
    (mode) => {
      const value = imageSnapshot()
      if (mode === 'absent') delete value.evidence[0].details.currentMediaProof
      if (mode === 'null') value.evidence[0].details.currentMediaProof = null
      if (mode === 'wrong-view') value.evidence[0].details.currentMediaProof.outputs[0].view = 'detail'
      if (mode === 'wrong-count') value.evidence[0].details.currentMediaProof.expectedOutputCount = 1
      if (mode === 'video-proof') value.evidence[0].details.currentMediaProof = proof('passed')
      expect(providerCompletionReceiptView(value).status).toBe('pending')
      expect(render(value)).not.toContain('服务端完成回执已核验')
    },
  )

  it.each([
    ['contentType', 'image/jpeg'],
    ['expectedSize', 1],
    ['expectedSha256', 'f'.repeat(64)],
    ['actualSize', 1],
    ['actualSha256', 'f'.repeat(64)],
    ['reason', 'checksum-mismatch'],
  ])('keeps a passed image proof with mismatched %s pending', (field, invalid) => {
    const value = imageSnapshot()
    value.evidence[0].details.currentMediaProof.outputs[1].storageProof[field] = invalid
    expect(providerCompletionReceiptView(value).status).toBe('pending')
    expect(render(value)).not.toContain('服务端完成回执已核验')
  })

  it('preserves final server failure when a current image proof mismatches the receipt', () => {
    const value = imageSnapshot()
    value.evidence[0].status = 'failed'
    value.evidence[0].details.currentMediaProof.outputs[1].storageProof.expectedSha256 = 'f'.repeat(64)
    expect(providerCompletionReceiptView(value).status).toBe('failed')
    expect(render(value)).not.toContain('服务端完成回执已核验')
  })

  it.each([
    'version',
    'provider',
    'providerName',
    'requestId',
    'tenant',
    'project',
    'task',
    'mediaVersion',
    'duplicate-view',
    'extra-field',
    'sha256',
    'empty-outputs',
  ])('rejects an invalid image receipt %s', (field) => {
    const value = imageSnapshot()
    const image = value.evidence[0].details.completion.receipt
    if (field === 'version') image.version = 'seqora.provider-completion.v1'
    if (field === 'provider') image.provider = 'seedance'
    if (field === 'providerName') image.providerName = 'dora-router-seedance'
    if (field === 'requestId') delete image.requestId
    if (field === 'tenant') image.tenantId = 'other-tenant'
    if (field === 'project') image.projectId = 'other-project'
    if (field === 'task') image.taskId = 'other-task'
    if (field === 'mediaVersion') image.mediaVersion = 'other-version'
    if (field === 'duplicate-view') image.outputs.push(image.outputs[0])
    if (field === 'extra-field') image.outputs[0].privateField = 'unexpected'
    if (field === 'sha256') image.outputs[0].sha256 = 'invalid'
    if (field === 'empty-outputs') image.outputs = []
    expect(providerCompletionReceiptView(value).status).toBe('pending')
    expect(render(value)).not.toContain('服务端完成回执已核验')
  })

  it('keeps historical image missing receipts pending and leaves old contracts unchanged', () => {
    const value = imageSnapshot()
    value.contract.must = [{ id: 'media-url', source: 'provider', statement: '历史主图可读' }]
    value.evidence[0].status = 'observed'
    value.evidence[0].details.completion = { reason: 'missing-receipt', receipt: null }
    const before = structuredClone(value)
    const html = render(value)
    expect(html).toContain('未纳入 Provider 完成回执要求')
    expect(html).toContain('不会自动补签')
    expect(html).toContain('正式下载仍仅包含当前主图')
    expect(html).not.toContain('服务端完成回执已核验')
    expect(value).toEqual(before)
  })

  it('shows a fixed image completion requirement and describes one-file download scope', () => {
    const html = renderToStaticMarkup(
      <ProviderCompletionRequirement job={{ kind: 'image', provider: 'img2' }} />,
    )
    expect(html).toContain('data-testid="provider-completion-required"')
    expect(html).toContain('checked=""')
    expect(html).toContain('disabled=""')
    expect(html).toContain('完整保存本次所有图片视图')
    expect(html).toContain('不会打包下载全部视图')
    expect(html).not.toContain('主视频')
  })
})
