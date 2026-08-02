export function traceIdFromRecord(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null
  const traceId = value.traceId
  return typeof traceId === 'string' && traceId.length > 0 ? traceId : null
}

export function traceMetadata(
  metadata: Record<string, unknown> | undefined,
  traceId?: string | null,
): Record<string, unknown> {
  if (!traceId) return metadata ?? {}
  return {
    ...(metadata ?? {}),
    traceId,
  }
}

export function traceContext(traceId?: string | null): { traceId?: string | null } {
  return traceId ? { traceId } : {}
}

export function traceIdFromGenerationTask(task: {
  metadata?: Record<string, unknown> | null
}): string | null {
  return traceIdFromRecord(task.metadata ?? null)
}

export function traceIdFromAiJob(job: { input?: Record<string, unknown> | null }): string | null {
  return traceIdFromRecord(job.input ?? null)
}
