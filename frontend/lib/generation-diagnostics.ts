/** An allowlist: never include prompts, screenplay, model output, auth or URLs. */
export function generationDiagnostics(input: {
  projectId: string; stage: string; error?: unknown; requestId?: string;
  revision?: number; savedEpisodes?: number; operationId?: string;
}) {
  const failure = input.error as { status?: number; failureClass?: string; errorType?: string; requestId?: string;
    error_code?: string; diagnostics?: Record<string, unknown> } | undefined;
  const identifier = (value: unknown) => typeof value === "string" && /^[\w.:-]{1,160}$/.test(value) ? value : undefined;
  const diagnostic = failure?.diagnostics;
  const nonnegative = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const httpStatus = diagnostic?.http_status;
  return {
    version: 1, capturedAt: new Date().toISOString(), projectId: identifier(input.projectId),
    stage: input.stage.slice(0, 80), requestId: identifier(failure?.requestId ?? input.requestId),
    status: typeof failure?.status === "number" ? failure.status : undefined,
    failureClass: identifier(failure?.failureClass ?? failure?.error_code), errorType: identifier(failure?.errorType ?? diagnostic?.error_type),
    category: identifier(diagnostic?.category), deadlineScope: identifier(diagnostic?.deadline_scope),
    upstreamStatus: typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : undefined,
    elapsedMs: nonnegative(diagnostic?.elapsed_ms), physicalRequests: nonnegative(diagnostic?.physical_requests),
    revision: input.revision, savedEpisodes: input.savedEpisodes, operationId: identifier(input.operationId),
  };
}
