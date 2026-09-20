/** An allowlist: never include prompts, screenplay, model output, auth or URLs. */
export function generationDiagnostics(input: {
  projectId: string; stage: string; error?: unknown; requestId?: string;
  revision?: number; savedEpisodes?: number; operationId?: string;
}) {
  const failure = input.error as { status?: number; failureClass?: string; errorType?: string; requestId?: string } | undefined;
  const identifier = (value: unknown) => typeof value === "string" && /^[\w.:-]{1,160}$/.test(value) ? value : undefined;
  return {
    version: 1, capturedAt: new Date().toISOString(), projectId: identifier(input.projectId),
    stage: input.stage.slice(0, 80), requestId: identifier(failure?.requestId ?? input.requestId),
    status: typeof failure?.status === "number" ? failure.status : undefined,
    failureClass: identifier(failure?.failureClass), errorType: identifier(failure?.errorType),
    revision: input.revision, savedEpisodes: input.savedEpisodes, operationId: identifier(input.operationId),
  };
}
