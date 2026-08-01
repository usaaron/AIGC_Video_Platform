import type {
  CreateNovelSummaryQueueRequest,
  ImportNovelRequest,
  NovelBoundary,
  NovelBoundaryIssue,
  NovelBoundaryDetectionResult,
  NovelBoundaryNotesResult,
  NovelChapter,
  NovelChapterSummary,
  NovelDocument,
  NovelSourceFormat,
  NovelImportResult,
  NovelSummaryQueue,
  NovelSummaryQueueCommitResult,
  NovelSummaryQueueItemStatus,
  NovelSummaryQueueItemResult,
  NovelSummaryQueueResult,
  NovelSummaryQueueStatus,
  NovelStoryBible,
  NovelSplitMode,
  Principal,
} from '@seqora/contracts'
import { createHash, randomUUID } from 'node:crypto'
import type { QueryResult, QueryResultRow } from 'pg'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { AccountDatabase } from '../../infra/postgres.js'
import type {
  AppState,
  AppStore,
  StoredNovelChapter,
  StoredNovelBoundary,
  StoredNovelDocument,
  StoredNovelSummaryQueue,
  StoredNovelSummaryQueueItem,
  StoredNovelStoryBible,
} from '../../infra/store.js'

type NovelChapterDraft = Pick<
  StoredNovelChapter,
  | 'order'
  | 'title'
  | 'startOffset'
  | 'endOffset'
  | 'sourceStartOffset'
  | 'sourceEndOffset'
  | 'sourceChapterTitle'
  | 'splitMode'
  | 'overlapBeforeChars'
  | 'overlapAfterChars'
  | 'crossesChapterBoundary'
  | 'characterCount'
  | 'preview'
  | 'content'
>

type NovelChapterSummaryDraft = Omit<
  NovelChapterSummary,
  'id' | 'projectId' | 'tenantId' | 'documentId' | 'createdAt' | 'updatedAt'
>

type NovelStoryBibleDraft = Omit<
  NovelStoryBible,
  | 'id'
  | 'projectId'
  | 'tenantId'
  | 'documentId'
  | 'sourceSummaryCount'
  | 'chapterCount'
  | 'createdAt'
  | 'updatedAt'
>

type NovelGenerationSource = {
  document: StoredNovelDocument
  chapters: StoredNovelChapter[]
  summaries: NovelChapterSummary[]
  storyBible: NovelStoryBible | null
}

type NovelSummaryQueueSource = {
  document: StoredNovelDocument
  queue: StoredNovelSummaryQueue
  items: StoredNovelSummaryQueueItem[]
  chapters: StoredNovelChapter[]
}

type NovelBoundaryDetectionSource = {
  document: StoredNovelDocument
  chapters: StoredNovelChapter[]
  boundaries: StoredNovelBoundary[]
}

type NovelBoundaryDraft = Pick<
  NovelBoundary,
  | 'previousChapterId'
  | 'nextChapterId'
  | 'previousOrder'
  | 'nextOrder'
  | 'severity'
  | 'issues'
  | 'previousTail'
  | 'nextHead'
>

type NovelBoundaryNoteDraft = {
  boundaryId: string
  note: string
}

type QueueCounts = Pick<
  NovelSummaryQueue,
  'pendingCount' | 'runningCount' | 'completedCount' | 'failedCount' | 'skippedCount'
>

type WritableSummaryQueueContext = {
  project: AppState['projects'][number]
  document: StoredNovelDocument
  queue: StoredNovelSummaryQueue
}

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

