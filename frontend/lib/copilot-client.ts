import { ApiError, apiEventStream, apiRequest, visibleApiError } from "@/lib/api-client";
import type { CopilotProgressEvent } from "@/lib/copilot-progress";
import { assertHostSessionActive } from "@/lib/host-session";

export type CopilotProgressObserver = (event: CopilotProgressEvent) => void;

type CopilotEvent<T> = CopilotProgressEvent
  | { type: "result"; data: T }
  | { type: "error"; message: string; status?: number; retryable?: boolean; failure_class?: string; error_type?: string };

/** Opt-in progress on the original request; a JSON response is also supported. */
export async function copilotRequest<T>(
  path: string,
  init: RequestInit,
  onProgress?: CopilotProgressObserver,
): Promise<T> {
  if (!onProgress) return apiRequest<T>(path, init);
  let result: T | undefined;
  let complete = false;
  try {
    await apiEventStream<CopilotEvent<T>>(path, init, (event) => {
      if (complete) return;
      if (event.type === "result") {
        result = event.data;
        complete = true;
      } else if (event.type === "error") {
        throw new ApiError(visibleApiError(event.message, event.status ?? 500), event.status ?? 500, {
          // A modification may already have reached the server. The user can
          // inspect the retained draft before deciding whether to send again.
          retryable: false,
          failureClass: event.failure_class,
          errorType: event.error_type,
        });
      } else if (event.type === "progress" || event.type === "reasoning_summary" || event.type === "model_thinking") {
        onProgress(event);
      }
    }, (value) => { result = value as T; complete = true; });
  } catch (error) {
    assertHostSessionActive();
    if (init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    // A received terminal result is authoritative even if its connection closes
    // abruptly afterwards; retrying here could apply the same edit twice.
    if (complete) return result as T;
    if (error instanceof ApiError) {
      throw new ApiError(error.message, error.status, {
        retryable: false, failureClass: error.failureClass, errorType: error.errorType,
      });
    }
    throw new ApiError("连接已中断，请检查当前草稿后再重试。", 503, { retryable: false, failureClass: "stream_incomplete" });
  }
  if (!complete) {
    throw new ApiError("本次处理尚未收到完整结果，请检查当前草稿后再重试。", 503, { retryable: false, failureClass: "stream_incomplete" });
  }
  return result as T;
}
