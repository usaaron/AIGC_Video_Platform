import type { Principal } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { GenerationTaskRepository } from './repository.js'
import { buildDeliveryVerificationSnapshot } from './deliveryVerification.js'

let activeQueries = 0
const MAX_QUERIES = 4
const QUERY_TIMEOUT_MS = 15_000

/** GET-only budget. Download verification over captured bytes does not acquire a query slot. */
export async function readDeliveryQuery(
  repository: Pick<GenerationTaskRepository, 'findById'>,
  storage: ObjectStorage | null,
  taskId: string,
  principal: Principal,
  signal?: AbortSignal,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let acquired = false
  let rejectStopped!: (error: AppError) => void
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject
  })
  const stop = (error: AppError) => {
    if (controller.signal.aborted) return
    controller.abort(error)
    rejectStopped(error)
  }
  const cancel = () => stop(new AppError(499, 'DELIVERY_QUERY_ABORTED', '交付核验请求已取消'))
  const assertActive = () => {
    if (controller.signal.aborted) throw controller.signal.reason
  }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  timer = setTimeout(
    () => stop(new AppError(503, 'DELIVERY_QUERY_TIMEOUT', '交付核验超时，请稍后重试')),
    QUERY_TIMEOUT_MS,
  )
  const read = async () => {
    assertActive()
    const task = await repository.findById(taskId, principal)
    assertActive()
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', '生成任务不存在或无权读取交付核验')
    if (activeQueries >= MAX_QUERIES)
      throw new AppError(429, 'DELIVERY_QUERY_BUSY', '交付核验繁忙，请稍后重试')
    activeQueries += 1
    acquired = true
    const checkedAt = new Date().toISOString()
    const snapshot = await buildDeliveryVerificationSnapshot(task, storage, checkedAt, controller.signal)
    assertActive()
    return { task, checkedAt, snapshot }
  }
  try {
    return await Promise.race([stopped, read()])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    // Also stop a sibling read after an unexpected validation exception.
    if (!controller.signal.aborted) controller.abort()
    if (acquired) {
      acquired = false
      activeQueries -= 1
    }
  }
}