type NovelDocumentRow = QueryResultRow & {
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

type NovelChapterRow = QueryResultRow & {
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

type NovelBoundaryRow = QueryResultRow & {
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

type NovelChapterSummaryRow = QueryResultRow & {
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

type NovelSummaryQueueRow = QueryResultRow & {
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

type NovelSummaryQueueItemRow = QueryResultRow & {
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

type NovelStoryBibleRow = QueryResultRow & {
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

type NovelJsonImportResult = {
  documents: { inserted: number; skipped: number }
  chapters: { inserted: number; skipped: number }
  boundaries: { inserted: number; skipped: number }
  summaries: { inserted: number; skipped: number }
  summaryQueues: { inserted: number; skipped: number }
  summaryQueueItems: { inserted: number; skipped: number }
  storyBibles: { inserted: number; skipped: number }
}

const documentColumns = `
  id,
  project_id,
  tenant_id,
  name,
  format,
  character_count,
  chapter_count,
  content_storage_key,
  content_sha256,
  client_request_id,
  created_at,
  updated_at
`

const chapterColumns = `
  id,
  document_id,
  project_id,
  tenant_id,
  chapter_order,
  title,
  start_offset,
  end_offset,
  source_start_offset,
  source_end_offset,
  source_chapter_title,
  split_mode,
  overlap_before_chars,
  overlap_after_chars,
  crosses_chapter_boundary,
  character_count,
  preview,
  preview_truncated,
  created_at
`

const boundaryColumns = `
  id,
  document_id,
  project_id,
  tenant_id,
  previous_chapter_id,
  next_chapter_id,
  previous_order,
  next_order,
  status,
  severity,
  issues,
  previous_tail,
  next_head,
  note,
  created_at,
  updated_at
`

const summaryColumns = `
  id,
  document_id,
  chapter_id,
  project_id,
  tenant_id,
  chapter_order,
  title,
  summary,
  key_events,
  characters,
  locations,
  timeline,
  key_props,
  foreshadowing,
  world_rules,
  adaptation_notes,
  created_at,
  updated_at
`

const summaryQueueColumns = `
  id,
  document_id,
  project_id,
  tenant_id,
  status,
  batch_size,
  force,
  total_items,
  pending_count,
  running_count,
  completed_count,
  failed_count,
  skipped_count,
  client_request_id,
  created_at,
  updated_at
`

const summaryQueueItemColumns = `
  id,
  queue_id,
  document_id,
  chapter_id,
  project_id,
  tenant_id,
  chapter_order,
  title,
  status,
  attempts,
  max_attempts,
  character_count,
  source_start_offset,
  source_end_offset,
  source_chapter_title,
  crosses_chapter_boundary,
  summary_id,
  result,
  error_message,
  locked_at,
  created_at,
  updated_at
`

const storyBibleColumns = `
  id,
  document_id,
  project_id,
  tenant_id,
  title,
  logline,
  premise,
  synopsis,
  themes,
  characters,
  locations,
  timeline,
  key_props,
  foreshadowing,
  world_rules,
  adaptation_strategy,
  risks,
  next_step,
  source_summary_count,
  chapter_count,
  created_at,
  updated_at
`

export class NovelRepository {
  constructor(
    private readonly store: AppStore,
    private readonly database: AccountDatabase | null = null,
    private readonly objectStorage: ObjectStorage | null = null,
  ) {}

  async importFromStore(): Promise<NovelJsonImportResult> {
    if (!this.database || !this.objectStorage) return emptyNovelJsonImportResult()
    const snapshot = this.store.read((state) => ({
      documents: state.novelDocuments,
      chapters: state.novelChapters,
      boundaries: state.novelBoundaries,
      summaries: state.novelChapterSummaries,
      summaryQueues: state.novelSummaryQueues,
      summaryQueueItems: state.novelSummaryQueueItems,
      storyBibles: state.novelStoryBibles,
    }))
    return importNovelSnapshotFromStore(this.database, this.objectStorage, snapshot)
  }

  canImportNovel(projectId: string, principal: Principal): boolean {
    return this.store.read((state) => Boolean(findWritableProject(state, projectId, principal)))
  }

  async list(projectId: string, principal: Principal): Promise<NovelDocument[] | null> {
    if (this.database && this.objectStorage)
      return listDocumentsFromDatabase(this.database, projectId, principal)
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      return state.novelDocuments
        .filter((document) => document.projectId === projectId && document.tenantId === principal.tenantId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(toDocument)
    })
  }

  async detail(
    projectId: string,
    documentId: string,
    principal: Principal,
  ): Promise<NovelImportResult | null> {
    if (this.database && this.objectStorage) {
      return detailFromDatabase(this.database, projectId, documentId, principal)
    }
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      const document = state.novelDocuments.find(
        (item) =>
          item.id === documentId && item.projectId === projectId && item.tenantId === principal.tenantId,
      )
      if (!document) return null
      return toResult(document, state)
    })
  }

  boundaries(
    projectId: string,
    documentId: string,
    principal: Principal,
  ): Promise<NovelBoundaryDetectionResult | null> | NovelBoundaryDetectionResult | null {
    if (this.database && this.objectStorage) {
      return boundariesFromDatabase(this.database, projectId, documentId, principal)
    }
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!document) return null
      return toBoundaryDetectionResult(document, boundariesFor(state, document), [])
    })
  }

  boundaryDetectionSource(
    projectId: string,
    documentId: string,
    principal: Principal,
  ): Promise<NovelBoundaryDetectionSource | null> | NovelBoundaryDetectionSource | null {
    if (this.database && this.objectStorage) {
      return boundaryDetectionSourceFromDatabase(
        this.database,
        this.objectStorage,
        projectId,
        documentId,
        principal,
      )
    }
    return this.store.read((state) => {
      if (!findWritableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!document) return null
      return {
        document,
        chapters: chaptersFor(state, document),
        boundaries: boundariesFor(state, document),
      }
    })
  }

  async saveDetectedBoundaries(
    projectId: string,
    documentId: string,
    drafts: NovelBoundaryDraft[],
    force: boolean,
    principal: Principal,
    warnings: string[] = [],
  ): Promise<NovelBoundaryDetectionResult | null> {
    if (this.database && this.objectStorage) {
      return saveDetectedBoundariesInDatabase(
        this.database,
        projectId,
        documentId,
        drafts,
        force,
        principal,
        warnings,
      )
    }
    return this.store.mutate((state) => {
      const project = findWritableProject(state, projectId, principal)
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!project || !document) return null

      if (!force) {
        const existing = boundariesFor(state, document)
        if (existing.length) return toBoundaryDetectionResult(document, existing, warnings)
      }

      const now = new Date().toISOString()
      state.novelBoundaries = state.novelBoundaries.filter(
        (boundary) => boundary.documentId !== document.id || boundary.tenantId !== document.tenantId,
      )
      const boundaries: StoredNovelBoundary[] = drafts.map((draft) => ({
        id: randomUUID(),
        documentId,
        projectId,
        tenantId: principal.tenantId,
        previousChapterId: draft.previousChapterId,
        nextChapterId: draft.nextChapterId,
        previousOrder: draft.previousOrder,
        nextOrder: draft.nextOrder,
        status: 'pending',
        severity: draft.severity,
        issues: draft.issues,
        previousTail: draft.previousTail,
        nextHead: draft.nextHead,
        note: null,
        createdAt: now,
        updatedAt: now,
      }))

      state.novelBoundaries.push(...boundaries)
      document.updatedAt = now
      project.updatedAt = now
      return toBoundaryDetectionResult(document, boundaries, warnings)
    })
  }

  async saveBoundaryNotes(
    projectId: string,
    documentId: string,
    drafts: NovelBoundaryNoteDraft[],
    force: boolean,
    principal: Principal,
    warnings: string[] = [],
  ): Promise<NovelBoundaryNotesResult | null> {
    if (this.database && this.objectStorage) {
      return saveBoundaryNotesInDatabase(
        this.database,
        projectId,
        documentId,
        drafts,
        force,
        principal,
        warnings,
      )
    }
    return this.store.mutate((state) => {
      const project = findWritableProject(state, projectId, principal)
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!project || !document) return null
      const now = new Date().toISOString()
      const generatedBoundaryIds: string[] = []

      for (const draft of drafts) {
        const boundary = state.novelBoundaries.find(
          (item) =>
            item.id === draft.boundaryId &&
            item.documentId === documentId &&
            item.projectId === projectId &&
            item.tenantId === principal.tenantId,
        )
        if (!boundary || (boundary.note && !force)) continue
        boundary.note = draft.note
        boundary.status = 'resolved'
        boundary.updatedAt = now
        generatedBoundaryIds.push(boundary.id)
      }

      document.updatedAt = now
      project.updatedAt = now
      const boundaries = boundariesFor(state, document)
      return {
        document: toDocument(document),
        boundaries,
        generatedBoundaryIds,
        missingNoteCount: missingBoundaryNoteCount(boundaries),
        generatedAt: now,
        warnings,
      }
    })
  }

  async summaries(
    projectId: string,
    documentId: string,
    principal: Principal,
  ): Promise<NovelChapterSummary[] | null> {
    if (this.database && this.objectStorage) {
      return summariesFromDatabase(this.database, projectId, documentId, principal)
    }
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!document) return null
      return summariesFor(state, document).map((summary) => ({ ...summary }))
    })
  }

  async summaryQueue(
    projectId: string,
    documentId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return summaryQueueFromDatabase(this.database, projectId, documentId, principal)
    }
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!document) return null
      const queue = latestSummaryQueueFor(state, document)
      return toSummaryQueueResult(document, queue, state)
    })
  }

  summaryQueueSource(
    projectId: string,
    documentId: string,
    queueId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueSource | null> | NovelSummaryQueueSource | null {
    if (this.database && this.objectStorage) {
      return summaryQueueSourceFromDatabase(
        this.database,
        this.objectStorage,
        projectId,
        documentId,
        queueId,
        principal,
      )
    }
    return this.store.read((state) => {
      if (!findWritableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      const queue = document ? findSummaryQueue(state, document, queueId) : null
      if (!document || !queue) return null
      return {
        document,
        queue,
        items: queueItemsFor(state, queue),
        chapters: chaptersFor(state, document),
      }
    })
  }

  private async updateSummaryQueueStatus(
    projectId: string,
    documentId: string,
    queueId: string,
    status: NovelSummaryQueueStatus,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return updateSummaryQueueStatusInDatabase(
        this.database,
        projectId,
        documentId,
        queueId,
        status,
        principal,
      )
    }
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      if (!context) return null
      context.queue.status = status
      touchQueueContext(context, state, undefined, false)
      return toSummaryQueueResult(context.document, context.queue, state)
    })
  }

  async pauseSummaryQueue(
    projectId: string,
    documentId: string,
    queueId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    return this.updateSummaryQueueStatus(projectId, documentId, queueId, 'paused', principal)
  }

  async resumeSummaryQueue(
    projectId: string,
    documentId: string,
    queueId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage)
      return resumeSummaryQueueInDatabase(this.database, projectId, documentId, queueId, principal)
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      if (!context) return null
      const items = queueItemsFor(state, context.queue)
      const counts = queueCounts(items)
      context.queue.status = counts.pendingCount > 0 ? 'queued' : statusForQueueItems(items)
      touchQueueContext(context, state)
      return toSummaryQueueResult(context.document, context.queue, state)
    })
  }

  async startSummaryQueueItem(
    projectId: string,
    documentId: string,
    queueId: string,
    itemId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return startSummaryQueueItemInDatabase(this.database, projectId, documentId, queueId, itemId, principal)
    }
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      const item = context ? findQueueItem(state, context.queue, itemId) : null
      if (!context || !item || item.status !== 'pending') return null
      const now = new Date().toISOString()
      item.status = 'running'
      item.attempts += 1
      item.lockedAt = now
      item.errorMessage = null
      item.updatedAt = now
      context.queue.status = 'running'
      touchQueueContext(context, state, now)
      return toSummaryQueueResult(context.document, context.queue, state)
    })
  }

  async completeSummaryQueueItem(
    projectId: string,
    documentId: string,
    queueId: string,
    itemId: string,
    result: NovelSummaryQueueItemResult,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return completeSummaryQueueItemInDatabase(
        this.database,
        projectId,
        documentId,
        queueId,
        itemId,
        result,
        principal,
      )
    }
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      const item = context ? findQueueItem(state, context.queue, itemId) : null
      if (!context || !item) return null
      const now = new Date().toISOString()
      item.status = 'completed'
      item.result = result
      item.errorMessage = null
      item.lockedAt = null
      item.updatedAt = now
      refreshQueueStatus(context.queue, state)
      touchQueueContext(context, state, now)
      return toSummaryQueueResult(context.document, context.queue, state)
    })
  }

  async failSummaryQueueItem(
    projectId: string,
    documentId: string,
    queueId: string,
    itemId: string,
    errorMessage: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return failSummaryQueueItemInDatabase(
        this.database,
        projectId,
        documentId,
        queueId,
        itemId,
        errorMessage,
        principal,
      )
    }
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      const item = context ? findQueueItem(state, context.queue, itemId) : null
      if (!context || !item) return null
      const now = new Date().toISOString()
      item.status = 'failed'
      item.errorMessage = errorMessage
      item.lockedAt = null
      item.updatedAt = now
      refreshQueueStatus(context.queue, state)
      touchQueueContext(context, state, now)
      return toSummaryQueueResult(context.document, context.queue, state)
    })
  }

  async retrySummaryQueueItem(
    projectId: string,
    documentId: string,
    queueId: string,
    itemId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return retrySummaryQueueItemInDatabase(this.database, projectId, documentId, queueId, itemId, principal)
    }
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      const item = context ? findQueueItem(state, context.queue, itemId) : null
      if (!context || !item || !['failed', 'skipped'].includes(item.status)) return null
      const now = new Date().toISOString()
      item.status = 'pending'
      item.errorMessage = null
      item.lockedAt = null
      item.updatedAt = now
      context.queue.status = 'queued'
      touchQueueContext(context, state, now)
      return toSummaryQueueResult(context.document, context.queue, state)
    })
  }

  async skipSummaryQueueItem(
    projectId: string,
    documentId: string,
    queueId: string,
    itemId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return skipSummaryQueueItemInDatabase(this.database, projectId, documentId, queueId, itemId, principal)
    }
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      const item = context ? findQueueItem(state, context.queue, itemId) : null
      if (!context || !item || item.status === 'completed') return null
      const now = new Date().toISOString()
      item.status = 'skipped'
      item.errorMessage = null
      item.lockedAt = null
      item.updatedAt = now
      refreshQueueStatus(context.queue, state)
      touchQueueContext(context, state, now)
      return toSummaryQueueResult(context.document, context.queue, state)
    })
  }

  async commitSummaryQueueResults(
    projectId: string,
    documentId: string,
    queueId: string,
    force: boolean,
    principal: Principal,
  ): Promise<NovelSummaryQueueCommitResult | null> {
    if (this.database && this.objectStorage) {
      return commitSummaryQueueResultsInDatabase(
        this.database,
        projectId,
        documentId,
        queueId,
        force,
        principal,
      )
    }
    return this.store.mutate((state) => {
      const context = findWritableSummaryQueueContext(state, projectId, documentId, queueId, principal)
      if (!context) return null
      const now = new Date().toISOString()
      const committedItemIds: string[] = []
      const skippedItemIds: string[] = []
      const warnings: string[] = []

      for (const item of queueItemsFor(state, context.queue)) {
        if (item.status !== 'completed' || !item.result) {
          skippedItemIds.push(item.id)
          continue
        }

        const existingIndex = state.novelChapterSummaries.findIndex(
          (summary) =>
            summary.projectId === projectId &&
            summary.documentId === documentId &&
            summary.chapterId === item.chapterId &&
            summary.tenantId === principal.tenantId,
        )
        const existing = existingIndex >= 0 ? state.novelChapterSummaries[existingIndex] : null
        if (existing && !force) {
          item.summaryId = existing.id
          item.updatedAt = now
          committedItemIds.push(item.id)
          continue
        }

        const summary: NovelChapterSummary = {
          id: existing?.id ?? randomUUID(),
          projectId,
          tenantId: principal.tenantId,
          documentId,
          chapterId: item.chapterId,
          order: item.order,
          title: item.title,
          summary: item.result.summary,
          keyEvents: item.result.keyEvents,
          characters: item.result.characters,
          locations: item.result.locations,
          timeline: item.result.timeline,
          keyProps: item.result.keyProps,
          foreshadowing: item.result.foreshadowing,
          worldRules: item.result.worldRules,
          adaptationNotes: item.result.adaptationNotes,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        if (existingIndex >= 0) state.novelChapterSummaries[existingIndex] = summary
        else state.novelChapterSummaries.push(summary)
        item.summaryId = summary.id
        item.updatedAt = now
        committedItemIds.push(item.id)
      }

      if (!committedItemIds.length) warnings.push('没有可提交的已完成摘要结果')
      touchQueueContext(context, state, now)
      return {
        ...toSummaryQueueResult(context.document, context.queue, state),
        summaries: summariesFor(state, context.document),
        committedItemIds,
        skippedItemIds,
        warnings,
      }
    })
  }

  async storyBible(
    projectId: string,
    documentId: string,
    principal: Principal,
  ): Promise<NovelStoryBible | null> {
    if (this.database && this.objectStorage) {
      return storyBibleFromDatabase(this.database, projectId, documentId, principal)
    }
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!document) return null
      return storyBibleFor(state, document)
    })
  }

  sourceForGeneration(
    projectId: string,
    documentId: string,
    principal: Principal,
  ): Promise<NovelGenerationSource | null> | NovelGenerationSource | null {
    if (this.database && this.objectStorage) {
      return generationSourceFromDatabase(this.database, this.objectStorage, projectId, documentId, principal)
    }
    return this.store.read((state) => {
      if (!findWritableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!document) return null
      return {
        document,
        chapters: chaptersFor(state, document),
        summaries: summariesFor(state, document),
        storyBible: storyBibleFor(state, document),
      }
    })
  }

  async importNovel(
    projectId: string,
    input: ImportNovelRequest,
    chapters: NovelChapterDraft[],
    principal: Principal,
  ): Promise<NovelImportResult | null> {
    if (this.database && this.objectStorage) {
      return importNovelInDatabase(this.database, this.objectStorage, projectId, input, chapters, principal)
    }
    return this.store.mutate((state) => {
      const project = findWritableProject(state, projectId, principal)
      if (!project) return null

      const existing = input.clientRequestId
        ? state.novelDocuments.find(
            (document) =>
              document.projectId === projectId &&
              document.tenantId === principal.tenantId &&
              document.clientRequestId === input.clientRequestId,
          )
        : null
      if (existing) return toResult(existing, state)

      const now = new Date().toISOString()
      const document: StoredNovelDocument = {
        id: randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        name: input.name,
        format: input.format,
        characterCount: chapters.reduce((total, chapter) => total + chapter.characterCount, 0),
        chapterCount: chapters.length,
        createdAt: now,
        updatedAt: now,
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      }
      const storedChapters: StoredNovelChapter[] = chapters.map((chapter) => ({
        id: randomUUID(),
        documentId: document.id,
        projectId,
        tenantId: principal.tenantId,
        order: chapter.order,
        title: chapter.title,
        startOffset: chapter.startOffset,
        endOffset: chapter.endOffset,
        sourceStartOffset: chapter.sourceStartOffset,
        sourceEndOffset: chapter.sourceEndOffset,
        sourceChapterTitle: chapter.sourceChapterTitle,
        splitMode: chapter.splitMode,
        overlapBeforeChars: chapter.overlapBeforeChars,
        overlapAfterChars: chapter.overlapAfterChars,
        crossesChapterBoundary: chapter.crossesChapterBoundary,
        characterCount: chapter.characterCount,
        preview: chapter.preview,
        previewTruncated: chapter.content.trim().length > 3_000,
        content: chapter.content,
        createdAt: now,
      }))

      state.novelDocuments.push(document)
      state.novelChapters.push(...storedChapters)
      project.updatedAt = now
      return {
        document: toDocument(document),
        chapters: storedChapters.map(toChapter),
      }
    })
  }

  async saveChapterSummaries(
    projectId: string,
    documentId: string,
    drafts: NovelChapterSummaryDraft[],
    principal: Principal,
    force: boolean,
  ): Promise<NovelChapterSummary[] | null> {
    if (this.database && this.objectStorage) {
      return saveChapterSummariesInDatabase(this.database, projectId, documentId, drafts, principal, force)
    }
    return this.store.mutate((state) => {
      const project = findWritableProject(state, projectId, principal)
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!project || !document) return null

      const now = new Date().toISOString()
      const stored: NovelChapterSummary[] = []
      for (const draft of drafts) {
        const existingIndex = state.novelChapterSummaries.findIndex(
          (summary) =>
            summary.projectId === projectId &&
            summary.documentId === documentId &&
            summary.chapterId === draft.chapterId &&
            summary.tenantId === principal.tenantId,
        )
        if (existingIndex >= 0 && !force) {
          stored.push(state.novelChapterSummaries[existingIndex]!)
          continue
        }

        const existing = existingIndex >= 0 ? state.novelChapterSummaries[existingIndex] : null
        const summary: NovelChapterSummary = {
          id: existing?.id ?? randomUUID(),
          projectId,
          tenantId: principal.tenantId,
          documentId,
          chapterId: draft.chapterId,
          order: draft.order,
          title: draft.title,
          summary: draft.summary,
          keyEvents: draft.keyEvents,
          characters: draft.characters,
          locations: draft.locations,
          timeline: draft.timeline,
          keyProps: draft.keyProps,
          foreshadowing: draft.foreshadowing,
          worldRules: draft.worldRules,
          adaptationNotes: draft.adaptationNotes,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        if (existingIndex >= 0) state.novelChapterSummaries[existingIndex] = summary
        else state.novelChapterSummaries.push(summary)
        stored.push(summary)
      }

      document.updatedAt = now
      project.updatedAt = now
      return summariesFor(state, document)
    })
  }

  async createSummaryQueue(
    projectId: string,
    documentId: string,
    input: CreateNovelSummaryQueueRequest,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult | null> {
    if (this.database && this.objectStorage) {
      return createSummaryQueueInDatabase(this.database, projectId, documentId, input, principal)
    }
    return this.store.mutate((state) => {
      const project = findWritableProject(state, projectId, principal)
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!project || !document) return null

      const existing = input.clientRequestId
        ? state.novelSummaryQueues.find(
            (queue) =>
              queue.projectId === projectId &&
              queue.documentId === documentId &&
              queue.tenantId === principal.tenantId &&
              queue.clientRequestId === input.clientRequestId,
          )
        : null
      if (existing) return toSummaryQueueResult(document, existing, state)

      const now = new Date().toISOString()
      const summarizedIds = new Set(summariesFor(state, document).map((summary) => summary.chapterId))
      const requestedIds = new Set(input.chapterIds ?? [])
      const selectedChapters = chaptersFor(state, document).filter((chapter) => {
        if (input.chapterIds && !requestedIds.has(chapter.id)) return false
        return input.force || !summarizedIds.has(chapter.id)
      })
      const queueId = randomUUID()
      const items: StoredNovelSummaryQueueItem[] = selectedChapters.map((chapter) => ({
        id: randomUUID(),
        queueId,
        documentId,
        chapterId: chapter.id,
        projectId,
        tenantId: principal.tenantId,
        order: chapter.order,
        title: chapter.title,
        status: 'pending',
        attempts: 0,
        maxAttempts: input.maxAttempts,
        characterCount: chapter.characterCount,
        sourceStartOffset: chapter.sourceStartOffset,
        sourceEndOffset: chapter.sourceEndOffset,
        sourceChapterTitle: chapter.sourceChapterTitle,
        crossesChapterBoundary: chapter.crossesChapterBoundary,
        summaryId: null,
        result: null,
        errorMessage: null,
        lockedAt: null,
        createdAt: now,
        updatedAt: now,
      }))
      const counts = queueCounts(items)
      const queue: StoredNovelSummaryQueue = {
        id: queueId,
        documentId,
        projectId,
        tenantId: principal.tenantId,
        status: items.length > 0 ? 'queued' : 'completed',
        batchSize: input.batchSize,
        force: input.force,
        totalItems: items.length,
        ...counts,
        createdAt: now,
        updatedAt: now,
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      }

      state.novelSummaryQueues.push(queue)
      state.novelSummaryQueueItems.push(...items)
      document.updatedAt = now
      project.updatedAt = now
      return toSummaryQueueResult(document, queue, state)
    })
  }

  async saveStoryBible(
    projectId: string,
    documentId: string,
    draft: NovelStoryBibleDraft,
    sourceSummaryCount: number,
    principal: Principal,
  ): Promise<NovelStoryBible | null> {
    if (this.database && this.objectStorage) {
      return saveStoryBibleInDatabase(
        this.database,
        projectId,
        documentId,
        draft,
        sourceSummaryCount,
        principal,
      )
    }
    return this.store.mutate((state) => {
      const project = findWritableProject(state, projectId, principal)
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!project || !document) return null
      const now = new Date().toISOString()
      const existingIndex = state.novelStoryBibles.findIndex(
        (storyBible) =>
          storyBible.projectId === projectId &&
          storyBible.documentId === documentId &&
          storyBible.tenantId === principal.tenantId,
      )
      const existing = existingIndex >= 0 ? state.novelStoryBibles[existingIndex] : null
      const storyBible: StoredNovelStoryBible = {
        id: existing?.id ?? randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        documentId,
        ...draft,
        sourceSummaryCount,
        chapterCount: document.chapterCount,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (existingIndex >= 0) state.novelStoryBibles[existingIndex] = storyBible
      else state.novelStoryBibles.push(storyBible)
      document.updatedAt = now
      project.updatedAt = now
      return storyBible
    })
  }
}

