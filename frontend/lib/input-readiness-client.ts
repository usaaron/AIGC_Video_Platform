import { apiRequest } from "@/lib/api-client";
import {
  buildInputReadinessRequest,
  parseInputReadinessResponse,
} from "@/lib/input-readiness";
import type { InputReadinessAnalysis, ProjectDraft } from "@/lib/types";

interface InputReadinessApiResponse {
  data?: unknown;
}

/**
 * Analyze creative input without mutating the project. A missing or incompatible
 * readiness service is intentionally indistinguishable from the legacy flow.
 */
export async function analyzeInputReadiness(
  draft: ProjectDraft,
): Promise<InputReadinessAnalysis | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await apiRequest<InputReadinessApiResponse | unknown>(
      "/input-readiness/analyze",
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(buildInputReadinessRequest(draft)),
      },
    );
    return parseInputReadinessResponse(response);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
