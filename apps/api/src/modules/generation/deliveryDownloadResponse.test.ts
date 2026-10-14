import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackDeliveryResponse } from './deliveryDownloadResponse.js'

afterEach(() => vi.useRealTimers())
function fixture() {
  const response = Object.assign(new EventEmitter(), { destroy: vi.fn() })
  const release = vi.fn()
  const done = trackDeliveryResponse(response as unknown as ServerResponse, release)
  return { response, release, done }
}
describe('formal download response lifecycle', () => {
  it('terminates stalled sends and releases retained media slots', async () => {
    vi.useFakeTimers()
    const { response, release, done } = fixture()
    await vi.advanceTimersByTimeAsync(120_001)
    expect(response.destroy).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    response.emit('close')
    done()
    expect(release).toHaveBeenCalledTimes(1)
  })
  it.each(['finish', 'close'])('cleans up a %s response without a later timeout', async (event) => {
    vi.useFakeTimers()
    const { response, release } = fixture()
    response.emit(event)
    await vi.advanceTimersByTimeAsync(120_001)
    expect(release).toHaveBeenCalledTimes(1)
    expect(response.destroy).not.toHaveBeenCalled()
    expect(response.listenerCount('finish')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  })
})
