import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { QueryResult, QueryResultRow } from 'pg'
import { normalizeGenerationTaskLifecycle } from '../../core/jobs/taskLease.js'
import { traceMetadata } from '../../core/observability/trace.js'
import { generationTaskColumns, taskFromRow, type GenerationTaskRow } from './repositoryData.js'

export async function findTaskByClientRequest(
  queryable: {
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<T>>
  },
  clientRequestId: string,
  principal: Principal,
): Promise<GenerationTask | null> {
  const result = await queryable.query<GenerationTaskRow>(
    `
    SELECT ${generationTaskColumns}
    FROM generation_tasks
    WHERE tenant_id = $1
      AND user_id = $2
      AND client_request_id = $3
    LIMIT 1
    `,
    [principal.tenantId, principal.userId, clientRequestId],
  )
  return result.rows[0] ? taskFromRow(result.rows[0]) : null
}

export function buildQueuedGenerationTask(
  input: CreateGenerationTask,
  principal: Principal,
  now: string,
  options: { traceId?: string | null } = {},
): GenerationTask {
  return normalizeGenerationTaskLifecycle({
    id: randomUUID(),
    clientRequestId: input.clientRequestId,
    projectId: input.projectId,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: input.kind,
    label: input.label,
    prompt: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    provider: input.provider,
    model: input.model ?? null,
    tier: input.tier ?? null,
    metadata: traceMetadata(input.metadata, options.traceId),
    status: 'queued',
    progress: 0,
    estimatedCredits: input.estimatedCredits,
    maxAttempts: input.maxAttempts,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  })
}
