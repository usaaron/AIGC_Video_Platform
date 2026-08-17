import type { FailureRetryMode } from "./types.ts";

// An attempt includes the first request. Keep this small: the backend already
// has provider-route and bounded contract recovery of its own.
export const MAX_AUTOMATIC_GENERATION_ATTEMPTS = 3;
// One roadmap API request already tries the planning model and its independent
// fallback route. Do not repeat that full two-model chain in the browser: one
// click remains automatically recoverable while staying below the 105-second
// combined provider timeout.
export const MAX_EPISODE_ROADMAP_API_ATTEMPTS = 1;

const TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504]);
const DETERMINISTIC_FAILURE_CLASSES = new Set([
  "configuration",
  "contract",
  "input",
  "validation",
  "business",
  "persistence",
  "auth",
  "permission",
  "conflict",
]);
const TRANSIENT_FAILURE_CLASSES = new Set([
  "network",
  "timeout",
  "transport",
  "rate_limit",
  "provider_gateway",
  "upstream",
  "transient_upstream",
  "stream_incomplete",
]);

export interface AutomaticRetryEvent {
  failedAttempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

export type RetryDelay = (failedAttempt: number, error: unknown) => number;

/** Full-episode retries are for transport/provider failures only. Contract and
 * business 4xx responses already exhausted the backend's bounded repair path. */
export function isTransientGenerationFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;
  const metadata = error && typeof error === "object"
    ? error as {
        status?: unknown;
        retryable?: unknown;
        failureClass?: unknown;
        errorType?: unknown;
        category?: unknown;
      }
    : {};
  const failureClass = typeof metadata.failureClass === "string"
    ? metadata.failureClass.trim().toLocaleLowerCase()
    : typeof metadata.category === "string"
      ? metadata.category.trim().toLocaleLowerCase()
      : typeof metadata.errorType === "string"
        ? metadata.errorType.trim().toLocaleLowerCase()
        : "";
  if (DETERMINISTIC_FAILURE_CLASSES.has(failureClass)) return false;
  if (metadata.retryable === false) return false;
  if (TRANSIENT_FAILURE_CLASSES.has(failureClass)) return true;

  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (typeof status === "number") {
    return TRANSIENT_STATUSES.has(status);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:failed to fetch|fetch failed|load failed|network(?:error| request)?|connection\s+(?:reset|closed|refused)|connect(?:ion)?(?:error| failed)|socket|broken pipe|incomplete chunked|peer closed|eof|stream (?:disconnected|terminated|ended)|premature(?:ly)? (?:closed|ended)|response.?not.?read|timed out|timeout|(?:^|\D)(?:408|429|502|503|504)(?:\D|$))/i.test(message);
}

export function generateWithAutomaticTransientRetry<T>({
  generate,
  onAutomaticRetry,
  wait = waitForRetry,
  retryDelay = automaticRetryDelayMs,
  maxAutomaticAttempts = MAX_AUTOMATIC_GENERATION_ATTEMPTS,
}: {
  generate: (attempt: number) => Promise<T>;
  onAutomaticRetry?: (event: AutomaticRetryEvent) => void;
  wait?: (delayMs: number) => Promise<void>;
  retryDelay?: RetryDelay;
  maxAutomaticAttempts?: number;
}): Promise<T> {
  return generateWithFailurePolicy({
    generate,
    mode: "automatic",
    onAutomaticRetry,
    shouldRetry: isTransientGenerationFailure,
    wait,
    retryDelay,
    maxAutomaticAttempts,
  });
}

export async function generateWithFailurePolicy<T>({
  generate,
  mode,
  onAutomaticRetry,
  shouldRetry = () => true,
  wait = waitForRetry,
  retryDelay = automaticRetryDelayMs,
  maxAutomaticAttempts = MAX_AUTOMATIC_GENERATION_ATTEMPTS,
}: {
  generate: (attempt: number) => Promise<T>;
  mode: FailureRetryMode;
  onAutomaticRetry?: (event: AutomaticRetryEvent) => void;
  shouldRetry?: (error: unknown) => boolean;
  wait?: (delayMs: number) => Promise<void>;
  retryDelay?: RetryDelay;
  maxAutomaticAttempts?: number;
}): Promise<T> {
  const maxAttempts = mode === "automatic"
    ? Math.max(1, Math.floor(maxAutomaticAttempts))
    : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await generate(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) break;
      const delayMs = retryDelay(attempt, error);
      onAutomaticRetry?.({
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        error,
      });
      await wait(delayMs);
    }
  }
  throw lastError;
}

export function automaticRetryDelayMs(failedAttempt: number, error?: unknown): number {
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (status === 429 || /(?:^|\D)429(?:\D|$)|rate.?limit|too many requests/i.test(message)) {
    return failedAttempt <= 1 ? 10_000 : 30_000;
  }
  if (
    status === 502
    || status === 503
    || status === 504
    || /(?:^|\D)50[234](?:\D|$)|bad gateway|provider gateway|供应商网关/i.test(message)
  ) {
    return failedAttempt <= 1 ? 15_000 : 30_000;
  }
  return failedAttempt <= 1 ? 2_000 : 5_000;
}

/** Provider rate limits need a longer, shared cooldown than ordinary transport retries. */
export function roadmapRetryDelayMs(failedAttempt: number, error: unknown): number {
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const rateLimited = status === 429 || /(?:^|\D)429(?:\D|$)|rate.?limit|too many requests/i.test(message);
  if (rateLimited) return failedAttempt <= 1 ? 10_000 : 30_000;
  return automaticRetryDelayMs(failedAttempt, error);
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}