async function listDocumentsFromDatabase(
  queryable: Queryable,
  projectId: string,
  principal: Principal,
): Promise<NovelDocument[] | null> {
  if (!(await projectVisibleInDatabase(queryable, projectId, principal, 'read'))) return null
  const result = await queryable.query<NovelDocumentRow>(
    `
    SELECT ${documentColumns}
    FROM novel_documents
    WHERE project_id = $1 AND tenant_id = $2
    ORDER BY updated_at DESC, created_at DESC
    `,
    [projectId, principal.tenantId],
  )
  return result.rows.map(documentFromRow)
}

async function detailFromDatabase(
  queryable: Queryable,
  projectId: string,
  documentId: string,
  principal: Principal,
): Promise<NovelImportResult | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'read')
  if (!document) return null
  const chapters = await chaptersForDocumentInDatabase(queryable, document)
  return {
    document: documentFromRow(document),
    chapters: chapters.map(chapterFromRow),
  }
}

async function boundariesFromDatabase(
  queryable: Queryable,
  projectId: string,
  documentId: string,
  principal: Principal,
  warnings: string[] = [],
): Promise<NovelBoundaryDetectionResult | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'read')
  if (!document) return null
  const boundaries = await boundariesForDocumentInDatabase(queryable, document)
  return toBoundaryDetectionResultFromDatabase(document, boundaries, warnings)
}

