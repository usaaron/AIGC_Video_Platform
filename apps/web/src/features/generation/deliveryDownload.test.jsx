import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeliveryDownload } from './DeliveryDownload'
import {
  createDeliveryDownloadAction,
  deliveryDownloadInput,
  sendDeliveryDownload,
} from './deliveryDownloadAction'

const job = { id: 'task-1', kind: 'video', updatedAt: '2026-10-13T00:00:00.000Z' }
const snapshot = {
  taskId: job.id,
  contract: { contractHash: 'a'.repeat(64) },
  verification: { status: 'satisfied' },
  evidence: [{ scope: { taskId: job.id, taskUpdatedAt: '2026-10-14T00:00:00.000Z' } }],
}
const gate = { allowed: true, status: 'allowed' }
const input = { expectedUpdatedAt: snapshot.evidence[0].scope.taskUpdatedAt, contractHash: 'a'.repeat(64) }
const receipt = { blob: new Blob(['video']), filename: 'delivery.mp4', receiptId: 'receipt-1' }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('formal delivery download', () => {
  it('uses the evidence version instead of the stale queue row version', () => {
    expect(deliveryDownloadInput(job, snapshot, gate)).toEqual(input)
    expect(deliveryDownloadInput({ ...job, kind: 'image' }, snapshot, gate)).toEqual(input)
  })

  it.each(['blocked', 'pending'])('keeps a %s gate disabled', (status) => {
    const currentGate = { allowed: false, status }
    expect(deliveryDownloadInput(job, snapshot, currentGate)).toBeNull()
    const html = renderToStaticMarkup(
      <DeliveryDownload job={job} snapshot={snapshot} gate={currentGate} onDownload={() => {}} />,
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('暂不可正式下载')
  })

  it('enables only a satisfied supported result with scoped evidence and a valid hash', () => {
    const html = renderToStaticMarkup(
      <DeliveryDownload job={job} snapshot={snapshot} gate={gate} onDownload={() => {}} />,
    )
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('正式下载时，服务器将重新核验')
    expect(deliveryDownloadInput({ ...job, kind: 'audio' }, snapshot, gate)).toBeNull()
    expect(deliveryDownloadInput(job, { ...snapshot, verification: { status: 'partial' } }, gate)).toBeNull()
    expect(deliveryDownloadInput(job, { ...snapshot, contract: { contractHash: 'bad' } }, gate)).toBeNull()
    expect(deliveryDownloadInput(job, { ...snapshot, taskId: 'another-task' }, gate)).toBeNull()
    expect(deliveryDownloadInput(job, { ...snapshot, evidence: [] }, gate)).toBeNull()
    expect(
      deliveryDownloadInput(
        job,
        {
          ...snapshot,
          evidence: [{ scope: { taskId: 'another-task', taskUpdatedAt: input.expectedUpdatedAt } }],
        },
        gate,
      ),
    ).toBeNull()
    expect(
      deliveryDownloadInput(
        job,
        { ...snapshot, evidence: [{ scope: { taskId: job.id, taskUpdatedAt: 'invalid' } }] },
        gate,
      ),
    ).toBeNull()
  })

  it('runs a single request and announces its receipt only after sending the download', async () => {
    let resolve
    const download = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const onState = vi.fn()
    const send = vi.fn()
    const action = createDeliveryDownloadAction({
      download,
      onState,
      send,
      createRequestId: () => 'request-1',
    })
    const first = action.run(job.id, input)
    const second = action.run(job.id, input)
    expect(second).toBe(first)
    expect(onState).toHaveBeenCalledWith({ status: 'loading' })
    await Promise.resolve()
    expect(download).toHaveBeenCalledTimes(1)
    resolve(receipt)
    await first
    expect(send).toHaveBeenCalledWith(receipt)
    expect(onState).toHaveBeenLastCalledWith({
      status: 'success',
      receiptId: receipt.receiptId,
      needsRefresh: true,
    })
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(onState.mock.invocationCallOrder.at(-1))
  })

  it('reuses the request id after failure and requires a newer snapshot after success', async () => {
    const download = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(receipt)
    const createRequestId = vi.fn().mockReturnValueOnce('request-1').mockReturnValueOnce('request-2')
    const onState = vi.fn()
    const action = createDeliveryDownloadAction({ download, onState, send: vi.fn(), createRequestId })
    await action.run(job.id, input)
    expect(onState).toHaveBeenLastCalledWith({ status: 'error', message: '网络中断', needsRefresh: false })
    await action.run(job.id, input)
    await action.run(job.id, input)
    expect(download).toHaveBeenCalledTimes(2)
    expect(createRequestId).toHaveBeenCalledTimes(1)
    expect(onState).toHaveBeenLastCalledWith({
      status: 'success',
      receiptId: receipt.receiptId,
      needsRefresh: true,
    })
    await action.run(job.id, { ...input, expectedUpdatedAt: '2026-10-14T00:01:00.000Z' })
    expect(download.mock.calls.map(([, request]) => request.clientRequestId)).toEqual([
      'request-1',
      'request-1',
      'request-2',
    ])
  })

  it('requires fresh verification after the server rejects stale or blocked evidence', async () => {
    const onState = vi.fn()
    const send = vi.fn()
    const download = vi.fn().mockRejectedValue(Object.assign(new Error('任务已变化'), { status: 409 }))
    const action = createDeliveryDownloadAction({
      download,
      onState,
      send,
      createRequestId: () => 'request-1',
    })
    await action.run(job.id, input)
    expect(send).not.toHaveBeenCalled()
    expect(onState).toHaveBeenLastCalledWith({ status: 'error', message: '任务已变化', needsRefresh: true })
  })

  it('aborts a dismissed request and suppresses a late browser download', async () => {
    let resolve
    const download = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const onState = vi.fn()
    const send = vi.fn()
    const action = createDeliveryDownloadAction({
      download,
      onState,
      send,
      createRequestId: () => 'request-1',
    })
    const pending = action.run(job.id, input)
    await Promise.resolve()
    action.cancel()
    expect(download.mock.calls[0][2].signal.aborted).toBe(true)
    resolve(receipt)
    await pending
    expect(send).not.toHaveBeenCalled()
    expect(onState).toHaveBeenCalledTimes(1)
  })

  it('releases the blob URL after clicking and removes the temporary link', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-download')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const link = { click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { appendChild } })
    sendDeliveryDownload(receipt)
    expect(createObjectURL).toHaveBeenCalledWith(receipt.blob)
    expect(link).toMatchObject({ href: 'blob:local-download', download: 'delivery.mp4', hidden: true })
    expect(appendChild).toHaveBeenCalledWith(link)
    expect(link.click).toHaveBeenCalledTimes(1)
    expect(link.remove).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-download')
  })

  it('releases the blob URL immediately if the browser cannot initiate a download', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-download')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const link = {
      click: () => {
        throw new Error('Download unavailable')
      },
      remove: vi.fn(),
    }
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } })
    expect(() => sendDeliveryDownload(receipt)).toThrow('Download unavailable')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-download')
    expect(link.remove).toHaveBeenCalledTimes(1)
  })
})
