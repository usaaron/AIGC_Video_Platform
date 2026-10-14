export function deliveryDownloadInput(job, snapshot, gate) {
  const scope = snapshot?.evidence?.[0]?.scope
  const contractHash = snapshot?.contract?.contractHash
  if (
    !['video', 'image'].includes(job?.kind) ||
    !gate?.allowed ||
    gate.status !== 'allowed' ||
    snapshot?.verification?.status !== 'satisfied' ||
    snapshot.taskId !== job.id ||
    scope?.taskId !== job.id ||
    !Number.isFinite(Date.parse(scope?.taskUpdatedAt)) ||
    !/^[a-f0-9]{64}$/i.test(contractHash || '')
  )
    return null
  return { expectedUpdatedAt: scope.taskUpdatedAt, contractHash }
}

export function sendDeliveryDownload({ blob, filename }) {
  const objectUrl = URL.createObjectURL(blob)
  let link
  try {
    link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    // Give the browser time to begin reading before releasing this local URL.
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  } finally {
    link?.remove()
  }
}

export function createDeliveryDownloadAction({
  download,
  onState,
  send = sendDeliveryDownload,
  createRequestId = () => crypto.randomUUID(),
}) {
  let pending = null
  let request = null
  let controller = null
  let completedKey = null
  return {
    run(taskId, input) {
      if (pending) return pending
      const key = JSON.stringify([taskId, input.expectedUpdatedAt, input.contractHash])
      if (key === completedKey) return Promise.resolve(null)
      if (request?.key !== key) request = { key, id: createRequestId() }
      const clientRequestId = request.id
      const current = new AbortController()
      controller = current
      onState({ status: 'loading' })
      pending = Promise.resolve()
        .then(() =>
          current.signal.aborted
            ? null
            : download(taskId, { ...input, clientRequestId }, { signal: current.signal }),
        )
        .then((result) => {
          if (current.signal.aborted) return null
          send(result)
          request = null
          completedKey = key
          onState({ status: 'success', receiptId: result.receiptId, needsRefresh: true })
          return result
        })
        .catch((error) => {
          if (!current.signal.aborted)
            onState({
              status: 'error',
              message: error?.message || '正式下载暂时失败，请重试',
              needsRefresh: error?.status === 409,
            })
          return null
        })
        .finally(() => {
          if (controller === current) {
            pending = null
            controller = null
          }
        })
      return pending
    },
    cancel() {
      controller?.abort()
      pending = null
      controller = null
    },
  }
}
