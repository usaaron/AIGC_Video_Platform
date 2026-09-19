import { CURRENT_MARKET_PROFILE } from "@/lib/types";
import { visibleApiError } from "@/lib/api-error";
import type { paths as ApiPaths } from "@/lib/generated/api-schema";
import { API_BASE_URL } from "@/lib/base-path";
import { assertHostSessionActive, ensureHostToken, hostSessionSignal } from "@/lib/host-session";

export { visibleApiError } from "@/lib/api-error";
export type { ApiPaths };
export { hostToken, ensureHostToken } from "@/lib/host-session";

export class ApiError extends Error {
  readonly status: number;
  readonly retryable?: boolean;
  readonly failureClass?: string;
  readonly errorType?: string;

  constructor(
    message: string,
    status: number,
    metadata: {
      retryable?: boolean;
      failureClass?: string;
      errorType?: string;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = metadata.retryable;
    this.failureClass = metadata.failureClass;
    this.errorType = metadata.errorType;
  }
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await ensureHostToken();
  const signal = init?.signal ? AbortSignal.any([init.signal, hostSessionSignal]) : hostSessionSignal;
  signal.throwIfAborted();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    const payload = parseErrorPayload(responseText);
    const metadata = responseFailureMetadata(response);
    throw new ApiError(
      formatApiError(payload?.detail, response.status, responseText, metadata.failureClass, metadata.errorType),
      response.status,
      metadata,
    );
  }

  const result = await response.json() as T;
  assertHostSessionActive();
  return result;
}

export async function apiEventStream<TEvent>(
  path: string,
  init: RequestInit,
  onEvent: (event: TEvent) => void,
): Promise<void> {
  const token = await ensureHostToken();
  const signal = init.signal ? AbortSignal.any([init.signal, hostSessionSignal]) : hostSessionSignal;
  signal.throwIfAborted();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal,
    headers: {
      "Accept": "text/event-stream",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    const payload = parseErrorPayload(responseText);
    const metadata = responseFailureMetadata(response);
    throw new ApiError(
      formatApiError(payload?.detail, response.status, responseText, metadata.failureClass, metadata.errorType),
      response.status,
      metadata,
    );
  }
  if (!response.body) {
    throw new ApiError(
      "The streaming response did not contain a body.",
      response.status,
      { retryable: true, failureClass: "stream_incomplete", errorType: "stream_incomplete" },
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let previousChunkEndedWithCR = false;

  function consumeFrame(frame: string, endedWithoutBoundary = false) {
    assertHostSessionActive();
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return;
    let parsed: TEvent;
    try {
      parsed = JSON.parse(data) as TEvent;
    } catch (error) {
      if (!endedWithoutBoundary) throw error;
      throw new ApiError(
        "The streaming response ended during an event.",
        503,
        { retryable: true, failureClass: "stream_incomplete", errorType: "stream_incomplete" },
      );
    }
    onEvent(parsed);
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      let chunk = decoder.decode(value, { stream: !done });
      if (chunk) {
        // CR is a complete line ending; discard its LF even across network chunks.
        if (previousChunkEndedWithCR && chunk.startsWith("\n")) {
          chunk = chunk.slice(1);
        }
        previousChunkEndedWithCR = chunk.endsWith("\r");
        buffer += chunk.replace(/\r\n?/g, "\n");
      }
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        consumeFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) consumeFrame(buffer, true);
  } catch (error) {
    // Cleanup failures must not replace the parse, callback, or transport error.
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function responseFailureMetadata(response: Response): {
  retryable?: boolean;
  failureClass?: string;
  errorType?: string;
} {
  const retryable = response.headers.get("x-generation-retryable");
  const failureClass = response.headers.get("x-generation-failure-class") ?? undefined;
  const errorType = response.headers.get("x-generation-error-type") ?? undefined;
  return {
    ...(retryable === "true" || retryable === "false"
      ? { retryable: retryable === "true" }
      : {}),
    ...(failureClass ? { failureClass } : {}),
    ...(errorType ? { errorType } : {}),
  };
}

function parseErrorPayload(responseText: string): { detail?: unknown } | null {
  if (!responseText.trim()) return null;
  try {
    return JSON.parse(responseText) as { detail?: unknown };
  } catch {
    return null;
  }
}

function formatApiError(
  detail: unknown,
  status: number,
  responseText: string,
  failureClass?: string,
  errorType?: string,
): string {
  if (errorType === "planning_call_budget_exhausted" || failureClass === "planning_call_budget_exhausted") {
    return visibleApiError("", status, CURRENT_MARKET_PROFILE, failureClass, errorType);
  }
  if (typeof detail === "string" && detail.trim()) {
    return visibleApiError(detail, status, CURRENT_MARKET_PROFILE, failureClass, errorType);
  }
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { loc?: unknown; msg?: unknown };
      if (typeof candidate.msg !== "string") return [];
      const location = Array.isArray(candidate.loc)
        ? candidate.loc.filter((part) => part !== "body").join(".")
        : "";
      return [location ? `${location}: ${candidate.msg}` : candidate.msg];
    });
    if (messages.length) {
      return visibleApiError(
        messages.join("; "),
        status,
        CURRENT_MARKET_PROFILE,
        failureClass,
        errorType,
      );
    }
  }
  const plainText = responseText.trim();
  if (plainText && !plainText.startsWith("<")) {
    return visibleApiError(
      plainText.slice(0, 500),
      status,
      CURRENT_MARKET_PROFILE,
      failureClass,
      errorType,
    );
  }
  return CURRENT_MARKET_PROFILE === "cn_mainland"
    ? "请求暂未完成，已保存的内容不会丢失，请稍后重试。"
    : "请求暂未完成，已保存的内容不会丢失，请稍后重试。";
}
