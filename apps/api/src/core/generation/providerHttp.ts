type Fetcher = typeof fetch

export type ProviderHttpErrorKind = 'http' | 'network' | 'timeout'

export class ProviderHttpError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly kind: ProviderHttpErrorKind,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }

  get retryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true
    return this.status === 429 || (typeof this.status === 'number' && this.status >= 500)
  }
}

export function createProviderHttpError(
  providerName: string,
  status: number,
  message: string,
): ProviderHttpError {
  return new ProviderHttpError(
    providerName,
    'http',
    `${providerName} request failed (${status})${message ? `: ${message}` : ''}`,
    status,
  )
}

export async function fetchWithProviderTimeout(
  providerName: string,
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ProviderHttpError(
        providerName,
        'timeout',
        `${providerName} request timed out after ${timeoutMs}ms`,
      )
    }
    throw new ProviderHttpError(
      providerName,
      'network',
      error instanceof Error ? error.message : `${providerName} request failed`,
    )
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TimeoutError' || error.name === 'AbortError'
}
