import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { inspectDeliveryDialog } from '../features/generation/deliveryInspection'
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

  it('shows the formal delivery gate and its physical failure reason', () => {
    const html = renderToStaticMarkup(
      <DeliveryVerificationDialog
        dialog={{
          job: { label: '镜头 01' },
          status: 'ready',
          error: '',
          snapshot: { contract: null, evidence: [], verification: null },
          gate: {
            allowed: false,
            status: 'blocked',
            reasonCodes: ['PHYSICAL_REVIEW_FAILED'],
            rationale: '正式交付被服务器门禁阻止，请先修复失败证据',
            verifiedAt: '2026-10-14T00:03:00.000Z',
            verification: null,
          },
        }}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('正式交付已被阻止')
    expect(html).toContain('刚性物理验收失败')
  })

  it('offers formal download from the verified dialog only when a download permission handler is provided', () => {
    const dialog = {
      job: { id: 'task-1', kind: 'video', label: '镜头 01' },
      status: 'ready',
      snapshot: {
        taskId: 'task-1',
        contract: { contractHash: 'a'.repeat(64) },
        evidence: [{ scope: { taskId: 'task-1', taskUpdatedAt: '2026-10-14T00:00:00.000Z' } }],
        verification: { status: 'satisfied', rationale: '全部要求已通过' },
      },
      gate: { allowed: true, status: 'allowed', rationale: '已放行' },
    }
    const html = renderToStaticMarkup(
      <DeliveryVerificationDialog
        dialog={dialog}
        onClose={() => {}}
        onDownload={() => {}}
        onRefresh={() => {}}
      />,
    )
    expect(html).toContain('aria-label="正式下载"')
    expect(html).toContain('重新核验')
    expect(html).not.toContain('disabled=""')
    const readOnly = renderToStaticMarkup(<DeliveryVerificationDialog dialog={dialog} onClose={() => {}} />)
    expect(readOnly).not.toContain('aria-label="正式下载"')
  })

  it('builds a server-hashed shot contract draft from a completed video task', () => {
    const task = {
      id: 'task-1',
      projectId: 'project-1',
      kind: 'video',
      status: 'completed',
      resultUrl: '/media/task-1.mp4',
      updatedAt: '2026-10-13T09:00:00.000Z',
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
      updatedAt: '2026-10-13T09:00:00.000Z',
      metadata: {},
    }
    expect(canFreezeDeliveryContract(base)).toBe(true)
    expect(canFreezeDeliveryContract({ ...base, kind: 'image' })).toBe(false)
    expect(
      canFreezeDeliveryContract({
        ...base,
        metadata: { deliveryContract: { contractHash: 'a'.repeat(64) } },
      }),
    ).toBe(false)
  })

  it.each([{}, { providerCompletionReceipt: { forged: true } }, { providerName: 'unknown-adapter' }])(
    'requires server completion for every new Seedance video contract regardless of metadata',
    (metadata) => {
      const task = { kind: 'video', provider: 'seedance', projectId: 'project-1', metadata }
      const draft = buildDeliveryContractDraft(task)
      expect(draft.must.map((item) => item.id)).toEqual(['task-completed', 'media-url', 'provider-completed'])
      const html = renderToStaticMarkup(
        <DeliveryContractFreezeDialog
          dialog={{ job: task, draft, status: 'editing' }}
          onClose={() => {}}
          onSubmit={() => {}}
        />,
      )
      expect(html).toContain('data-testid="provider-completion-required"')
      expect(html).toMatch(
        /<input[^>]+disabled=""[^>]+data-testid="provider-completion-required"[^>]+checked=""/,
      )
      expect(html).toContain('此回执不代表上游签名或内容质量验收')
      expect(html).toContain('不会自动付费重新生成')
    },
  )

  it.each([
    { kind: 'image', provider: 'seedance' },
    { kind: 'image', provider: 'img2' },
    { kind: 'video', provider: 'local-compose' },
    { kind: 'video', provider: 'other' },
    { kind: 'video' },
    { kind: 'text', provider: 'seedance' },
  ])('does not add remote completion requirements to $kind/$provider', (task) => {
    const draft = buildDeliveryContractDraft({
      ...task,
      projectId: 'project-1',
      metadata: { providerCompletionReceipt: { forged: true } },
    })
    expect(draft.must.map((item) => item.id)).not.toContain('provider-completed')
  })

  it('does not render a provider receipt from task metadata when the server snapshot has none', () => {
    const html = renderToStaticMarkup(
      <DeliveryVerificationDialog
        dialog={{
          job: {
            kind: 'video',
            provider: 'seedance',
            metadata: {
              providerCompletionReceipt: {
                providerTaskId: 'secret-provider-id',
                media: { storageKey: 'secret-storage-key' },
              },
            },
          },
          status: 'ready',
          snapshot: { taskId: 'task-1', contract: null, evidence: [], verification: null },
        }}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('完成回执待补证据')
    expect(html).not.toContain('secret-provider-id')
    expect(html).not.toContain('secret-storage-key')
    expect(html).not.toContain('服务端完成回执已核验')
  })

  it('uses a shot contract for a standalone video without inventing a shot ID', () => {
    const draft = buildDeliveryContractDraft({ kind: 'video', projectId: 'project-1', metadata: {} })
    expect(draft.intent).toEqual({
      mode: 'shot',
      projectId: 'project-1',
      episodeId: null,
      shotIds: [],
    })
    expect(draft.expectedArtifact).toEqual({ type: 'video', count: 1 })
  })

  it('inherits the script episode scope and prefers an explicit episode ID', () => {
    const base = { kind: 'video', projectId: 'project-1' }
    expect(
      buildDeliveryContractDraft({ ...base, metadata: { scriptEpisodeId: ' episode-script ' } }).intent
        .episodeId,
    ).toBe('episode-script')
    expect(
      buildDeliveryContractDraft({
        ...base,
        metadata: { episodeId: ' episode-explicit ', scriptEpisodeId: 'episode-script' },
      }).intent.episodeId,
    ).toBe('episode-explicit')
    expect(
      buildDeliveryContractDraft({ ...base, metadata: { episodeId: ' ', scriptEpisodeId: 'episode-script' } })
        .intent.episodeId,
    ).toBe('episode-script')
  })

  it('builds an asset contract when preparing an image draft', () => {
    const draft = buildDeliveryContractDraft({ kind: 'image', projectId: 'project-1', metadata: {} })
    expect(draft.intent.mode).toBe('asset')
    expect(draft.expectedArtifact).toEqual({ type: 'image', count: 1 })
    expect(draft.must.find((item) => item.id === 'media-url').statement).toBe('必须存在可读取的图片媒体')
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
            updatedAt: '2026-10-13T09:00:00.000Z',
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

describe('delivery inspection request identity', () => {
  function dialogState() {
    let current = null
    return {
      read: () => current,
      setDialog(value) {
        current = typeof value === 'function' ? value(current) : value
      },
    }
  }

  function deferred() {
    let resolve
    let reject
    const promise = new Promise((done, fail) => {
      resolve = done
      reject = fail
    })
    return { promise, resolve, reject }
  }

  it('shows successful and failed results while the matching dialog is still open', async () => {
    const state = dialogState()
    const job = { id: 'task-1' }
    const snapshot = { taskId: job.id }
    const gate = { allowed: true }
    await inspectDeliveryDialog({
      job,
      inspect: async () => snapshot,
      inspectGate: async () => gate,
      setDialog: state.setDialog,
    })
    expect(state.read()).toMatchObject({ job, snapshot, gate, status: 'ready' })
    await inspectDeliveryDialog({
      job,
      inspect: async () => {
        throw new Error('读取失败')
      },
      setDialog: state.setDialog,
    })
    expect(state.read()).toMatchObject({ job, status: 'error', error: '读取失败' })
  })

  it.each(['success', 'failure'])('does not reopen a dismissed dialog after late %s', async (outcome) => {
    const state = dialogState()
    const response = deferred()
    const pending = inspectDeliveryDialog({
      job: { id: 'task-1' },
      inspect: () => response.promise,
      setDialog: state.setDialog,
    })
    expect(state.read().status).toBe('loading')
    state.setDialog(null)
    if (outcome === 'success') response.resolve({ taskId: 'task-1' })
    else response.reject(new Error('读取失败'))
    await pending
    expect(state.read()).toBeNull()
  })

  it.each(['task-1', 'task-2'])(
    'ignores an earlier response after opening a new inspection for %s',
    async (taskId) => {
      const state = dialogState()
      const older = deferred()
      const newer = deferred()
      const first = inspectDeliveryDialog({
        job: { id: 'task-1' },
        inspect: () => older.promise,
        setDialog: state.setDialog,
      })
      const second = inspectDeliveryDialog({
        job: { id: taskId },
        inspect: () => newer.promise,
        setDialog: state.setDialog,
      })
      const active = state.read()
      older.resolve({ taskId: 'task-1', version: 'older' })
      await first
      expect(state.read()).toBe(active)
      newer.resolve({ taskId, version: 'newer' })
      await second
      expect(state.read()).toMatchObject({
        status: 'ready',
        job: { id: taskId },
        snapshot: { version: 'newer' },
      })
    },
  )

  it('does not replace a newer successful inspection with an older error', async () => {
    const state = dialogState()
    const older = deferred()
    const first = inspectDeliveryDialog({
      job: { id: 'task-1' },
      inspect: () => older.promise,
      setDialog: state.setDialog,
    })
    await inspectDeliveryDialog({
      job: { id: 'task-2' },
      inspect: async () => ({ taskId: 'task-2' }),
      setDialog: state.setDialog,
    })
    older.reject(new Error('较早请求失败'))
    await first
    expect(state.read()).toMatchObject({ status: 'ready', job: { id: 'task-2' } })
  })
})
