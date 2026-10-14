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
      AND project_id NOT LIKE 'sm-standalone-%'
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
  // Review and provenance are server-owned; generic create metadata cannot approve new media.
  const {
    contentReview: _review,
    contentReviewHistory: _history,
    localPostprocess: _post,
    deliveryContract: _deliveryContract,
    deliveryDownloads: _deliveryDownloads,
    providerCompletionReceipt: _providerCompletionReceipt,
    providerTaskId: _providerTaskId,
    providerName: _providerName,
    providerState: _providerState,
    providerIdempotencyKey: _providerIdempotencyKey,
    providerSubmittedAt: _providerSubmittedAt,
    providerPolledAt: _providerPolledAt,
    providerProgressChangedAt: _providerProgressChangedAt,
    providerPollErrors: _providerPollErrors,
    providerPreviousTaskIds: _providerPreviousTaskIds,
    providerProcessingTimeoutRetries: _providerProcessingTimeoutRetries,
    providerProcessingTimedOutAt: _providerProcessingTimedOutAt,
    providerRetryNotBefore: _providerRetryNotBefore,
    providerSubmissionRetries: _providerSubmissionRetries,
    providerSubmissionRecoveredAt: _providerSubmissionRecoveredAt,
    providerSubmissionTimedOutAt: _providerSubmissionTimedOutAt,
    providerSubmissionError: _providerSubmissionError,
    providerCancelRequestedAt: _providerCancelRequestedAt,
    providerCancelCompletedAt: _providerCancelCompletedAt,
    providerCancelSkippedAt: _providerCancelSkippedAt,
    providerCompletionWriteback: _providerCompletionWriteback,
    generatedOutputs: _generatedOutputs,
    videoStorageKey: _videoStorageKey,
    videoContentType: _videoContentType,
    videoSize: _videoSize,
    lastFrameStorageKey: _lastFrameStorageKey,
    lastFrameContentType: _lastFrameContentType,
    previewStorageKey: _previewStorageKey,
    previewContentType: _previewContentType,
    previewSize: _previewSize,
    previewSha256: _previewSha256,
    ...metadata
  } = input.metadata ?? {}
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
    metadata: traceMetadata(metadata, options.traceId),
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

export function taskInsertParams(task: GenerationTask, membershipId: string | null): unknown[] {
  return [
    task.id,
    task.clientRequestId,
    task.projectId,
    task.tenantId,
    task.userId,
    membershipId,
    task.kind,
    task.label,
    task.prompt,
    task.negativePrompt,
    task.provider,
    task.model,
    task.tier ?? null,
    JSON.stringify(task.metadata),
    task.status,
    task.progress,
    task.estimatedCredits,
    task.attempts ?? 0,
    task.maxAttempts ?? null,
    task.leaseOwnerId ?? null,
    task.leaseToken ?? null,
    task.leaseAcquiredAt ?? null,
    task.leaseHeartbeatAt ?? null,
    task.leaseExpiresAt ?? null,
    task.resultUrl,
    JSON.stringify(task.outputs),
    task.error,
    task.createdAt,
    task.updatedAt,
  ]
}
