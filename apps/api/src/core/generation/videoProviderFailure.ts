export type VideoProviderFailureCode =
  | 'UPSTREAM_COPYRIGHT_REJECTED'
  | 'UPSTREAM_CONTENT_REJECTED'
  | 'UPSTREAM_QUOTA_EXCEEDED'
  | 'UPSTREAM_CANCELLED'
  | 'UPSTREAM_EXPIRED'
  | 'UPSTREAM_FAILED'

const messages: Record<VideoProviderFailureCode, string> = {
  UPSTREAM_COPYRIGHT_REJECTED: '上游判定生成内容可能涉及版权限制，本次视频未生成。',
  UPSTREAM_CONTENT_REJECTED: '上游内容审核未通过，本次视频未生成。',
  UPSTREAM_QUOTA_EXCEEDED: '上游额度不足，本次视频未生成。',
  UPSTREAM_CANCELLED: '上游视频任务已取消。',
  UPSTREAM_EXPIRED: '上游视频任务已过期。',
  UPSTREAM_FAILED: '上游视频生成失败，请稍后重试。',
}

export function videoProviderFailure(status: string, code: unknown, message: string, requestId?: unknown) {
  const normalizedCode = typeof code === 'string' ? code.toLowerCase() : ''
  let failureCode: VideoProviderFailureCode = 'UPSTREAM_FAILED'
  if (/copyright|intellectual[_ .-]?property/.test(normalizedCode))
    failureCode = 'UPSTREAM_COPYRIGHT_REJECTED'
  else if (
    /content[_ .-]?(?:policy|filter|moderation)|safety|sensitive|risk[_ .-]?control/.test(normalizedCode)
  )
    failureCode = 'UPSTREAM_CONTENT_REJECTED'
  else if (/quota|insufficient[_ .-]?(?:balance|credit)/.test(normalizedCode))
    failureCode = 'UPSTREAM_QUOTA_EXCEEDED'
  else if (status === 'cancelled' || status === 'canceled') failureCode = 'UPSTREAM_CANCELLED'
  else if (status === 'expired') failureCode = 'UPSTREAM_EXPIRED'
  else if (/copyright|版权|著作权/i.test(message)) failureCode = 'UPSTREAM_COPYRIGHT_REJECTED'
  const providerRequestId =
    safeRequestId(requestId) ??
    safeRequestId(
      message.match(/\brequest[\s_-]*id\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_-]{7,127})(?=$|[\s,;.)\]])/i)?.[1],
    )
  return { failureCode, error: messages[failureCode], ...(providerRequestId ? { providerRequestId } : {}) }
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value) ? value : undefined
}
