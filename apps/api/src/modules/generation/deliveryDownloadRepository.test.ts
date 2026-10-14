import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, isAbsolute } from 'node:path'
import type { DeliveryDownloadReceipt, GenerationTask } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { DeliveryDownloadRepository, deliveryTaskFingerprint } from './deliveryDownloadRepository.js'
import { downloadDraft, downloadPrincipal as principal, downloadTask } from './deliveryDownload.fixture.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    const path = relative(resolve(tmpdir()), resolve(directory))
    if (!path.startsWith('seqora-delivery-repository-') || path.startsWith('..') || isAbsolute(path))
      throw new Error('Unsafe test cleanup target')
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture(filePath: string | null = null) {
  const store = new AppStore(filePath)
  await store.initialize()
  const task = downloadTask()
  await store.mutate((state) => {
    state.tasks = [structuredClone(task)]
  })
  return { task, store, repository: new DeliveryDownloadRepository(store) }
}

describe('formal download authorization persistence', () => {
  it('persists the full immutable proof, increments the version and preserves generation fields', async () => {
    const { task, store, repository } = await fixture()
    const draft = downloadDraft(task)
    const receipt = await repository.authorize(task.id, principal, task.updatedAt, draft)
    const saved = store.read((state) => state.tasks[0]!)
    expect(saved.updatedAt).toBe(receipt.recordedTaskUpdatedAt)
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(task.updatedAt))
    expect(saved.metadata.deliveryDownloads).toEqual([receipt])
    expect(receipt.snapshot).toEqual(draft.snapshot)
    expect(receipt.gate).toEqual(draft.gate)
    expect(receipt.actorUserId).toBe(principal.userId)
    expect(deliveryTaskFingerprint(saved)).toBe(deliveryTaskFingerprint(task))
    receipt.snapshot.evidence.splice(0)
    expect(
      (store.read((state) => state.tasks[0]!.metadata.deliveryDownloads) as DeliveryDownloadReceipt[])[0]!
        .snapshot.evidence.length,
    ).toBeGreaterThan(0)
  })

  it('reuses an identical concurrent request without appending a second receipt', async () => {
    const { task, store, repository } = await fixture()
    const draft = downloadDraft(task)
    const [first, second] = await Promise.all([
      repository.authorize(task.id, principal, task.updatedAt, draft),
      repository.authorize(task.id, principal, task.updatedAt, draft),
    ])
    expect(first).toEqual(second)
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toHaveLength(1)
    const current = store.read((state) => state.tasks[0]!)
    const retry = { ...downloadDraft(current), sourceTaskUpdatedAt: task.updatedAt }
    expect(await repository.authorize(task.id, principal, current.updatedAt, retry)).toEqual(first)
  })

  it('rejects a different concurrent request against the old version', async () => {
    const { task, store, repository } = await fixture()
    const result = await Promise.allSettled([
      repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task, 'one')),
      repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task, 'two')),
    ])
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1)
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toHaveLength(1)
  })

  it.each([
    { ...principal, userId: 'other-user' },
    { ...principal, tenantId: 'other-tenant', roles: ['owner'] as ['owner'] },
  ])('reauthorizes task ownership and organization before mutation', async (actor) => {
    const { task, store, repository } = await fixture()
    await expect(
      repository.authorize(task.id, actor, task.updatedAt, downloadDraft(task)),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toBeUndefined()
  })

  it('rejects changed task facts even when their timestamp was not advanced', async () => {
    const { task, store, repository } = await fixture()
    await store.mutate((state) => {
      state.tasks[0]!.metadata.contentReview = { decision: 'rejected' }
    })
    await expect(
      repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task)),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_STALE' })
  })

  it('rejects a reused key after any further task update', async () => {
    const { task, store, repository } = await fixture()
    await repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task))
    await store.mutate((state) => {
      state.tasks[0]!.updatedAt = new Date(Date.parse(state.tasks[0]!.updatedAt) + 1).toISOString()
    })
    const current = store.read((state) => state.tasks[0]!)
    await expect(
      repository.authorize(task.id, principal, current.updatedAt, {
        ...downloadDraft(current),
        sourceTaskUpdatedAt: task.updatedAt,
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_REQUEST_CONFLICT' })
  })

  it('rejects an already used request key when its verified content changes', async () => {
    const { task, store, repository } = await fixture()
    await repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task))
    const current = store.read((state) => state.tasks[0]!)
    const changed = { ...downloadDraft(current), sourceTaskUpdatedAt: task.updatedAt, sha256: 'b'.repeat(64) }
    const proof = changed.snapshot.evidence.find((item) => item.kind === 'asset')!.details
      .storageProof as Record<string, unknown>
    proof.expectedSha256 = changed.sha256
    proof.actualSha256 = changed.sha256
    await expect(repository.authorize(task.id, principal, current.updatedAt, changed)).rejects.toMatchObject({
      code: 'DELIVERY_DOWNLOAD_REQUEST_CONFLICT',
    })
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toHaveLength(1)
  })

  it('fails closed for malformed prior receipts and leaves them available for repair', async () => {
    const { task, store, repository } = await fixture()
    await store.mutate((state) => {
      state.tasks[0]!.metadata.deliveryDownloads = [{ id: 'invalid' }]
    })
    await expect(
      repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task)),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_HISTORY_INVALID' })
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toEqual([{ id: 'invalid' }])
  })

  it('does not persist an authorization after client cancellation', async () => {
    const { task, store, repository } = await fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(
      repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task), controller.signal),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_ABORTED' })
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toBeUndefined()
  })

  it('rejects a changed request hash or mismatched stored-byte proof', async () => {
    const { task, repository } = await fixture()
    await expect(
      repository.authorize(task.id, principal, task.updatedAt, {
        ...downloadDraft(task),
        contractHash: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_CONTRACT_MISMATCH' })
    await expect(
      repository.authorize(task.id, principal, task.updatedAt, {
        ...downloadDraft(task),
        sha256: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_PROOF_MISMATCH' })
  })

  it('blocks failed gate or evidence scope without persisting authorization', async () => {
    const { task, store, repository } = await fixture()
    const blocked = downloadDraft(task)
    blocked.gate.allowed = false
    await expect(repository.authorize(task.id, principal, task.updatedAt, blocked)).rejects.toMatchObject({
      code: 'DELIVERY_DOWNLOAD_BLOCKED',
    })
    const wrongScope = downloadDraft(task)
    wrongScope.snapshot.evidence[0]!.scope.tenantId = 'other-tenant'
    await expect(repository.authorize(task.id, principal, task.updatedAt, wrongScope)).rejects.toMatchObject({
      code: 'DELIVERY_DOWNLOAD_STALE',
    })
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toBeUndefined()
  })

  it('keeps all 50 receipts and explicitly refuses further authorization', async () => {
    const { task, store, repository } = await fixture()
    for (let index = 0; index < 50; index++) {
      const current = store.read((state) => state.tasks[0]!)
      await repository.authorize(
        task.id,
        principal,
        current.updatedAt,
        downloadDraft(current, `download-${index}`),
      )
    }
    const current = store.read((state) => state.tasks[0]!)
    await expect(
      repository.authorize(task.id, principal, current.updatedAt, downloadDraft(current, 'download-51')),
    ).rejects.toMatchObject({ code: 'DELIVERY_DOWNLOAD_HISTORY_LIMIT' })
    expect(store.read((state) => state.tasks[0]!.metadata.deliveryDownloads)).toHaveLength(50)
  })

  it('reloads the authorization history from a local JSON store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seqora-delivery-repository-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'app.json')
    const { task, repository } = await fixture(filePath)
    const receipt = await repository.authorize(task.id, principal, task.updatedAt, downloadDraft(task))
    const reopened = new AppStore(filePath)
    await reopened.initialize()
    expect(
      reopened.read(
        (state) =>
          state.tasks.find((item: GenerationTask) => item.id === task.id)!.metadata.deliveryDownloads,
      ),
    ).toEqual([receipt])
  })
})
