import type {
  CreateNovelSummaryQueueRequest,
  ImportNovelRequest,
  NovelBoundary,
  NovelBoundaryDetectionResult,
  NovelBoundaryNotesResult,
  NovelChapter,
  NovelChapterSummary,
  NovelDocument,
  NovelImportResult,
  NovelSummaryQueue,
  NovelSummaryQueueCommitResult,
  NovelSummaryQueueItemStatus,
  NovelSummaryQueueItemResult,
  NovelSummaryQueueResult,
  NovelSummaryQueueStatus,
  NovelStoryBible,
  Principal,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
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

export class NovelRepository {
  constructor(private readonly store: AppStore) {}

  canImportNovel(projectId: string, principal: Principal): boolean {
    return this.store.read((state) => Boolean(findWritableProject(state, projectId, principal)))
  }

  list(projectId: string, principal: Principal): NovelDocument[] | null {
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      return state.novelDocuments
        .filter((document) => document.projectId === projectId && document.tenantId === principal.tenantId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(toDocument)
    })
  }

  detail(projectId: string, documentId: string, principal: Principal): NovelImportResult | null {
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
  ): NovelBoundaryDetectionResult | null {
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
  ): NovelBoundaryDetectionSource | null {
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

  summaries(projectId: string, documentId: string, principal: Principal): NovelChapterSummary[] | null {
    return this.store.read((state) => {
      if (!findReadableProject(state, projectId, principal)) return null
      const document = findDocument(state, projectId, documentId, principal.tenantId)
      if (!document) return null
      return summariesFor(state, document).map((summary) => ({ ...summary }))
    })
  }

  summaryQueue(projectId: string, documentId: string, principal: Principal): NovelSummaryQueueResult | null {
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
  ): NovelSummaryQueueSource | null {
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

  storyBible(projectId: string, documentId: string, principal: Principal): NovelStoryBible | null {
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
  ): NovelGenerationSource | null {
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

function findReadableProject(state: AppState, projectId: string, principal: Principal) {
  const canReadAll = principal.roles.some((role) => role === 'admin' || role === 'owner')
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