async function boundaryDetectionSourceFromDatabase(
  queryable: Queryable,
  objectStorage: ObjectStorage,
  projectId: string,
  documentId: string,
  principal: Principal,
): Promise<NovelBoundaryDetectionSource | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'write')
  if (!document) return null
  const [content, chapterRows, boundaryRows] = await Promise.all([
    readDocumentContent(objectStorage, document),
    chaptersForDocumentInDatabase(queryable, document),
    boundariesForDocumentInDatabase(queryable, document),
  ])
  return {
    document: documentFromRow(document),
    chapters: chapterRows.map((chapter) => chapterWithContentFromRow(chapter, content)),
    boundaries: boundaryRows.map(boundaryFromRow),
  }
}

async function saveDetectedBoundariesInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  drafts: NovelBoundaryDraft[],
  force: boolean,
  principal: Principal,
  warnings: string[],
): Promise<NovelBoundaryDetectionResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write', true)
    if (!document) return null
    if (!force) {
      const existing = await boundariesForDocumentInDatabase(client, document)
      if (existing.length) return toBoundaryDetectionResultFromDatabase(document, existing, warnings)
    }

    await client.query('DELETE FROM novel_boundaries WHERE document_id = $1 AND tenant_id = $2', [
      documentId,
      principal.tenantId,
    ])
    const now = new Date().toISOString()
    const stored: NovelBoundary[] = []
    for (const draft of drafts) {
      const boundary: NovelBoundary = {
        id: randomUUID(),
        documentId,
        projectId,
        tenantId: principal.tenantId,
        previousChapterId: draft.previousChapterId,
        nextChapterId: draft.nextChapterId,
        previousOrder: draft.previousOrder,
        nextOrder: draft.nextOrder,
        status: 'pending',
        severity: draft.severity,
        issues: draft.issues,
        previousTail: draft.previousTail,
        nextHead: draft.nextHead,
        note: null,
        createdAt: now,
        updatedAt: now,
      }
      await insertBoundary(client, boundary)
      stored.push(boundary)
    }
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return {
      document: { ...documentFromRow(document), updatedAt: now },
      boundaries: stored,
      detectedAt: new Date().toISOString(),
      warnings,
    }
  })
}

async function saveBoundaryNotesInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  drafts: NovelBoundaryNoteDraft[],
  force: boolean,
  principal: Principal,
  warnings: string[],
): Promise<NovelBoundaryNotesResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write', true)
    if (!document) return null
    const now = new Date().toISOString()
    const generatedBoundaryIds: string[] = []
    for (const draft of drafts) {
      const updated = await client.query<{ id: string }>(
        `
        UPDATE novel_boundaries
        SET note = $5, status = 'resolved', updated_at = $6
        WHERE id = $1
          AND document_id = $2
          AND project_id = $3
          AND tenant_id = $4
          AND ($7::boolean OR note IS NULL OR note = '')
        RETURNING id
        `,
        [draft.boundaryId, documentId, projectId, principal.tenantId, draft.note, now, force],
      )
      if (updated.rows[0]) generatedBoundaryIds.push(updated.rows[0].id)
    }
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    const boundaries = (await boundariesForDocumentInDatabase(client, document)).map(boundaryFromRow)
    return {
      document: { ...documentFromRow(document), updatedAt: now },
      boundaries,
      generatedBoundaryIds,
      missingNoteCount: missingBoundaryNoteCount(boundaries),
      generatedAt: now,
      warnings,
    }
  })
}

async function summariesFromDatabase(
  queryable: Queryable,
  projectId: string,
  documentId: string,
  principal: Principal,
): Promise<NovelChapterSummary[] | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'read')
  if (!document) return null
  return summariesForDocumentInDatabase(queryable, document)
}

async function summaryQueueFromDatabase(
  queryable: Queryable,
  projectId: string,
  documentId: string,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'read')
  if (!document) return null
  return toSummaryQueueResultFromDatabase(queryable, document)
}

async function summaryQueueSourceFromDatabase(
  queryable: Queryable,
  objectStorage: ObjectStorage,
  projectId: string,
  documentId: string,
  queueId: string,
  principal: Principal,
): Promise<NovelSummaryQueueSource | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'write')
  if (!document) return null
  const queue = await findSummaryQueueInDatabase(queryable, document, queueId)
  if (!queue) return null
  const [content, itemRows, chapterRows] = await Promise.all([
    readDocumentContent(objectStorage, document),
    queueItemsForQueueInDatabase(queryable, queue),
    chaptersForDocumentInDatabase(queryable, document),
  ])
  return {
    document: documentFromRow(document),
    queue: summaryQueueFromRow(queue, itemRows.map(summaryQueueItemFromRow)),
    items: itemRows.map(summaryQueueItemFromRow),
    chapters: chapterRows.map((chapter) => chapterWithContentFromRow(chapter, content)),
  }
}

async function updateSummaryQueueStatusInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  status: NovelSummaryQueueStatus,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write')
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId) : null
    if (!document || !queue) return null
    const now = new Date().toISOString()
    await client.query(
      `
      UPDATE novel_summary_queues
      SET status = $4, updated_at = $5
      WHERE id = $1 AND document_id = $2 AND tenant_id = $3
      `,
      [queueId, documentId, principal.tenantId, status, now],
    )
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
  })
}

async function resumeSummaryQueueInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write')
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId) : null
    if (!document || !queue) return null
    const items = (await queueItemsForQueueInDatabase(client, queue)).map(summaryQueueItemFromRow)
    const counts = queueCounts(items)
    const status = counts.pendingCount > 0 ? 'queued' : statusForQueueItems(items)
    const now = new Date().toISOString()
    await updateSummaryQueueCounts(client, queueId, status, items, now)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
  })
}

async function startSummaryQueueItemInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  itemId: string,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write')
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId) : null
    if (!document || !queue) return null
    const now = new Date().toISOString()
    const updated = await client.query<{ id: string }>(
      `
      UPDATE novel_summary_queue_items
      SET status = 'running',
          attempts = attempts + 1,
          locked_at = $6,
          error_message = NULL,
          updated_at = $6
      WHERE id = $1
        AND queue_id = $2
        AND document_id = $3
        AND project_id = $4
        AND tenant_id = $5
        AND status = 'pending'
      RETURNING id
      `,
      [itemId, queueId, documentId, projectId, principal.tenantId, now],
    )
    if (!updated.rows[0]) return null
    await refreshSummaryQueueInDatabase(client, queueId, 'running', now)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
  })
}

async function completeSummaryQueueItemInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  itemId: string,
  result: NovelSummaryQueueItemResult,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write')
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId) : null
    if (!document || !queue) return null
    const now = new Date().toISOString()
    const updated = await client.query<{ id: string }>(
      `
      UPDATE novel_summary_queue_items
      SET status = 'completed',
          result = $6::jsonb,
          error_message = NULL,
          locked_at = NULL,
          updated_at = $7
      WHERE id = $1
        AND queue_id = $2
        AND document_id = $3
        AND project_id = $4
        AND tenant_id = $5
      RETURNING id
      `,
      [itemId, queueId, documentId, projectId, principal.tenantId, JSON.stringify(result), now],
    )
    if (!updated.rows[0]) return null
    await refreshSummaryQueueInDatabase(client, queueId, null, now)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
  })
}

async function failSummaryQueueItemInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  itemId: string,
  errorMessage: string,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write')
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId) : null
    if (!document || !queue) return null
    const now = new Date().toISOString()
    const updated = await client.query<{ id: string }>(
      `
      UPDATE novel_summary_queue_items
      SET status = 'failed',
          error_message = $6,
          locked_at = NULL,
          updated_at = $7
      WHERE id = $1
        AND queue_id = $2
        AND document_id = $3
        AND project_id = $4
        AND tenant_id = $5
      RETURNING id
      `,
      [itemId, queueId, documentId, projectId, principal.tenantId, errorMessage, now],
    )
    if (!updated.rows[0]) return null
    await refreshSummaryQueueInDatabase(client, queueId, null, now)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
  })
}

async function retrySummaryQueueItemInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  itemId: string,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write')
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId) : null
    if (!document || !queue) return null
    const now = new Date().toISOString()
    const updated = await client.query<{ id: string }>(
      `
      UPDATE novel_summary_queue_items
      SET status = 'pending',
          error_message = NULL,
          locked_at = NULL,
          updated_at = $6
      WHERE id = $1
        AND queue_id = $2
        AND document_id = $3
        AND project_id = $4
        AND tenant_id = $5
        AND status IN ('failed', 'skipped')
      RETURNING id
      `,
      [itemId, queueId, documentId, projectId, principal.tenantId, now],
    )
    if (!updated.rows[0]) return null
    await refreshSummaryQueueInDatabase(client, queueId, 'queued', now)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
  })
}

async function skipSummaryQueueItemInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  itemId: string,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write')
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId) : null
    if (!document || !queue) return null
    const now = new Date().toISOString()
    const updated = await client.query<{ id: string }>(
      `
      UPDATE novel_summary_queue_items
      SET status = 'skipped',
          error_message = NULL,
          locked_at = NULL,
          updated_at = $6
      WHERE id = $1
        AND queue_id = $2
        AND document_id = $3
        AND project_id = $4
        AND tenant_id = $5
        AND status <> 'completed'
      RETURNING id
      `,
      [itemId, queueId, documentId, projectId, principal.tenantId, now],
    )
    if (!updated.rows[0]) return null
    await refreshSummaryQueueInDatabase(client, queueId, null, now)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
  })
}

async function commitSummaryQueueResultsInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  queueId: string,
  force: boolean,
  principal: Principal,
): Promise<NovelSummaryQueueCommitResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write', true)
    const queue = document ? await findSummaryQueueInDatabase(client, document, queueId, true) : null
    if (!document || !queue) return null

    const now = new Date().toISOString()
    const committedItemIds: string[] = []
    const skippedItemIds: string[] = []
    const warnings: string[] = []
    const itemRows = await queueItemsForQueueInDatabase(client, queue)

    for (const item of itemRows.map(summaryQueueItemFromRow)) {
      if (item.status !== 'completed' || !item.result) {
        skippedItemIds.push(item.id)
        continue
      }

      const existingResult = await client.query<NovelChapterSummaryRow>(
        `
        SELECT ${summaryColumns}
        FROM novel_chapter_summaries
        WHERE document_id = $1 AND chapter_id = $2 AND tenant_id = $3
        LIMIT 1
        `,
        [documentId, item.chapterId, principal.tenantId],
      )
      const existing = existingResult.rows[0] ? summaryFromRow(existingResult.rows[0]) : null
      if (existing && !force) {
        await updateQueueItemSummaryId(client, item.id, existing.id, now)
        committedItemIds.push(item.id)
        continue
      }

      const summary: NovelChapterSummary = {
        id: existing?.id ?? randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        documentId,
        chapterId: item.chapterId,
        order: item.order,
        title: item.title,
        summary: item.result.summary,
        keyEvents: item.result.keyEvents,
        characters: item.result.characters,
        locations: item.result.locations,
        timeline: item.result.timeline,
        keyProps: item.result.keyProps,
        foreshadowing: item.result.foreshadowing,
        worldRules: item.result.worldRules,
        adaptationNotes: item.result.adaptationNotes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      await upsertSummary(client, summary)
      await updateQueueItemSummaryId(client, item.id, summary.id, now)
      committedItemIds.push(item.id)
    }

    if (!committedItemIds.length) warnings.push('没有可提交的已完成摘要结果')
    await refreshSummaryQueueInDatabase(client, queueId, null, now)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    const base = await toSummaryQueueResultFromDatabase(client, { ...document, updated_at: now })
    return {
      ...base,
      summaries: await summariesForDocumentInDatabase(client, document),
      committedItemIds,
      skippedItemIds,
      warnings,
    }
  })
}

async function storyBibleFromDatabase(
  queryable: Queryable,
  projectId: string,
  documentId: string,
  principal: Principal,
): Promise<NovelStoryBible | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'read')
  if (!document) return null
  return storyBibleForDocumentInDatabase(queryable, document)
}

async function generationSourceFromDatabase(
  queryable: Queryable,
  objectStorage: ObjectStorage,
  projectId: string,
  documentId: string,
  principal: Principal,
): Promise<NovelGenerationSource | null> {
  const document = await findDocumentInDatabase(queryable, projectId, documentId, principal, 'write')
  if (!document) return null
  const [content, chapterRows, summaries, storyBible] = await Promise.all([
    readDocumentContent(objectStorage, document),
    chaptersForDocumentInDatabase(queryable, document),
    summariesForDocumentInDatabase(queryable, document),
    storyBibleForDocumentInDatabase(queryable, document),
  ])
  return {
    document: documentFromRow(document),
    chapters: chapterRows.map((chapter) => chapterWithContentFromRow(chapter, content)),
    summaries,
    storyBible,
  }
}

async function importNovelInDatabase(
  database: AccountDatabase,
  objectStorage: ObjectStorage,
  projectId: string,
  input: ImportNovelRequest,
  chapters: NovelChapterDraft[],
  principal: Principal,
): Promise<NovelImportResult | null> {
  const existing = input.clientRequestId
    ? await findDocumentByClientRequest(database, projectId, input.clientRequestId, principal)
    : null
  if (existing) {
    const canWrite = await projectVisibleInDatabase(database, projectId, principal, 'write')
    return canWrite ? detailFromDatabase(database, projectId, existing.id, principal) : null
  }

  const now = new Date().toISOString()
  const documentId = randomUUID()
  const contentStorageKey = novelContentStorageKey(principal.tenantId, projectId, documentId)
  const contentSha256 = sha256(input.content)

  try {
    const imported = await database.transaction(async (client) => {
      if (!(await projectVisibleInDatabase(client, projectId, principal, 'write', true))) return null
      await objectStorage.put(
        contentStorageKey,
        Buffer.from(input.content, 'utf8'),
        'text/plain; charset=utf-8',
      )
      const document: StoredNovelDocument = {
        id: documentId,
        projectId,
        tenantId: principal.tenantId,
        name: input.name,
        format: input.format,
        characterCount: chapters.reduce((total, chapter) => total + chapter.characterCount, 0),
        chapterCount: chapters.length,
        createdAt: now,
        updatedAt: now,
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      }
      const insertedDocument = await insertDocument(client, document, contentStorageKey, contentSha256)
      if (!insertedDocument) {
        const duplicate = input.clientRequestId
          ? await findDocumentByClientRequest(client, projectId, input.clientRequestId, principal)
          : null
        return duplicate ? detailFromDatabase(client, projectId, duplicate.id, principal) : null
      }

      const storedChapters: StoredNovelChapter[] = chapters.map((chapter) => ({
        id: randomUUID(),
        documentId,
        projectId,
        tenantId: principal.tenantId,
        order: chapter.order,
        title: chapter.title,
        startOffset: chapter.startOffset,
        endOffset: chapter.endOffset,
        sourceStartOffset: chapter.sourceStartOffset,
        sourceEndOffset: chapter.sourceEndOffset,
        sourceChapterTitle: chapter.sourceChapterTitle,
        splitMode: chapter.splitMode,
        overlapBeforeChars: chapter.overlapBeforeChars,
        overlapAfterChars: chapter.overlapAfterChars,
        crossesChapterBoundary: chapter.crossesChapterBoundary,
        characterCount: chapter.characterCount,
        preview: chapter.preview,
        previewTruncated: chapter.content.trim().length > 3_000,
        content: chapter.content,
        createdAt: now,
      }))
      for (const chapter of storedChapters) {
        await insertChapter(client, chapter)
      }
      await touchProjectInDatabase(client, projectId, principal.tenantId, now)
      return {
        document: toDocument(document),
        chapters: storedChapters.map(toChapter),
      }
    })
    if (imported?.document.id !== documentId) {
      await objectStorage.delete(contentStorageKey).catch(() => {})
    }
    return imported
  } catch (error) {
    await objectStorage.delete(contentStorageKey).catch(() => {})
    throw error
  }
}

async function saveChapterSummariesInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  drafts: NovelChapterSummaryDraft[],
  principal: Principal,
  force: boolean,
): Promise<NovelChapterSummary[] | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write', true)
    if (!document) return null
    const now = new Date().toISOString()
    for (const draft of drafts) {
      const existingResult = await client.query<NovelChapterSummaryRow>(
        `
        SELECT ${summaryColumns}
        FROM novel_chapter_summaries
        WHERE document_id = $1 AND chapter_id = $2 AND tenant_id = $3
        LIMIT 1
        `,
        [documentId, draft.chapterId, principal.tenantId],
      )
      const existing = existingResult.rows[0] ? summaryFromRow(existingResult.rows[0]) : null
      if (existing && !force) continue
      await upsertSummary(client, {
        id: existing?.id ?? randomUUID(),
        projectId,
        tenantId: principal.tenantId,
        documentId,
        chapterId: draft.chapterId,
        order: draft.order,
        title: draft.title,
        summary: draft.summary,
        keyEvents: draft.keyEvents,
        characters: draft.characters,
        locations: draft.locations,
        timeline: draft.timeline,
        keyProps: draft.keyProps,
        foreshadowing: draft.foreshadowing,
        worldRules: draft.worldRules,
        adaptationNotes: draft.adaptationNotes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    }
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return summariesForDocumentInDatabase(client, document)
  })
}

async function createSummaryQueueInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  input: CreateNovelSummaryQueueRequest,
  principal: Principal,
): Promise<NovelSummaryQueueResult | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write', true)
    if (!document) return null
    if (input.clientRequestId) {
      const existing = await findSummaryQueueByClientRequest(client, document, input.clientRequestId)
      if (existing) return toSummaryQueueResultFromDatabase(client, document, existing)
    }

    const summarizedIds = new Set(
      (await summariesForDocumentInDatabase(client, document)).map((summary) => summary.chapterId),
    )
    const requestedIds = new Set(input.chapterIds ?? [])
    const selectedChapters = (await chaptersForDocumentInDatabase(client, document)).filter((chapter) => {
      if (input.chapterIds && !requestedIds.has(chapter.id)) return false
      return input.force || !summarizedIds.has(chapter.id)
    })
    const now = new Date().toISOString()
    const items: StoredNovelSummaryQueueItem[] = selectedChapters.map((chapter) => ({
      id: randomUUID(),
      queueId: '',
      documentId,
      chapterId: chapter.id,
      projectId,
      tenantId: principal.tenantId,
      order: Number(chapter.chapter_order),
      title: chapter.title,
      status: 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts,
      characterCount: Number(chapter.character_count),
      sourceStartOffset: Number(chapter.source_start_offset),
      sourceEndOffset: Number(chapter.source_end_offset),
      sourceChapterTitle: chapter.source_chapter_title,
      crossesChapterBoundary: chapter.crosses_chapter_boundary,
      summaryId: null,
      result: null,
      errorMessage: null,
      lockedAt: null,
      createdAt: now,
      updatedAt: now,
    }))
    const queueId = randomUUID()
    const counts = queueCounts(items)
    const queue: StoredNovelSummaryQueue = {
      id: queueId,
      documentId,
      projectId,
      tenantId: principal.tenantId,
      status: items.length > 0 ? 'queued' : 'completed',
      batchSize: input.batchSize,
      force: input.force,
      totalItems: items.length,
      ...counts,
      createdAt: now,
      updatedAt: now,
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    }
    await insertSummaryQueue(client, queue)
    for (const item of items) {
      await insertSummaryQueueItem(client, { ...item, queueId })
    }
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return toSummaryQueueResultFromDatabase(
      client,
      { ...document, updated_at: now },
      { ...queue, id: queueId },
    )
  })
}

