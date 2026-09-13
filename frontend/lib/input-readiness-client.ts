import { apiRequest } from "@/lib/api-client";
import {
  buildInputReadinessRequest,
  parseInputReadinessResponse,
} from "@/lib/input-readiness";
import type { InputReadinessAnalysis, ProjectDraft } from "@/lib/types";

interface InputReadinessApiResponse {
  data?: unknown;
}

export async function analyzeInputReadiness(
  draft: ProjectDraft,
  options: { signal?: AbortSignal; useModel?: boolean } = {},
): Promise<InputReadinessAnalysis> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  // Leave room for the server's 60-second model budget and local fallback.
  const timeout = window.setTimeout(() => controller.abort(), 75_000);
  try {
    const response = await apiRequest<InputReadinessApiResponse | unknown>(
      "/input-readiness/analyze",
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ ...buildInputReadinessRequest(draft), ...(options.useModel === false ? { use_model: false } : {}) }),
      },
    );
    const analysis = parseInputReadinessResponse(response);
    if (!analysis) throw new Error("输入识别结果无法读取，请重试识别。");
    return analysis;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error("输入识别超时，资料已保留，请重试识别。");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
