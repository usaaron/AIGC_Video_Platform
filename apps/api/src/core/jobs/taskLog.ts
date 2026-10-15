import type { GenerationTask, GenerationTaskLog } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

export type TaskLogInput = {
  level: GenerationTaskLog['level']
  event: string
  message: string
  details?: Record<string, unknown>
  createdAt?: string
}

const MAX_METADATA_LOGS = 200

export function createTaskLog(task: GenerationTask, input: TaskLogInput): GenerationTaskLog {
  const createdAt = input.createdAt ?? new Date().toISOString()
  return {
    id: randomUUID(),
    taskId: task.id,
    projectId: task.projectId,
    tenantId: task.tenantId,
    userId: task.userId,
    level: input.level,
    event: input.event.slice(0, 128),
    message: input.message.slice(0, 1_000),
    details: sanitizeDetails(input.details ?? {}),
    createdAt,
  }
}

export function appendTaskLogToMetadata(
  metadata: Record<string, unknown>,
  task: GenerationTask,
  input: TaskLogInput,
): Record<string, unknown> {
  const log = createTaskLog(task, input)
  return {
    ...metadata,
    taskLogs: [...taskLogsFromMetadata(metadata), log].slice(-MAX_METADATA_LOGS),
  }
}

export function taskLogsFromMetadata(metadata: Record<string, unknown>): GenerationTaskLog[] {
  const logs = metadata.taskLogs
  if (!Array.isArray(logs)) return []
  return logs.flatMap((item) => normalizeTaskLog(item)).sort(compareLogCreatedAt)
}

export async function insertTaskLog(
  client: PoolClient,
  task: GenerationTask,
  input: TaskLogInput,
): Promise<GenerationTaskLog> {
  const log = createTaskLog(task, input)
  await client.query(
    `
      insert into generation_task_logs (
        id, task_id, project_id, tenant_id, user_id, level, event, message, details, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      on conflict (id) do nothing
    `,
    [
      log.id,
      log.taskId,
      log.projectId,
      log.tenantId,
      log.userId,
      log.level,
      log.event,
      log.message,
      JSON.stringify(log.details),
      log.createdAt,
    ],
  )
  return log
}

function normalizeTaskLog(value: unknown): GenerationTaskLog[] {
  if (!isRecord(value)) return []
  if (
    typeof value.id !== 'string' ||
    typeof value.taskId !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof value.tenantId !== 'string' ||
    typeof value.userId !== 'string' ||
    typeof value.event !== 'string' ||
    typeof value.message !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return []
  }
  if (value.level !== 'info' && value.level !== 'warn' && value.level !== 'error') return []
  return [
    {
      id: value.id,
      taskId: value.taskId,
      projectId: value.projectId,
      tenantId: value.tenantId,
      userId: value.userId,
      level: value.level,
      event: value.event,
      message: value.message,
      details: isRecord(value.details) ? sanitizeDetails(value.details) : {},
      createdAt: value.createdAt,
    },
  ]
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !/key|secret|token|password|prompt|body|content/i.test(key))
      .map(([key, value]) => [key.slice(0, 80), sanitizeValue(value)]),
  )
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue)
  if (!isRecord(value)) return String(value).slice(0, 500)
  return sanitizeDetails(value)
}

function compareLogCreatedAt(left: GenerationTaskLog, right: GenerationTaskLog): number {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
