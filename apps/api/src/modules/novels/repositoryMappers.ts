import type {
  NovelBoundary,
  NovelBoundaryDetectionResult,
  NovelBoundaryIssue,
  NovelChapter,
  NovelChapterSummary,
  NovelDocument,
  NovelSourceFormat,
  NovelSplitMode,
  NovelStoryBible,
  NovelSummaryQueue,
  NovelSummaryQueueItemResult,
  NovelSummaryQueueItemStatus,
  NovelSummaryQueueStatus,
} from '@seqora/contracts'
import type { QueryResultRow } from 'pg'
import type {
  StoredNovelChapter,
  StoredNovelDocument,
  StoredNovelSummaryQueue,
  StoredNovelSummaryQueueItem,
} from '../../infra/store.js'

export type NovelDocumentRow = QueryResultRow & {
  id: string
  project_id: string
  tenant_id: string
  name: string
  format: NovelSourceFormat
  character_count: number | string
  chapter_count: number | string
  content_storage_key: string
  content_sha256: string
  client_request_id: string | null
  created_at: Date | string
  updated_at: Date | string
}

export type NovelChapterRow = QueryResultRow & {
  id: string
  document_id: string
  project_id: string
  tenant_id: string
  chapter_order: number | string
  title: string
  start_offset: number | string
  end_offset: number | string
  source_start_offset: number | string
  source_end_offset: number | string
  source_chapter_title: string | null
  split_mode: NovelSplitMode
  overlap_before_chars: number | string
  overlap_after_chars: number | string
  crosses_chapter_boundary: boolean
  character_count: number | string
  preview: string
  preview_truncated: boolean
  created_at: Date | string
}

export type NovelBoundaryRow = QueryResultRow & {
  id: string
  document_id: string
  project_id: string
  tenant_id: string
  previous_chapter_id: string
  next_chapter_id: string
  previous_order: number | string
  next_order: number | string
  status: NovelBoundary['status']
  severity: NovelBoundary['severity']
  issues: unknown
  previous_tail: string
  next_head: string
  note: string | null
  created_at: Date | string
  updated_at: Date | string
}

export type NovelChapterSummaryRow = QueryResultRow & {
  id: string
  document_id: string
  chapter_id: string
  project_id: string
  tenant_id: string
  chapter_order: number | string
  title: string
  summary: string
  key_events: unknown
  characters: unknown
  locations: unknown
  timeline: unknown
  key_props: unknown
  foreshadowing: unknown
  world_rules: unknown
  adaptation_notes: string
  created_at: Date | string
  updated_at: Date | string
}

export type NovelSummaryQueueRow = QueryResultRow & {
  id: string
  document_id: string
  project_id: string
  tenant_id: string
  status: NovelSummaryQueueStatus
  batch_size: number | string
  force: boolean
  total_items: number | string
  pending_count: number | string
  running_count: number | string
  completed_count: number | string
  failed_count: number | string
  skipped_count: number | string
  client_request_id: string | null
  created_at: Date | string
  updated_at: Date | string
}

export type NovelSummaryQueueItemRow = QueryResultRow & {
  id: string
  queue_id: string
  document_id: string
  chapter_id: string
  project_id: string
  tenant_id: string
  chapter_order: number | string
  title: string
  status: NovelSummaryQueueItemStatus
  attempts: number | string
  max_attempts: number | string
  character_count: number | string
  source_start_offset: number | string
  source_end_offset: number | string
  source_chapter_title: string | null
  crosses_chapter_boundary: boolean
  summary_id: string | null
  result: unknown
  error_message: string | null
  locked_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

export type NovelStoryBibleRow = QueryResultRow & {
  id: string
  document_id: string
  project_id: string
  tenant_id: string
  title: string
  logline: string
  premise: string
  synopsis: string
  themes: unknown
  characters: unknown
  locations: unknown
  timeline: unknown
  key_props: unknown
  foreshadowing: unknown
  world_rules: unknown
  adaptation_strategy: string
  risks: unknown
  next_step: string
  source_summary_count: number | string
  chapter_count: number | string
  created_at: Date | string
  updated_at: Date | string
}

export type QueueCounts = Pick<
  NovelSummaryQueue,
  'pendingCount' | 'runningCount' | 'completedCount' | 'failedCount' | 'skippedCount'
>

export function documentFromRow(row: NovelDocumentRow): StoredNovelDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    name: row.name,
    format: row.format,
    characterCount: Number(row.character_count),
    chapterCount: Number(row.chapter_count),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
    ...(row.client_request_id ? { clientRequestId: row.client_request_id } : {}),
  }
}