async function saveStoryBibleInDatabase(
  database: AccountDatabase,
  projectId: string,
  documentId: string,
  draft: NovelStoryBibleDraft,
  sourceSummaryCount: number,
  principal: Principal,
): Promise<NovelStoryBible | null> {
  return database.transaction(async (client) => {
    const document = await findDocumentInDatabase(client, projectId, documentId, principal, 'write', true)
    if (!document) return null
    const now = new Date().toISOString()
    const existing = await storyBibleForDocumentInDatabase(client, document)
    const storyBible: NovelStoryBible = {
      id: existing?.id ?? randomUUID(),
      projectId,
      tenantId: principal.tenantId,
      documentId,
      ...draft,
      sourceSummaryCount,
      chapterCount: Number(document.chapter_count),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await upsertStoryBible(client, storyBible)
    await touchNovelDocumentAndProject(client, projectId, documentId, principal.tenantId, now)
    return storyBible
  })
}

async function projectVisibleInDatabase(
  queryable: Queryable,
  projectId: string,
  principal: Principal,
  access: 'read' | 'write',
  forUpdate = false,
): Promise<boolean> {
  const canReadAll = access === 'read' && canReadAllTenantContent(principal)
  const result = await queryable.query<{ id: string }>(
    `
    SELECT id
    FROM projects
    WHERE id = $1
      AND tenant_id = $2
      AND ($3::boolean OR owner_user_id = $4)
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [projectId, principal.tenantId, canReadAll, principal.userId],
  )
  return Boolean(result.rows[0])
}

async function findDocumentInDatabase(
  queryable: Queryable,
  projectId: string,
  documentId: string,
  principal: Principal,
  access: 'read' | 'write',
  forUpdate = false,
): Promise<NovelDocumentRow | null> {
  const canReadAll = access === 'read' && canReadAllTenantContent(principal)
  const result = await queryable.query<NovelDocumentRow>(
    `
    SELECT d.${documentColumns.replace(/,\s+/g, ', d.').trim()}
    FROM novel_documents d
    JOIN projects p ON p.id = d.project_id AND p.tenant_id = d.tenant_id
    WHERE d.id = $1
      AND d.project_id = $2
      AND d.tenant_id = $3
      AND ($4::boolean OR p.owner_user_id = $5)
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF d, p' : ''}
    `,
    [documentId, projectId, principal.tenantId, canReadAll, principal.userId],
  )
  return result.rows[0] ?? null
}

async function findDocumentByClientRequest(
  queryable: Queryable,
  projectId: string,
  clientRequestId: string,
  principal: Principal,
): Promise<NovelDocumentRow | null> {
  const result = await queryable.query<NovelDocumentRow>(
    `
    SELECT ${documentColumns}
    FROM novel_documents
    WHERE project_id = $1
      AND tenant_id = $2
      AND client_request_id = $3
    LIMIT 1
    `,
    [projectId, principal.tenantId, clientRequestId],
  )
  return result.rows[0] ?? null
}

async function chaptersForDocumentInDatabase(
  queryable: Queryable,
  document: Pick<NovelDocumentRow, 'id' | 'tenant_id'>,
): Promise<NovelChapterRow[]> {
  const result = await queryable.query<NovelChapterRow>(
    `
    SELECT ${chapterColumns}
    FROM novel_chapters
    WHERE document_id = $1 AND tenant_id = $2
    ORDER BY chapter_order ASC
    `,
    [document.id, document.tenant_id],
  )
  return result.rows
}

async function boundariesForDocumentInDatabase(
  queryable: Queryable,
  document: Pick<NovelDocumentRow, 'id' | 'tenant_id'>,
): Promise<NovelBoundaryRow[]> {
  const result = await queryable.query<NovelBoundaryRow>(
    `
    SELECT ${boundaryColumns}
    FROM novel_boundaries
    WHERE document_id = $1 AND tenant_id = $2
    ORDER BY previous_order ASC
    `,
    [document.id, document.tenant_id],
  )
  return result.rows
}

async function summariesForDocumentInDatabase(
  queryable: Queryable,
  document: Pick<NovelDocumentRow, 'id' | 'tenant_id'>,
): Promise<NovelChapterSummary[]> {
  const result = await queryable.query<NovelChapterSummaryRow>(
    `
    SELECT ${summaryColumns}
    FROM novel_chapter_summaries
    WHERE document_id = $1 AND tenant_id = $2
    ORDER BY chapter_order ASC
    `,
    [document.id, document.tenant_id],
  )
  return result.rows.map(summaryFromRow)
}

async function findSummaryQueueInDatabase(
  queryable: Queryable,
  document: Pick<NovelDocumentRow, 'id' | 'tenant_id'>,
  queueId: string,
  forUpdate = false,
): Promise<NovelSummaryQueueRow | null> {
  const result = await queryable.query<NovelSummaryQueueRow>(
    `
    SELECT ${summaryQueueColumns}
    FROM novel_summary_queues
    WHERE id = $1 AND document_id = $2 AND tenant_id = $3
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [queueId, document.id, document.tenant_id],
  )
  return result.rows[0] ?? null
}

async function findSummaryQueueByClientRequest(
  queryable: Queryable,
  document: Pick<NovelDocumentRow, 'id' | 'tenant_id'>,
  clientRequestId: string,
): Promise<NovelSummaryQueueRow | null> {
  const result = await queryable.query<NovelSummaryQueueRow>(
    `
    SELECT ${summaryQueueColumns}
    FROM novel_summary_queues
    WHERE document_id = $1 AND tenant_id = $2 AND client_request_id = $3
    LIMIT 1
    `,
    [document.id, document.tenant_id, clientRequestId],
  )
  return result.rows[0] ?? null
}

async function latestSummaryQueueForDocumentInDatabase(
  queryable: Queryable,
  document: Pick<NovelDocumentRow, 'id' | 'tenant_id'>,
): Promise<NovelSummaryQueueRow | null> {
  const result = await queryable.query<NovelSummaryQueueRow>(
    `
    SELECT ${summaryQueueColumns}
    FROM novel_summary_queues
    WHERE document_id = $1 AND tenant_id = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [document.id, document.tenant_id],
  )
  return result.rows[0] ?? null
}

async function queueItemsForQueueInDatabase(
  queryable: Queryable,
  queue: Pick<NovelSummaryQueueRow, 'id' | 'tenant_id'>,
): Promise<NovelSummaryQueueItemRow[]> {
  const result = await queryable.query<NovelSummaryQueueItemRow>(
    `
    SELECT ${summaryQueueItemColumns}
    FROM novel_summary_queue_items
    WHERE queue_id = $1 AND tenant_id = $2
    ORDER BY chapter_order ASC
    `,
    [queue.id, queue.tenant_id],
  )
  return result.rows
}

async function storyBibleForDocumentInDatabase(
  queryable: Queryable,
  document: Pick<NovelDocumentRow, 'id' | 'tenant_id'>,
): Promise<NovelStoryBible | null> {
  const result = await queryable.query<NovelStoryBibleRow>(
    `
    SELECT ${storyBibleColumns}
    FROM novel_story_bibles
    WHERE document_id = $1 AND tenant_id = $2
    LIMIT 1
    `,
    [document.id, document.tenant_id],
  )
  return result.rows[0] ? storyBibleFromRow(result.rows[0]) : null
}

async function toSummaryQueueResultFromDatabase(
  queryable: Queryable,
  document: NovelDocumentRow,
  queueInput?: StoredNovelSummaryQueue | NovelSummaryQueueRow | null,
): Promise<NovelSummaryQueueResult> {
  const queue =
    queueInput === undefined ? await latestSummaryQueueForDocumentInDatabase(queryable, document) : queueInput
  const items = queue
    ? (await queueItemsForQueueInDatabase(queryable, queueLikeRow(queue))).map(summaryQueueItemFromRow)
    : []
  const summaries = await summariesForDocumentInDatabase(queryable, document)
  return {
    document: documentFromRow(document),
    queue: queue ? summaryQueueFromAny(queue, items) : null,
    items,
    summaryCount: summaries.length,
    missingSummaryCount: Math.max(0, Number(document.chapter_count) - summaries.length),
  }
}

async function readDocumentContent(
  objectStorage: ObjectStorage,
  document: NovelDocumentRow,
): Promise<string> {
  const content = (await objectStorage.get(document.content_storage_key)).toString('utf8')
  if (sha256(content) !== document.content_sha256) {
    throw new Error(`Novel source content checksum mismatch for document ${document.id}`)
  }
  return content
}

async function insertDocument(
  queryable: Queryable,
  document: StoredNovelDocument,
  contentStorageKey: string,
  contentSha256: string,
): Promise<boolean> {
  const result = await queryable.query(
    `
    INSERT INTO novel_documents (
      id,
      project_id,
      tenant_id,
      name,
      format,
      character_count,
      chapter_count,
      content_storage_key,
      content_sha256,
      client_request_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      document.id,
      document.projectId,
      document.tenantId,
      document.name,
      document.format,
      document.characterCount,
      document.chapterCount,
      contentStorageKey,
      contentSha256,
      document.clientRequestId ?? null,
      document.createdAt,
      document.updatedAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

async function insertChapter(queryable: Queryable, chapter: StoredNovelChapter): Promise<boolean> {
  const result = await queryable.query(
    `
    INSERT INTO novel_chapters (
      id,
      document_id,
      project_id,
      tenant_id,
      chapter_order,
      title,
      start_offset,
      end_offset,
      source_start_offset,
      source_end_offset,
      source_chapter_title,
      split_mode,
      overlap_before_chars,
      overlap_after_chars,
      crosses_chapter_boundary,
      character_count,
      preview,
      preview_truncated,
      created_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19
    )
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      chapter.id,
      chapter.documentId,
      chapter.projectId,
      chapter.tenantId,
      chapter.order,
      chapter.title,
      chapter.startOffset,
      chapter.endOffset,
      chapter.sourceStartOffset,
      chapter.sourceEndOffset,
      chapter.sourceChapterTitle,
      chapter.splitMode,
      chapter.overlapBeforeChars,
      chapter.overlapAfterChars,
      chapter.crossesChapterBoundary,
      chapter.characterCount,
      chapter.preview,
      chapter.previewTruncated,
      chapter.createdAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

async function insertBoundary(queryable: Queryable, boundary: NovelBoundary): Promise<boolean> {
  const result = await queryable.query(
    `
    INSERT INTO novel_boundaries (
      id,
      document_id,
      project_id,
      tenant_id,
      previous_chapter_id,
      next_chapter_id,
      previous_order,
      next_order,
      status,
      severity,
      issues,
      previous_tail,
      next_head,
      note,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      boundary.id,
      boundary.documentId,
      boundary.projectId,
      boundary.tenantId,
      boundary.previousChapterId,
      boundary.nextChapterId,
      boundary.previousOrder,
      boundary.nextOrder,
      boundary.status,
      boundary.severity,
      JSON.stringify(boundary.issues),
      boundary.previousTail,
      boundary.nextHead,
      boundary.note,
      boundary.createdAt,
      boundary.updatedAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

async function upsertSummary(queryable: Queryable, summary: NovelChapterSummary): Promise<void> {
  await queryable.query(
    `
    INSERT INTO novel_chapter_summaries (
      id,
      document_id,
      chapter_id,
      project_id,
      tenant_id,
      chapter_order,
      title,
      summary,
      key_events,
      characters,
      locations,
      timeline,
      key_props,
      foreshadowing,
      world_rules,
      adaptation_notes,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
      $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18
    )
    ON CONFLICT (document_id, chapter_id) DO UPDATE
    SET
      chapter_order = EXCLUDED.chapter_order,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      key_events = EXCLUDED.key_events,
      characters = EXCLUDED.characters,
      locations = EXCLUDED.locations,
      timeline = EXCLUDED.timeline,
      key_props = EXCLUDED.key_props,
      foreshadowing = EXCLUDED.foreshadowing,
      world_rules = EXCLUDED.world_rules,
      adaptation_notes = EXCLUDED.adaptation_notes,
      updated_at = EXCLUDED.updated_at
    `,
    [
      summary.id,
      summary.documentId,
      summary.chapterId,
      summary.projectId,
      summary.tenantId,
      summary.order,
      summary.title,
      summary.summary,
      JSON.stringify(summary.keyEvents),
      JSON.stringify(summary.characters),
      JSON.stringify(summary.locations),
      JSON.stringify(summary.timeline),
      JSON.stringify(summary.keyProps),
      JSON.stringify(summary.foreshadowing),
      JSON.stringify(summary.worldRules),
      summary.adaptationNotes,
      summary.createdAt,
      summary.updatedAt,
    ],
  )
}

async function insertSummaryQueue(queryable: Queryable, queue: StoredNovelSummaryQueue): Promise<boolean> {
  const result = await queryable.query(
    `
    INSERT INTO novel_summary_queues (
      id,
      document_id,
      project_id,
      tenant_id,
      status,
      batch_size,
      force,
      total_items,
      pending_count,
      running_count,
      completed_count,
      failed_count,
      skipped_count,
      client_request_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      queue.id,
      queue.documentId,
      queue.projectId,
      queue.tenantId,
      queue.status,
      queue.batchSize,
      queue.force,
      queue.totalItems,
      queue.pendingCount,
      queue.runningCount,
      queue.completedCount,
      queue.failedCount,
      queue.skippedCount,
      queue.clientRequestId ?? null,
      queue.createdAt,
      queue.updatedAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

async function insertSummaryQueueItem(
  queryable: Queryable,
  item: StoredNovelSummaryQueueItem,
): Promise<boolean> {
  const result = await queryable.query(
    `
    INSERT INTO novel_summary_queue_items (
      id,
      queue_id,
      document_id,
      chapter_id,
      project_id,
      tenant_id,
      chapter_order,
      title,
      status,
      attempts,
      max_attempts,
      character_count,
      source_start_offset,
      source_end_offset,
      source_chapter_title,
      crosses_chapter_boundary,
      summary_id,
      result,
      error_message,
      locked_at,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22
    )
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      item.id,
      item.queueId,
      item.documentId,
      item.chapterId,
      item.projectId,
      item.tenantId,
      item.order,
      item.title,
      item.status,
      item.attempts,
      item.maxAttempts,
      item.characterCount,
      item.sourceStartOffset,
      item.sourceEndOffset,
      item.sourceChapterTitle,
      item.crossesChapterBoundary,
      item.summaryId,
      item.result ? JSON.stringify(item.result) : null,
      item.errorMessage,
      item.lockedAt,
      item.createdAt,
      item.updatedAt,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

async function upsertStoryBible(queryable: Queryable, storyBible: NovelStoryBible): Promise<void> {
  await queryable.query(
    `
    INSERT INTO novel_story_bibles (
      id,
      document_id,
      project_id,
      tenant_id,
      title,
      logline,
      premise,
      synopsis,
      themes,
      characters,
      locations,
      timeline,
      key_props,
      foreshadowing,
      world_rules,
      adaptation_strategy,
      risks,
      next_step,
      source_summary_count,
      chapter_count,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
      $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
      $16, $17::jsonb, $18, $19, $20, $21, $22
    )
    ON CONFLICT (document_id, tenant_id) DO UPDATE
    SET
      title = EXCLUDED.title,
      logline = EXCLUDED.logline,
      premise = EXCLUDED.premise,
      synopsis = EXCLUDED.synopsis,
      themes = EXCLUDED.themes,
      characters = EXCLUDED.characters,
      locations = EXCLUDED.locations,
      timeline = EXCLUDED.timeline,
      key_props = EXCLUDED.key_props,
      foreshadowing = EXCLUDED.foreshadowing,
      world_rules = EXCLUDED.world_rules,
      adaptation_strategy = EXCLUDED.adaptation_strategy,
      risks = EXCLUDED.risks,
      next_step = EXCLUDED.next_step,
      source_summary_count = EXCLUDED.source_summary_count,
      chapter_count = EXCLUDED.chapter_count,
      updated_at = EXCLUDED.updated_at
    `,
    [
      storyBible.id,
      storyBible.documentId,
      storyBible.projectId,
      storyBible.tenantId,
      storyBible.title,
      storyBible.logline,
      storyBible.premise,
      storyBible.synopsis,
      JSON.stringify(storyBible.themes),
      JSON.stringify(storyBible.characters),
      JSON.stringify(storyBible.locations),
      JSON.stringify(storyBible.timeline),
      JSON.stringify(storyBible.keyProps),
      JSON.stringify(storyBible.foreshadowing),
      JSON.stringify(storyBible.worldRules),
      storyBible.adaptationStrategy,
      JSON.stringify(storyBible.risks),
      storyBible.nextStep,
      storyBible.sourceSummaryCount,
      storyBible.chapterCount,
      storyBible.createdAt,
      storyBible.updatedAt,
    ],
  )
}

async function updateQueueItemSummaryId(
  queryable: Queryable,
  itemId: string,
  summaryId: string,
  updatedAt: string,
): Promise<void> {
  await queryable.query(
    'UPDATE novel_summary_queue_items SET summary_id = $2, updated_at = $3 WHERE id = $1',
    [itemId, summaryId, updatedAt],
  )
}

async function refreshSummaryQueueInDatabase(
  queryable: Queryable,
  queueId: string,
  forcedStatus: NovelSummaryQueueStatus | null,
  updatedAt: string,
): Promise<void> {
  const queueResult = await queryable.query<NovelSummaryQueueRow>(
    `SELECT ${summaryQueueColumns} FROM novel_summary_queues WHERE id = $1 LIMIT 1`,
    [queueId],
  )
  const queue = queueResult.rows[0]
  if (!queue) return
  const items = (await queueItemsForQueueInDatabase(queryable, queue)).map(summaryQueueItemFromRow)
  await updateSummaryQueueCounts(
    queryable,
    queueId,
    forcedStatus ?? statusForQueueItems(items),
    items,
    updatedAt,
  )
}

async function updateSummaryQueueCounts(
  queryable: Queryable,
  queueId: string,
  status: NovelSummaryQueueStatus,
  items: Array<{ status: NovelSummaryQueueItemStatus }>,
  updatedAt: string,
): Promise<void> {
  const counts = queueCounts(items)
  await queryable.query(
    `
    UPDATE novel_summary_queues
    SET status = $2,
        total_items = $3,
        pending_count = $4,
        running_count = $5,
        completed_count = $6,
        failed_count = $7,
        skipped_count = $8,
        updated_at = $9
    WHERE id = $1
    `,
    [
      queueId,
      status,
      items.length,
      counts.pendingCount,
      counts.runningCount,
      counts.completedCount,
      counts.failedCount,
      counts.skippedCount,
      updatedAt,
    ],
  )
}

async function touchNovelDocumentAndProject(
  queryable: Queryable,
  projectId: string,
  documentId: string,
  tenantId: string,
  updatedAt: string,
): Promise<void> {
  await queryable.query('UPDATE novel_documents SET updated_at = $3 WHERE id = $1 AND tenant_id = $2', [
    documentId,
    tenantId,
    updatedAt,
  ])
  await touchProjectInDatabase(queryable, projectId, tenantId, updatedAt)
}

async function touchProjectInDatabase(
  queryable: Queryable,
  projectId: string,
  tenantId: string,
  updatedAt: string,
): Promise<void> {
  await queryable.query('UPDATE projects SET updated_at = $3 WHERE id = $1 AND tenant_id = $2', [
    projectId,
    tenantId,
    updatedAt,
  ])
}

function documentFromRow(row: NovelDocumentRow): StoredNovelDocument {
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

function chapterFromRow(row: NovelChapterRow): NovelChapter {
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

function chapterWithContentFromRow(row: NovelChapterRow, documentContent: string): StoredNovelChapter {
  return {
    ...chapterFromRow(row),
    content: documentContent.slice(Number(row.start_offset), Number(row.end_offset)),
  }
}

function boundaryFromRow(row: NovelBoundaryRow): NovelBoundary {
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

function summaryFromRow(row: NovelChapterSummaryRow): NovelChapterSummary {
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

function summaryQueueFromRow(
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

function summaryQueueFromAny(
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

function queueLikeRow(
  queue: StoredNovelSummaryQueue | NovelSummaryQueueRow,
): Pick<NovelSummaryQueueRow, 'id' | 'tenant_id'> {
  return 'tenant_id' in queue ? queue : { id: queue.id, tenant_id: queue.tenantId }
}

function summaryQueueItemFromRow(row: NovelSummaryQueueItemRow): StoredNovelSummaryQueueItem {
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

function storyBibleFromRow(row: NovelStoryBibleRow): NovelStoryBible {
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

function toBoundaryDetectionResultFromDatabase(
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

async function importNovelSnapshotFromStore(
  database: AccountDatabase,
  objectStorage: ObjectStorage,
  snapshot: {
    documents: StoredNovelDocument[]
    chapters: StoredNovelChapter[]
    boundaries: StoredNovelBoundary[]
    summaries: NovelChapterSummary[]
    summaryQueues: StoredNovelSummaryQueue[]
    summaryQueueItems: StoredNovelSummaryQueueItem[]
    storyBibles: StoredNovelStoryBible[]
  },
): Promise<NovelJsonImportResult> {
  const result = emptyNovelJsonImportResult()
  for (const document of snapshot.documents) {
    const chapters = snapshot.chapters
      .filter((chapter) => chapter.documentId === document.id && chapter.tenantId === document.tenantId)
      .sort((left, right) => left.order - right.order)
    if (!chapters.length) {
      result.documents.skipped += 1
      continue
    }
    const content = reconstructNovelContent(chapters)
    const contentStorageKey = novelContentStorageKey(document.tenantId, document.projectId, document.id)
    await objectStorage.put(contentStorageKey, Buffer.from(content, 'utf8'), 'text/plain; charset=utf-8')
    const contentSha256 = sha256(content)

    await database.transaction(async (client) => {
      if (await insertDocument(client, document, contentStorageKey, contentSha256)) {
        result.documents.inserted += 1
      } else {
        result.documents.skipped += 1
      }
      for (const chapter of chapters) {
        if (await insertChapter(client, chapter)) result.chapters.inserted += 1
        else result.chapters.skipped += 1
      }
      for (const boundary of snapshot.boundaries.filter((item) => item.documentId === document.id)) {
        if (await insertBoundary(client, boundary)) result.boundaries.inserted += 1
        else result.boundaries.skipped += 1
      }
      for (const summary of snapshot.summaries.filter((item) => item.documentId === document.id)) {
        const exists = await client.query<{ id: string }>(
          'SELECT id FROM novel_chapter_summaries WHERE document_id = $1 AND chapter_id = $2 LIMIT 1',
          [summary.documentId, summary.chapterId],
        )
        if (exists.rows[0]) {
          result.summaries.skipped += 1
        } else {
          await upsertSummary(client, summary)
          result.summaries.inserted += 1
        }
      }
      for (const queue of snapshot.summaryQueues.filter((item) => item.documentId === document.id)) {
        if (await insertSummaryQueue(client, queue)) result.summaryQueues.inserted += 1
        else result.summaryQueues.skipped += 1
      }
      for (const item of snapshot.summaryQueueItems.filter((item) => item.documentId === document.id)) {
        if (await insertSummaryQueueItem(client, item)) result.summaryQueueItems.inserted += 1
        else result.summaryQueueItems.skipped += 1
      }
      for (const storyBible of snapshot.storyBibles.filter((item) => item.documentId === document.id)) {
        const exists = await storyBibleForDocumentInDatabase(client, {
          id: document.id,
          tenant_id: document.tenantId,
        })
        if (exists) {
          result.storyBibles.skipped += 1
        } else {
          await upsertStoryBible(client, storyBible)
          result.storyBibles.inserted += 1
        }
      }
    })
  }
  return result
}

function reconstructNovelContent(chapters: StoredNovelChapter[]): string {
  let content = ''
  for (const chapter of chapters.slice().sort((left, right) => left.startOffset - right.startOffset)) {
    const startOffset = Math.max(0, chapter.startOffset)
    if (startOffset > content.length) content += ' '.repeat(startOffset - content.length)
    const overlapChars = Math.max(0, content.length - startOffset)
    content += chapter.content.slice(overlapChars)
  }
  return content
}

function emptyNovelJsonImportResult(): NovelJsonImportResult {
  return {
    documents: { inserted: 0, skipped: 0 },
    chapters: { inserted: 0, skipped: 0 },
    boundaries: { inserted: 0, skipped: 0 },
    summaries: { inserted: 0, skipped: 0 },
    summaryQueues: { inserted: 0, skipped: 0 },
    summaryQueueItems: { inserted: 0, skipped: 0 },
    storyBibles: { inserted: 0, skipped: 0 },
  }
}

function novelContentStorageKey(tenantId: string, projectId: string, documentId: string): string {
  return `${tenantId}/${projectId}/novels/${documentId}/source.txt`
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
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

function findReadableProject(state: AppState, projectId: string, principal: Principal) {
  const canReadAll = canReadAllTenantContent(principal)
  return state.projects.find(
    (project) =>
      project.id === projectId &&
      project.tenantId === principal.tenantId &&
      (canReadAll || project.ownerId === principal.userId),
  )
}

function findWritableProject(state: AppState, projectId: string, principal: Principal) {
  return state.projects.find(
    (project) =>
      project.id === projectId &&
      project.tenantId === principal.tenantId &&
      project.ownerId === principal.userId,
  )
}

function toResult(document: StoredNovelDocument, state: AppState): NovelImportResult {
  return {
    document: toDocument(document),
    chapters: chaptersFor(state, document).map(toChapter),
  }
}

function findDocument(
  state: AppState,
  projectId: string,
  documentId: string,
  tenantId: string,
): StoredNovelDocument | null {
  return (
    state.novelDocuments.find(
      (document) =>
        document.id === documentId && document.projectId === projectId && document.tenantId === tenantId,
    ) ?? null
  )
}

function findSummaryQueue(
  state: AppState,
  document: StoredNovelDocument,
  queueId: string,
): StoredNovelSummaryQueue | null {
  return (
    state.novelSummaryQueues.find(
      (queue) =>
        queue.id === queueId && queue.documentId === document.id && queue.tenantId === document.tenantId,
    ) ?? null
  )
}

function findQueueItem(
  state: AppState,
  queue: StoredNovelSummaryQueue,
  itemId: string,
): StoredNovelSummaryQueueItem | null {
  return (
    state.novelSummaryQueueItems.find(
      (item) => item.id === itemId && item.queueId === queue.id && item.tenantId === queue.tenantId,
    ) ?? null
  )
}

function findWritableSummaryQueueContext(
  state: AppState,
  projectId: string,
  documentId: string,
  queueId: string,
  principal: Principal,
): WritableSummaryQueueContext | null {
  const project = findWritableProject(state, projectId, principal)
  const document = findDocument(state, projectId, documentId, principal.tenantId)
  const queue = document ? findSummaryQueue(state, document, queueId) : null
  if (!project || !document || !queue) return null
  return { project, document, queue }
}

function chaptersFor(state: AppState, document: StoredNovelDocument): StoredNovelChapter[] {
  return state.novelChapters
    .filter((chapter) => chapter.documentId === document.id && chapter.tenantId === document.tenantId)
    .sort((left, right) => left.order - right.order)
}

function boundariesFor(state: AppState, document: StoredNovelDocument): StoredNovelBoundary[] {
  return state.novelBoundaries
    .filter((boundary) => boundary.documentId === document.id && boundary.tenantId === document.tenantId)
    .sort((left, right) => left.previousOrder - right.previousOrder)
}

function toBoundaryDetectionResult(
  document: StoredNovelDocument,
  boundaries: StoredNovelBoundary[],
  warnings: string[],
): NovelBoundaryDetectionResult {
  return {
    document: toDocument(document),
    boundaries: boundaries.map((boundary) => ({ ...boundary })),
    detectedAt: new Date().toISOString(),
    warnings,
  }
}

function missingBoundaryNoteCount(boundaries: StoredNovelBoundary[]): number {
  return boundaries.filter((boundary) => boundary.status !== 'ignored' && !boundary.note).length
}

function summariesFor(state: AppState, document: StoredNovelDocument): NovelChapterSummary[] {
  return state.novelChapterSummaries
    .filter((summary) => summary.documentId === document.id && summary.tenantId === document.tenantId)
    .sort((left, right) => left.order - right.order)
}

function latestSummaryQueueFor(
  state: AppState,
  document: StoredNovelDocument,
): StoredNovelSummaryQueue | null {
  return (
    state.novelSummaryQueues
      .filter((queue) => queue.documentId === document.id && queue.tenantId === document.tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  )
}

function queueItemsFor(state: AppState, queue: StoredNovelSummaryQueue): StoredNovelSummaryQueueItem[] {
  return state.novelSummaryQueueItems
    .filter((item) => item.queueId === queue.id && item.tenantId === queue.tenantId)
    .sort((left, right) => left.order - right.order)
}

function toSummaryQueueResult(
  document: StoredNovelDocument,
  queue: StoredNovelSummaryQueue | null,
  state: AppState,
): NovelSummaryQueueResult {
  const summaries = summariesFor(state, document)
  return {
    document: toDocument(document),
    queue: queue ? toSummaryQueue(queue, state) : null,
    items: queue ? queueItemsFor(state, queue).map(toSummaryQueueItem) : [],
    summaryCount: summaries.length,
    missingSummaryCount: Math.max(0, document.chapterCount - summaries.length),
  }
}

function toSummaryQueue(queue: StoredNovelSummaryQueue, state: AppState): NovelSummaryQueue {
  const { clientRequestId: _clientRequestId, ...publicQueue } = queue
  const counts = queueCounts(queueItemsFor(state, queue))
  return {
    ...publicQueue,
    ...counts,
    totalItems: queueItemsFor(state, queue).length,
  }
}

function queueCounts(items: Array<{ status: NovelSummaryQueueItemStatus }>): QueueCounts {
  return {
    pendingCount: items.filter((item) => item.status === 'pending').length,
    runningCount: items.filter((item) => item.status === 'running').length,
    completedCount: items.filter((item) => item.status === 'completed').length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    skippedCount: items.filter((item) => item.status === 'skipped').length,
  }
}

function toSummaryQueueItem(item: StoredNovelSummaryQueueItem): StoredNovelSummaryQueueItem {
  return {
    ...item,
    result: item.result ?? null,
  }
}

function refreshQueueStatus(queue: StoredNovelSummaryQueue, state: AppState): void {
  const items = queueItemsFor(state, queue)
  const counts = queueCounts(items)
  queue.totalItems = items.length
  queue.pendingCount = counts.pendingCount
  queue.runningCount = counts.runningCount
  queue.completedCount = counts.completedCount
  queue.failedCount = counts.failedCount
  queue.skippedCount = counts.skippedCount
  queue.status = statusForQueueItems(items)
}

function statusForQueueItems(items: Array<{ status: NovelSummaryQueueItemStatus }>): NovelSummaryQueueStatus {
  const counts = queueCounts(items)
  if (counts.runningCount > 0) return 'running'
  if (counts.pendingCount > 0) return 'queued'
  if (counts.failedCount > 0) return 'failed'
  return 'completed'
}

function touchQueueContext(
  context: WritableSummaryQueueContext,
  state: AppState,
  timestamp = new Date().toISOString(),
  refresh = true,
): void {
  if (refresh) refreshQueueStatus(context.queue, state)
  if (context.queue.status === 'completed' && context.queue.failedCount > 0) context.queue.status = 'failed'
  context.queue.updatedAt = timestamp
  context.document.updatedAt = timestamp
  context.project.updatedAt = timestamp
}

function storyBibleFor(state: AppState, document: StoredNovelDocument): NovelStoryBible | null {
  return (
    state.novelStoryBibles.find(
      (storyBible) => storyBible.documentId === document.id && storyBible.tenantId === document.tenantId,
    ) ?? null
  )
}

function toDocument(document: StoredNovelDocument): NovelDocument {
  const { clientRequestId: _clientRequestId, ...publicDocument } = document
  return publicDocument
}

function toChapter(chapter: StoredNovelChapter): NovelChapter {
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
