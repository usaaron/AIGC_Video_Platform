import type { ServerResponse } from 'node:http'

// Slow or abandoned clients must not retain global snapshot slots indefinitely.
const SEND_TIMEOUT_MS = 120_000
export function trackDeliveryResponse(response: ServerResponse, release: () => void): () => void {
  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    response.removeListener('finish', done)
    response.removeListener('close', done)
    release()
  }
  const timer = setTimeout(() => {
    try {
      response.destroy()
    } finally {
      done()
    }
  }, SEND_TIMEOUT_MS)
  timer.unref()
  response.once('finish', done)
  response.once('close', done)
  return done
}
