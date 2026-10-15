import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TextCompletionDialog } from './TextCompletionDialog'

const scope = {
  taskId: 'task-1',
  projectId: 'project-1',
  tenantId: 'tenant-1',
  taskStatus: 'completed',
  taskUpdatedAt: '2026-10-15T02:00:01.000Z',
}
const base = {
  version: 'seqora.text-completion-query.v1',
  ...scope,
  checkedAt: '2026-10-15T02:00:02.000Z',
  reason: 'missing-receipt',
  receipt: null,
}
const call = {
  sequence: 1,
  model: 'test-model',
  stage: 'first-draft',
  responseSha256: 'd'.repeat(64),
  responseBytes: 24,
  observation: 'adapter-returned',
}
const receipt = {
  version: 'seqora.text-completion.v1',
  attestation: 'server-observed-text-result',
  tenantId: scope.tenantId,
  projectId: scope.projectId,
  taskId: scope.taskId,
  userId: 'private-user-id',
  clientRequestId: 'private-request-id',
  attempts: 2,
  model: 'private-top-level-model',
  operation: 'generate',
  completedAt: '2026-10-15T02:00:00.000Z',
  resultSha256: 'a'.repeat(64),
  resultBytes: 2000,
  units: [
    {
      unitId: 'script',
      source: 'provider-derived',
      resultSha256: 'b'.repeat(64),
      resultBytes: 1000,
      providerCalls: [call],
    },
    {
      unitId: 'episode:2',
      source: 'mixed',
      resultSha256: 'c'.repeat(64),
      resultBytes: 500,
      providerCalls: [{ ...call, sequence: 2, model: null, stage: null }],
    },
    {
      unitId: 'episode:3',
      source: 'retained-input',
      resultSha256: 'e'.repeat(64),
      resultBytes: 100,
      providerCalls: [
        {
          ...call,
          sequence: 3,
          responseBytes: 0,
          responseSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
    },
    {
      unitId: 'episode:4',
      source: 'local-derived',
      resultSha256: 'f'.repeat(64),
      resultBytes: 100,
      providerCalls: [],
    },
    {
      unitId: 'episode:5',
      source: 'reused-episode',
      resultSha256: '0'.repeat(64),
      resultBytes: 100,
      providerCalls: [],
    },
  ],
}

function render(snapshot = base, changes = {}) {
  return renderToStaticMarkup(
    <TextCompletionDialog
      dialog={{
        job: {
          label: '历史文本任务',
          metadata: {
            textCompletionReceipt: { secret: 'forged-metadata-receipt' },
            textResult: 'raw-result-secret',
            leaseToken: 'lease-secret',
          },
        },
        scope,
        status: 'ready',
        snapshot,
        error: '',
        ...changes,
      }}
      onClose={() => {}}
      onRetry={() => {}}
    />,
  )
}

describe('read-only text completion dialog', () => {
  it('shows all source categories, totals, timestamps, hashes, bytes, and collapsed call details', () => {
    const html = render({ ...base, reason: 'verified', receipt })
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="文本结果来源"')
    expect(html).toContain('data-testid="text-completion-receipt"')
    expect(html).toContain('data-reason="verified"')
    expect(html).toContain('data-status="verified"')
    expect(html).toContain('来源记录已核验')
    for (const label of ['模型输出', '混合生成', '保留原文', '本地处理', '复用剧集'])
      expect(html).toContain(label)
    expect(html).toContain('<dt>结果单元</dt><dd>5 项</dd>')
    expect(html).toContain('<dt>已返回调用</dt><dd>3 次</dd>')
    expect(html).toContain('2,000 字节')
    expect(html).toContain('2026-10-15T02:00:00.000Z')
    expect(html).toContain('2026-10-15T02:00:02.000Z')
    expect(html).toContain('a'.repeat(64))
    expect(html).toContain('d'.repeat(64))
    expect(html).toContain('<details class="text-completion-details">')
    expect(html).not.toContain('open=""')
    expect(html).toContain('查看 5 个结果单元与调用详情')
    expect(html).toContain('test-model')
    expect(html).toContain('first-draft')
    expect(html).toContain('逻辑模型：未记录')
    expect(html).toContain('逻辑模型：test-model')
    expect(html).toContain('返回文本 0 字节')
    expect(html).toContain('可能包含未采用的候选或空响应')
  })

  it('makes the historical scope and non-approval boundary explicit without adding delivery actions', () => {
    const html = render({ ...base, reason: 'verified', receipt })
    expect(html).toContain('历史结果快照')
    expect(html).toContain('当前可编辑剧本可能已变化')
    expect(html).toContain('不等于上游认证、内容质量验收或正式交付授权')
    expect(html).toContain('规范 JSON 结果')
    expect(html).toContain('UTF-8')
    expect(html).toContain('逻辑模型是请求使用的模型标识，不代表上游实际模型认证')
    expect(html).toContain('重新核验')
    expect(html).toContain('aria-label="关闭"')
    expect(html).not.toContain('下载')
    expect(html).not.toContain('冻结')
    expect(html).not.toContain('href=')
    for (const privateValue of [
      'private-user-id',
      'private-request-id',
      'private-top-level-model',
      'forged-metadata-receipt',
      'raw-result-secret',
      'lease-secret',
    ])
      expect(html).not.toContain(privateValue)
  })

  it.each([
    ['missing-receipt', '未记录来源回执', 'pending'],
    ['invalid-receipt', '来源记录核验失败', 'failed'],
    ['receipt-mismatch', '来源记录与任务不一致', 'failed'],
  ])('keeps %s conservative even when task metadata advertises a receipt', (reason, label, status) => {
    const html = render({ ...base, reason })
    expect(html).toContain('data-reason="' + reason + '"')
    expect(html).toContain('data-status="' + status + '"')
    expect(html).toContain(label)
    expect(html).not.toContain('data-testid="text-completion-details"')
    expect(html).not.toContain('来源记录已核验')
    expect(html).not.toContain('forged-metadata-receipt')
  })

  it.each(['queued', 'paused', 'running', 'failed', 'cancelled'])(
    'does not claim completion for a %s task',
    (taskStatus) => {
      const html = render(
        { ...base, taskStatus, reason: 'task-not-completed' },
        { scope: { ...scope, taskStatus } },
      )
      expect(html).toContain('data-reason="task-not-completed"')
      expect(html).toContain('任务尚未完成')
      expect(html).not.toContain('data-testid="text-completion-details"')
    },
  )

  it.each([
    { ...base, reason: 'verified' },
    { ...base, receipt },
    { ...base, reason: 'verified', receipt: { ...receipt, taskId: 'different-task' } },
    { ...base, reason: 'verified', receipt: { ...receipt, hidden: 'server-secret' } },
    { ...base, checkedAt: 'invalid' },
    { ...base, reason: 'verified', receipt, extra: 'server-secret' },
    { ...base, taskUpdatedAt: '2026-10-15T02:00:03.000Z' },
  ])('rejects malformed or mismatched snapshots without exposing receipt details', (snapshot) => {
    const html = render(snapshot)
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('data-testid="text-completion-receipt"')
    expect(html).not.toContain('data-testid="text-completion-details"')
    expect(html).not.toContain('server-secret')
    expect(html).not.toContain('a'.repeat(64))
  })

  it.each([undefined, {}, { ...scope, tenantId: '' }])(
    'requires complete local scope even when rendering a verified snapshot directly',
    (invalidScope) => {
      const html = render({ ...base, reason: 'verified', receipt }, { scope: invalidScope })
      expect(html).toContain('role="alert"')
      expect(html).not.toContain('来源记录已核验')
      expect(html).not.toContain('a'.repeat(64))
    },
  )

  it('shows a live loading state and allows a fresh query', () => {
    const html = render(null, { status: 'loading' })
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status"')
    expect(html).toContain('正在核验文本来源')
    expect(html).toContain('重新核验')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('data-testid="text-completion-receipt"')
  })

  it('shows readable fetch errors and retry without reusing a previous verified snapshot', () => {
    const html = render(
      { ...base, reason: 'verified', receipt },
      { status: 'error', error: '读取失败，请重试' },
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('读取失败，请重试')
    expect(html).toContain('重新核验')
    expect(html).not.toContain('来源记录已核验')
    expect(html).not.toContain('a'.repeat(64))
  })
})