export function chapterFromRow(row: NovelChapterRow): NovelChapter {
  return {
    id: row.id,
    documentId: row.document_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    order: Number(row.chapter_order),
    title: row.title,
    startOffset: Number(row.start_offset),
    endOffset: Number(row.end_offset),
    sourceStartOffset: Number(row.source_start_offset),
    sourceEndOffset: Number(row.source_end_offset),
    sourceChapterTitle: row.source_chapter_title,
    splitMode: row.split_mode,
    overlapBeforeChars: Number(row.overlap_before_chars),
    overlapAfterChars: Number(row.overlap_after_chars),
    crossesChapterBoundary: row.crosses_chapter_boundary,
    characterCount: Number(row.character_count),
    preview: row.preview,
    previewTruncated: row.preview_truncated,
    createdAt: isoString(row.created_at),
  }
}

export function chapterWithContentFromRow(row: NovelChapterRow, documentContent: string): StoredNovelChapter {
  return {
    ...chapterFromRow(row),
    content: documentContent.slice(Number(row.start_offset), Number(row.end_offset)),
  }
}

export function boundaryFromRow(row: NovelBoundaryRow): NovelBoundary {
  return {
    id: row.id,
    documentId: row.document_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    previousChapterId: row.previous_chapter_id,
    nextChapterId: row.next_chapter_id,
    previousOrder: Number(row.previous_order),
    nextOrder: Number(row.next_order),
    status: row.status,
    severity: row.severity,
    issues: jsonValue<NovelBoundaryIssue[]>(row.issues, []),
    previousTail: row.previous_tail,
    nextHead: row.next_head,
    note: row.note,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function summaryFromRow(row: NovelChapterSummaryRow): NovelChapterSummary {
  return {
    id: row.id,
    documentId: row.document_id,
    chapterId: row.chapter_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    order: Number(row.chapter_order),
    title: row.title,
    summary: row.summary,
    keyEvents: jsonValue(row.key_events, []),
    characters: jsonValue(row.characters, []),
    locations: jsonValue(row.locations, []),
    timeline: jsonValue(row.timeline, []),
    keyProps: jsonValue(row.key_props, []),
    foreshadowing: jsonValue(row.foreshadowing, []),
    worldRules: jsonValue(row.world_rules, []),
    adaptationNotes: row.adaptation_notes,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function summaryQueueFromRow(
  row: NovelSummaryQueueRow,
  items?: Array<{ status: NovelSummaryQueueItemStatus }>,
): StoredNovelSummaryQueue {
  const counts = items ? queueCounts(items) : null
  return {
    id: row.id,
    documentId: row.document_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    status: row.status,
    batchSize: Number(row.batch_size),
    force: row.force,
    totalItems: items ? items.length : Number(row.total_items),
    pendingCount: counts?.pendingCount ?? Number(row.pending_count),
    runningCount: counts?.runningCount ?? Number(row.running_count),
    completedCount: counts?.completedCount ?? Number(row.completed_count),
    failedCount: counts?.failedCount ?? Number(row.failed_count),
    skippedCount: counts?.skippedCount ?? Number(row.skipped_count),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
    ...(row.client_request_id ? { clientRequestId: row.client_request_id } : {}),
  }
}

export function summaryQueueFromAny(
  queue: StoredNovelSummaryQueue | NovelSummaryQueueRow,
  items: Array<{ status: NovelSummaryQueueItemStatus }>,
): NovelSummaryQueue {
  if ('document_id' in queue) {
    const { clientRequestId: _clientRequestId, ...publicQueue } = summaryQueueFromRow(queue, items)
    return publicQueue
  }
  const counts = queueCounts(items)
  const { clientRequestId: _clientRequestId, ...publicQueue } = queue
  return { ...publicQueue, ...counts, totalItems: items.length }
}

export function queueLikeRow(
  queue: StoredNovelSummaryQueue | NovelSummaryQueueRow,
): Pick<NovelSummaryQueueRow, 'id' | 'tenant_id'> {
  return 'tenant_id' in queue ? queue : { id: queue.id, tenant_id: queue.tenantId }
}

export function summaryQueueItemFromRow(row: NovelSummaryQueueItemRow): StoredNovelSummaryQueueItem {
  return {
    id: row.id,
    queueId: row.queue_id,
    documentId: row.document_id,
    chapterId: row.chapter_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    order: Number(row.chapter_order),
    title: row.title,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    characterCount: Number(row.character_count),
    sourceStartOffset: Number(row.source_start_offset),
    sourceEndOffset: Number(row.source_end_offset),
    sourceChapterTitle: row.source_chapter_title,
    crossesChapterBoundary: row.crosses_chapter_boundary,
    summaryId: row.summary_id,
    result: jsonValue<NovelSummaryQueueItemResult | null>(row.result, null),
    errorMessage: row.error_message,
    lockedAt: nullableIsoString(row.locked_at),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function storyBibleFromRow(row: NovelStoryBibleRow): NovelStoryBible {
  return {
    id: row.id,
    documentId: row.document_id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    title: row.title,
    logline: row.logline,
    premise: row.premise,
    synopsis: row.synopsis,
    themes: jsonValue(row.themes, []),
    characters: jsonValue(row.characters, []),
    locations: jsonValue(row.locations, []),
    timeline: jsonValue(row.timeline, []),
    keyProps: jsonValue(row.key_props, []),
    foreshadowing: jsonValue(row.foreshadowing, []),
    worldRules: jsonValue(row.world_rules, []),
    adaptationStrategy: row.adaptation_strategy,
    risks: jsonValue(row.risks, []),
    nextStep: row.next_step,
    sourceSummaryCount: Number(row.source_summary_count),
    chapterCount: Number(row.chapter_count),
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  }
}

export function toBoundaryDetectionResultFromDatabase(
  document: NovelDocumentRow,
  boundaries: NovelBoundaryRow[],
  warnings: string[],
): NovelBoundaryDetectionResult {
  return {
    document: documentFromRow(document),
    boundaries: boundaries.map(boundaryFromRow),
    detectedAt: new Date().toISOString(),
    warnings,
  }
}

export function queueCounts(items: Array<{ status: NovelSummaryQueueItemStatus }>): QueueCounts {
  return {
    pendingCount: items.filter((item) => item.status === 'pending').length,
    runningCount: items.filter((item) => item.status === 'running').length,
    completedCount: items.filter((item) => item.status === 'completed').length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    skippedCount: items.filter((item) => item.status === 'skipped').length,
  }
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return structuredClone(value) as T
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : isoString(value)
}

export function toDocument(document: StoredNovelDocument): NovelDocument {
  const { clientRequestId: _clientRequestId, ...publicDocument } = document
  return publicDocument
}

export function toChapter(chapter: StoredNovelChapter): NovelChapter {
  const { content: _content, ...publicChapter } = chapter
  const preview = chapterPreviewFor(chapter.content, chapter.title)
  return {
    ...publicChapter,
    sourceStartOffset: chapter.sourceStartOffset ?? chapter.startOffset,
    sourceEndOffset: chapter.sourceEndOffset ?? chapter.endOffset,
    sourceChapterTitle: chapter.sourceChapterTitle ?? chapter.title,
    splitMode: chapter.splitMode ?? 'auto',
    overlapBeforeChars: chapter.overlapBeforeChars ?? 0,
    overlapAfterChars: chapter.overlapAfterChars ?? 0,
    crossesChapterBoundary: chapter.crossesChapterBoundary ?? false,
    preview: preview.text,
    previewTruncated: preview.truncated,
  }
}

function chapterPreviewFor(content: string, title: string): { text: string; truncated: boolean } {
  const limit = 3_000
  const text = content
    .replace(title, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return {
    text: text.length <= limit ? text : text.slice(0, limit).trimEnd(),
    truncated: text.length > limit,
  }
}
