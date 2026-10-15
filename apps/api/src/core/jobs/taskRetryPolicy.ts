import { ProviderHttpError } from '../generation/providerHttp.js'

export const SUBMISSION_RETRY_LIMIT = 5
export const POST_PROCESS_RETRY_LIMIT = 5
export const POLL_RETRY_LIMIT = 3
export const POLL_PROCESSING_RETRY_LIMIT = 240

const SUBMISSION_BASE_DELAY_MS = 1_000
const POST_PROCESS_BASE_DELAY_MS = 1_500

export function isRetryableSubmissionError(error: unknown): boolean {
  return error instanceof ProviderHttpError ? error.retryable : false
}

export function retryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1)
  const rawDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent)
  const half = Math.floor(rawDelay / 2)
  return half + Math.floor(random() * (rawDelay - half + 1))
}

export function submissionRetryDelayMs(attempt: number): number {
  return retryDelayMs(attempt, SUBMISSION_BASE_DELAY_MS, 60_000)
}

export function postProcessRetryDelayMs(attempt: number): number {
  return retryDelayMs(attempt, POST_PROCESS_BASE_DELAY_MS, 60_000)
}
