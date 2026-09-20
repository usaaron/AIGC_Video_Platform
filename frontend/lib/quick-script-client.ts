import { apiRequest } from "./api-client";
import { copilotRequest } from "./copilot-client";
import { quickScriptCanAdvance, type QuickScriptAction, type QuickScriptRequestOptions, type QuickScriptResponse, type QuickScriptState } from "./quick-script-types";

function checkedResponse(projectId: string, response: QuickScriptResponse): QuickScriptResponse {
  const data = response?.data;
  if (!data?.workspace_snapshot || data.workspace_snapshot.workspace_payload?.id !== projectId
    || (data.state && data.state.project_id !== projectId)
    || !Number.isInteger(data.workspace_snapshot.revision)) {
    throw new Error("返回的作品状态不匹配，请重新读取当前作品。");
  }
  return response;
}

export async function loadQuickScript(projectId: string, signal?: AbortSignal): Promise<QuickScriptResponse> {
  // Bound read-only recovery separately from the much longer model request.
  // A hanging status read must not hold every editor action indefinitely.
  const timeout = AbortSignal.timeout(15_000);
  const readSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return checkedResponse(projectId, await apiRequest<QuickScriptResponse>(`/story-projects/${encodeURIComponent(projectId)}/quick-script`, { signal: readSignal }));
  } catch (failure) {
    if (timeout.aborted && !signal?.aborted) throw new Error("读取保存进度超时，请重试。");
    throw failure;
  }
}

export async function actQuickScript(projectId: string, revision: number, action: QuickScriptAction,
  payload: Record<string, unknown> = {}, options: QuickScriptRequestOptions = {}): Promise<QuickScriptResponse> {
  return checkedResponse(projectId, await copilotRequest<QuickScriptResponse>(
    `/story-projects/${encodeURIComponent(projectId)}/quick-script/actions`,
    { method: "POST", signal: options.signal, body: JSON.stringify({ action, operation_id: `quick.${crypto.randomUUID()}`, expected_revision: revision, payload }) },
    options.onProgress,
  ));
}

/** One dependent stage at a time; adopting durable results precedes the next request. */
export async function advanceQuickScriptSequentially(initial: QuickScriptState, options: {
  stopped: () => boolean;
  advance: (state: QuickScriptState) => Promise<QuickScriptState>;
}): Promise<QuickScriptState> {
  let current = initial;
  while (quickScriptCanAdvance(current) && !options.stopped()) {
    const next = await options.advance(current);
    if (next.project_id !== current.project_id || next.revision <= current.revision) {
      throw new Error("生成状态尚未更新，已停止后续请求。请重新读取当前作品后继续。");
    }
    current = next;
  }
  return current;
}
