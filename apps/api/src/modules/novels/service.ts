import type {
  CommitNovelSummaryQueueResultsRequest,
  CreateNovelSummaryQueueRequest,
  DetectNovelBoundariesRequest,
  GenerateNovelChapterAdaptationRequest,
  GenerateNovelAssetSuggestionsRequest,
  NovelChapterAdaptationResult,
  NovelAssetSuggestionsResult,
  GenerateNovelBoundaryNotesRequest,
  GenerateNovelChapterSummariesRequest,
  GenerateNovelChapterSummariesResult,
  GenerateNovelStoryBibleRequest,
  ImportNovelRequest,
  NovelChapter,
  NovelChapterSummary,
  NovelChapterSummariesResult,
  NovelDocument,
  NovelImportResult,
  NovelBoundary,
  NovelBoundaryDetectionResult,
  NovelBoundaryIssue,
  NovelBoundaryNotesResult,
  NovelBoundarySeverity,
  NovelSplitMode,
  NovelSplitOptions,
  NovelSplitPreviewChapter,
  NovelSplitPreviewResult,
  NovelSummaryQueueBatchResult,
  NovelSummaryQueueCommitResult,
  NovelSummaryQueueItemResult,
  NovelSummaryQueueResult,
  NovelStoryBible,
  NovelStoryBibleReadResult,
  NovelStoryBibleResult,
  Principal,
  PreviewNovelSplitRequest,
  RunNovelSummaryQueueBatchRequest,
  ScriptAssetSuggestion,
} from '@seqora/contracts'
import {
  NOVEL_OPERATION_CREDITS,
  novelBoundaryNotesContentSchema,
  novelChapterSummariesContentSchema,
  scriptAssetSuggestionsContentSchema,
  novelStoryBibleContentSchema,
} from '@seqora/contracts'
import { createHash } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import type { NovelRepository } from './repository.js'

type SplitNovelChapter = {
  order: number
  title: string
  startOffset: number
  endOffset: number
  sourceStartOffset: number
  sourceEndOffset: number
  sourceChapterTitle: string | null
  splitMode: NovelSplitMode
  overlapBeforeChars: number
  overlapAfterChars: number
  crossesChapterBoundary: boolean
  characterCount: number
  preview: string
  content: string
}

type ChapterHeading = {
  title: string
  startOffset: number
}

type SourceChapterRange = {
  title: string
  startOffset: number
  endOffset: number
}

type NovelSplitSettings = Required<NovelSplitOptions>

type PreparedNovelSplit = {
  content: string
  chapters: SplitNovelChapter[]
  settings: NovelSplitSettings
  warnings: string[]
}

type BoundaryChapter = {
  id: string
  order: number
  sourceStartOffset: number
  sourceEndOffset: number
  sourceChapterTitle: string | null
  crossesChapterBoundary: boolean
  content: string
}

type BoundaryDraft = {
  previousChapterId: string
  nextChapterId: string
  previousOrder: number
  nextOrder: number
  severity: NovelBoundarySeverity
  issues: NovelBoundaryIssue[]
  previousTail: string
  nextHead: string
}

type SummarySourceChapter = {
  id: string
  order: number
  title: string
  characterCount: number
  preview: string
  content: string
}

type NovelAssetSuggestionSource = {
  document: Pick<NovelDocument, 'name'>
  summaries: NovelChapterSummary[]
  storyBible: NovelStoryBible | null
}

type AdaptationSourceChapter = SummarySourceChapter &
  Pick<NovelChapter, 'sourceChapterTitle' | 'crossesChapterBoundary'>

const AUTO_SPLIT_TARGET_CHARS = 6_000
const AUTO_SPLIT_WINDOW_CHARS = 800
const AUTO_LONG_CHAPTER_FACTOR = 1.5
const DEFAULT_SPLIT_OPTIONS: NovelSplitSettings = {
  mode: 'auto',
  targetChars: AUTO_SPLIT_TARGET_CHARS,
  overlapChars: 300,
}
const MAX_CHAPTERS = 1_000
const CHAPTER_PROMPT_CHAR_LIMIT = 8_000
const CHAPTER_ADAPTATION_TOTAL_PROMPT_CHAR_LIMIT = 36_000
const NOVEL_CHAPTER_ADAPTATION_MAX_TOKENS = 6_000
const NOVEL_STORY_BIBLE_MAX_TOKENS = 6_000
const NOVEL_ASSET_SUGGESTIONS_MAX_TOKENS = 6_000
const STORY_OVERVIEW_SUMMARY_CHAR_LIMIT = 420
const STORY_OVERVIEW_FACT_CHAR_LIMIT = 120
const MOJIBAKE_PATTERN = /锟斤拷|銆|鐨|涓|锛|鈥|妗|绔|浠|珨|腔|衄|饒|欴|[ÃÂâ]/gu
const REPLACEMENT_PATTERN = /\uFFFD/gu

export class NovelService {
  constructor(
    private readonly repository: NovelRepository,
    private readonly textProvider: TextGenerationProvider | null = null,
    private readonly creditLedger: CreditLedger | null = null,
  ) {}

  list(projectId: string, principal: Principal) {
    const documents = this.repository.list(projectId, principal)
    if (!documents) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问')
    return documents
  }

  detail(projectId: string, documentId: string, principal: Principal) {
    const detail = this.repository.detail(projectId, documentId, principal)
    if (!detail) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权访问')
    return detail
  }

  boundaries(projectId: string, documentId: string, principal: Principal): NovelBoundaryDetectionResult {
    const result = this.repository.boundaries(projectId, documentId, principal)
    if (!result) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权访问边界识别结果')
    return result
  }

  async detectBoundaries(
    projectId: string,
    documentId: string,
    input: DetectNovelBoundariesRequest,
    principal: Principal,
  ): Promise<NovelBoundaryDetectionResult> {
    const source = this.repository.boundaryDetectionSource(projectId, documentId, principal)
    if (!source) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权检测边界')
    const warnings: string[] = []
    const drafts = detectBoundaryDrafts(source.chapters).slice(0, input.maxBoundaries)
    if (drafts.length >= input.maxBoundaries) {
      warnings.push(`疑似边界数量超过 ${input.maxBoundaries} 个，本次只保留前 ${input.maxBoundaries} 个`)
    }
    const result = await this.repository.saveDetectedBoundaries(
      projectId,
      documentId,
      drafts,
      input.force,
      principal,
      warnings,
    )
    if (!result) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权保存边界识别结果')
    return result
  }

  async generateBoundaryNotes(
    projectId: string,
    documentId: string,
    input: GenerateNovelBoundaryNotesRequest,
    clientRequestId: string,
    principal: Principal,
  ): Promise<NovelBoundaryNotesResult> {
    const current = this.repository.boundaries(projectId, documentId, principal)
    if (!current) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权生成边界说明')
    const selected = selectBoundariesForNotes(current.boundaries, input)
    if (!selected.length) {
      return {
        document: current.document,
        boundaries: current.boundaries,
        generatedBoundaryIds: [],
        missingNoteCount: missingBoundaryNoteCount(current.boundaries),
        generatedAt: new Date().toISOString(),
        warnings: [],
      }
    }
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')

    return this.runBillableNovelOperation(
      principal,
      `novel-boundary-notes-${documentId}-${clientRequestId}`,
      NOVEL_OPERATION_CREDITS.boundaryNotes,
      '生成小说边界衔接说明',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt: NOVEL_BOUNDARY_NOTE_SYSTEM_PROMPT,
          userPrompt: boundaryNotesPrompt(current.document.name, selected),
          maxOutputTokens: Math.min(6_000, Math.max(1_200, selected.length * 320)),
        })
        const parsed = parseBoundaryNotesProviderJson(response)
        const drafts = parsed.notes
          .map((note, index) => {
            const boundary = selected.find((item) => item.id === note.boundaryId) ?? selected[index]
            if (!boundary) return null
            return {
              boundaryId: boundary.id,
              note: note.note,
            }
          })
          .filter((note): note is NonNullable<typeof note> => Boolean(note))
        if (!drafts.length) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '边界衔接说明结果为空')

        const result = await this.repository.saveBoundaryNotes(
          projectId,
          documentId,
          drafts,
          input.force,
          principal,
          parsed.batchNotes ? [parsed.batchNotes] : [],
        )
        if (!result) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权保存边界说明')
        return result
      },
    )
  }

  summaries(projectId: string, documentId: string, principal: Principal): NovelChapterSummariesResult {
    const detail = this.detail(projectId, documentId, principal)
    const summaries = this.repository.summaries(projectId, documentId, principal)
    if (!summaries) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权访问')
    return {
      document: detail.document,
      summaries,
      completed: summaries.length >= detail.document.chapterCount,
      missingSummaryCount: Math.max(0, detail.document.chapterCount - summaries.length),
    }
  }

  summaryQueue(projectId: string, documentId: string, principal: Principal): NovelSummaryQueueResult {
    const result = this.repository.summaryQueue(projectId, documentId, principal)
    if (!result) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权访问摘要队列')
    return result
  }

  async createSummaryQueue(
    projectId: string,
    documentId: string,
    input: CreateNovelSummaryQueueRequest,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult> {
    const result = await this.repository.createSummaryQueue(projectId, documentId, input, principal)
    if (!result) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权创建摘要队列')
    return result
  }

  async runSummaryQueueBatch(
    projectId: string,
    documentId: string,
    queueId: string,
    input: RunNovelSummaryQueueBatchRequest,
    clientRequestId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueBatchResult> {
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')
    return this.runBillableNovelOperation(
      principal,
      `novel-summary-queue-${queueId}-${clientRequestId}`,
      NOVEL_OPERATION_CREDITS.chapterSummaryBatch,
      '批量生成小说章节摘要队列',
      async () => this.runSummaryQueueBatchInternal(projectId, documentId, queueId, input, principal),
    )
  }

  async pauseSummaryQueue(
    projectId: string,
    documentId: string,
    queueId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult> {
    const source = this.repository.summaryQueueSource(projectId, documentId, queueId, principal)
    if (!source) throw new AppError(404, 'NOVEL_SUMMARY_QUEUE_NOT_FOUND', '摘要队列不存在或无权访问')
    if (['completed', 'cancelled'].includes(source.queue.status)) {
      throw new AppError(409, 'NOVEL_SUMMARY_QUEUE_TERMINAL', '摘要队列已结束，不能暂停')
    }
    const result = await this.repository.pauseSummaryQueue(projectId, documentId, queueId, principal)
    if (!result) throw new AppError(404, 'NOVEL_SUMMARY_QUEUE_NOT_FOUND', '摘要队列不存在或无权暂停')
    return result
  }

  async resumeSummaryQueue(
    projectId: string,
    documentId: string,
    queueId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult> {
    const result = await this.repository.resumeSummaryQueue(projectId, documentId, queueId, principal)
    if (!result) throw new AppError(404, 'NOVEL_SUMMARY_QUEUE_NOT_FOUND', '摘要队列不存在或无权恢复')
    return result
  }

  async retrySummaryQueueItem(
    projectId: string,
    documentId: string,
    queueId: string,
    itemId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult> {
    const result = await this.repository.retrySummaryQueueItem(
      projectId,
      documentId,
      queueId,
      itemId,
      principal,
    )
    if (!result) throw new AppError(409, 'NOVEL_SUMMARY_QUEUE_ITEM_NOT_RETRYABLE', '该摘要条目当前不能重试')
    return result
  }

  async skipSummaryQueueItem(
    projectId: string,
    documentId: string,
    queueId: string,
    itemId: string,
    principal: Principal,
  ): Promise<NovelSummaryQueueResult> {
    const result = await this.repository.skipSummaryQueueItem(
      projectId,
      documentId,
      queueId,
      itemId,
      principal,
    )
    if (!result) throw new AppError(409, 'NOVEL_SUMMARY_QUEUE_ITEM_NOT_SKIPPABLE', '该摘要条目当前不能跳过')
    return result
  }

  async commitSummaryQueueResults(
    projectId: string,
    documentId: string,
    queueId: string,
    input: CommitNovelSummaryQueueResultsRequest,
    principal: Principal,
  ): Promise<NovelSummaryQueueCommitResult> {
    const result = await this.repository.commitSummaryQueueResults(
      projectId,
      documentId,
      queueId,
      input.force,
      principal,
    )
    if (!result) throw new AppError(404, 'NOVEL_SUMMARY_QUEUE_NOT_FOUND', '摘要队列不存在或无权提交')
    return result
  }

  private async runSummaryQueueBatchInternal(
    projectId: string,
    documentId: string,
    queueId: string,
    input: RunNovelSummaryQueueBatchRequest,
    principal: Principal,
  ): Promise<NovelSummaryQueueBatchResult> {
    const source = this.repository.summaryQueueSource(projectId, documentId, queueId, principal)
    if (!source) throw new AppError(404, 'NOVEL_SUMMARY_QUEUE_NOT_FOUND', '摘要队列不存在或无权访问')
    if (source.queue.status === 'paused') {
      throw new AppError(409, 'NOVEL_SUMMARY_QUEUE_PAUSED', '摘要队列已暂停，请先恢复后再处理')
    }
    if (['completed', 'cancelled'].includes(source.queue.status)) {
      throw new AppError(409, 'NOVEL_SUMMARY_QUEUE_TERMINAL', '摘要队列已结束，不能继续处理')
    }

    const batchSize = Math.min(input.batchSize ?? source.queue.batchSize, 24)
    const pendingItems = source.items
      .filter((item) => item.status === 'pending')
      .sort((left, right) => left.order - right.order)
      .slice(0, batchSize)
    const processedItemIds: string[] = []
    const failedItemIds: string[] = []
    const warnings: string[] = []

    for (const item of pendingItems) {
      const chapter = source.chapters.find((candidate) => candidate.id === item.chapterId)
      const started = await this.repository.startSummaryQueueItem(
        projectId,
        documentId,
        queueId,
        item.id,
        principal,
      )
      if (!started) {
        failedItemIds.push(item.id)
        warnings.push(`章节 ${item.order} 未能锁定，已跳过本轮处理`)
        continue
      }
      if (!chapter) {
        await this.repository.failSummaryQueueItem(
          projectId,
          documentId,
          queueId,
          item.id,
          '章节正文不存在，无法生成摘要',
          principal,
        )
        failedItemIds.push(item.id)
        continue
      }

      try {
        const result = await this.generateQueueItemSummary(source.document.name, chapter)
        await this.repository.completeSummaryQueueItem(
          projectId,
          documentId,
          queueId,
          item.id,
          result,
          principal,
        )
        processedItemIds.push(item.id)
      } catch (error) {
        await this.repository.failSummaryQueueItem(
          projectId,
          documentId,
          queueId,
          item.id,
          messageFor(error),
          principal,
        )
        failedItemIds.push(item.id)
      }
    }

    const latest = this.repository.summaryQueue(projectId, documentId, principal)
    if (!latest) throw new AppError(404, 'NOVEL_SUMMARY_QUEUE_NOT_FOUND', '摘要队列不存在或无权访问')
    return {
      ...latest,
      processedItemIds,
      failedItemIds,
      warnings,
    }
  }

  private async generateQueueItemSummary(
    novelName: string,
    chapter: SummarySourceChapter,
  ): Promise<NovelSummaryQueueItemResult> {
    const response = await this.textProvider!.generate({
      systemPrompt: NOVEL_CHAPTER_SUMMARY_SYSTEM_PROMPT,
      userPrompt: chapterSummaryPrompt(novelName, [chapter]),
      maxOutputTokens: chapterSummaryMaxTokens(1),
    })
    const parsed = parseChapterSummariesProviderJson(response)
    const summary = parsed.summaries[0]
    if (!summary) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '章节摘要结果为空')
    return {
      summary: summary.summary,
      keyEvents: summary.keyEvents,
      characters: summary.characters,
      locations: summary.locations,
      timeline: summary.timeline,
      keyProps: summary.keyProps,
      foreshadowing: summary.foreshadowing,
      worldRules: summary.worldRules,
      adaptationNotes: summary.adaptationNotes,
    }
  }

  storyBible(projectId: string, documentId: string, principal: Principal): NovelStoryBibleReadResult {
    const detail = this.detail(projectId, documentId, principal)
    const summaries = this.repository.summaries(projectId, documentId, principal)
    if (!summaries) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权访问')
    return {
      storyBible: this.repository.storyBible(projectId, documentId, principal),
      summaryCount: summaries.length,
      chapterCount: detail.document.chapterCount,
      missingSummaryCount: Math.max(0, detail.document.chapterCount - summaries.length),
    }
  }

  async importNovel(
    projectId: string,
    input: ImportNovelRequest,
    principal: Principal,
  ): Promise<NovelImportResult> {
    const { content, chapters } = prepareNovelSplit(input)

    const result = await this.repository.importNovel(projectId, { ...input, content }, chapters, principal)
    if (!result) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权导入小说')
    return result
  }

  previewSplit(
    projectId: string,
    input: PreviewNovelSplitRequest,
    principal: Principal,
  ): NovelSplitPreviewResult {
    if (!this.repository.canImportNovel(projectId, principal)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权预览小说切分')
    }

    const { content, chapters, settings, warnings } = prepareNovelSplit(input)
    const splitMode = chapters[0]?.splitMode ?? settings.mode
    return {
      previewId: createNovelSplitPreviewId(input.name, input.format, content, settings),
      name: input.name,
      format: input.format,
      characterCount: chapters.reduce((total, chapter) => total + chapter.characterCount, 0),
      chapterCount: chapters.length,
      splitMode,
      splitOptions: settings,
      coveragePassed: true,
      warnings,
      previewedAt: new Date().toISOString(),
      chapters: chapters.map(toPreviewChapter),
    }
  }

  async generateChapterSummaries(
    projectId: string,
    documentId: string,
    input: GenerateNovelChapterSummariesRequest,
    clientRequestId: string,
    principal: Principal,
  ): Promise<GenerateNovelChapterSummariesResult> {
    const source = this.repository.sourceForGeneration(projectId, documentId, principal)
    if (!source) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权生成摘要')
    const selectedChapters = selectChaptersForSummary(source.chapters, source.summaries, input)
    if (!selectedChapters.length) {
      return {
        document: publicDocument(source.document),
        summaries: source.summaries,
        generatedSummaries: [],
        completed: source.summaries.length >= source.document.chapterCount,
        nextChapterOrder: null,
        generatedAt: new Date().toISOString(),
        warnings: [],
      }
    }
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')

    return this.runBillableNovelOperation(
      principal,
      `novel-chapter-summaries-${documentId}-${clientRequestId}`,
      NOVEL_OPERATION_CREDITS.chapterSummaryBatch,
      '生成小说章节摘要',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt: NOVEL_CHAPTER_SUMMARY_SYSTEM_PROMPT,
          userPrompt: chapterSummaryPrompt(source.document.name, selectedChapters),
          maxOutputTokens: chapterSummaryMaxTokens(selectedChapters.length),
        })
        const parsed = parseChapterSummariesProviderJson(response)
        const drafts = parsed.summaries
          .map((summary, index) => {
            const chapter =
              selectedChapters.find((item) => item.order === summary.order) ?? selectedChapters[index]
            if (!chapter) return null
            return {
              chapterId: chapter.id,
              order: chapter.order,
              title: chapter.title,
              summary: summary.summary,
              keyEvents: summary.keyEvents,
              characters: summary.characters,
              locations: summary.locations,
              timeline: summary.timeline,
              keyProps: summary.keyProps,
              foreshadowing: summary.foreshadowing,
              worldRules: summary.worldRules,
              adaptationNotes: summary.adaptationNotes,
            }
          })
          .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary))
        if (!drafts.length) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '章节摘要结果为空')

        const summaries = await this.repository.saveChapterSummaries(
          projectId,
          documentId,
          drafts,
          principal,
          input.force,
        )
        if (!summaries) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权生成摘要')
        const generatedIds = new Set(drafts.map((summary) => summary.chapterId))
        const generatedSummaries = summaries.filter((summary) => generatedIds.has(summary.chapterId))
        const nextChapter = source.chapters.find(
          (chapter) =>
            !summaries.some((summary) => summary.chapterId === chapter.id) && !generatedIds.has(chapter.id),
        )
        return {
          document: publicDocument(source.document),
          summaries,
          generatedSummaries,
          completed: summaries.length >= source.document.chapterCount,
          nextChapterOrder: nextChapter?.order ?? null,
          generatedAt: new Date().toISOString(),
          warnings: parsed.batchNotes ? [parsed.batchNotes] : [],
        }
      },
    )
  }

  async generateStoryBible(
    projectId: string,
    documentId: string,
    input: GenerateNovelStoryBibleRequest,
    clientRequestId: string,
    principal: Principal,
  ): Promise<NovelStoryBibleResult> {
    const source = this.repository.sourceForGeneration(projectId, documentId, principal)
    if (!source) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权生成故事概要')
    const missingSummaryCount = Math.max(0, source.document.chapterCount - source.summaries.length)
    if (missingSummaryCount > 0) {
      throw new AppError(409, 'NOVEL_SUMMARIES_INCOMPLETE', '请先完成全部章节摘要，再生成故事概要')
    }
    if (source.storyBible && !input.force) {
      return {
        storyBible: source.storyBible,
        missingSummaryCount: 0,
        generatedAt: new Date().toISOString(),
        warnings: [],
      }
    }
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')

    return this.runBillableNovelOperation(
      principal,
      `novel-story-bible-${documentId}-${clientRequestId}`,
      NOVEL_OPERATION_CREDITS.storyBible,
      '生成小说故事概要',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt: NOVEL_STORY_BIBLE_SYSTEM_PROMPT,
          userPrompt: storyBiblePrompt(source.document.name, source.summaries),
          maxOutputTokens: NOVEL_STORY_BIBLE_MAX_TOKENS,
        })
        const parsed = parseStoryBibleProviderJson(response)
        const storyBible = await this.repository.saveStoryBible(
          projectId,
          documentId,
          parsed,
          source.summaries.length,
          principal,
        )
        if (!storyBible) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权生成故事概要')
        return {
          storyBible,
          missingSummaryCount: 0,
          generatedAt: new Date().toISOString(),
          warnings: [],
        }
      },
    )
  }

  async suggestAssets(
    projectId: string,
    documentId: string,
    input: GenerateNovelAssetSuggestionsRequest,
    _clientRequestId: string,
    principal: Principal,
  ): Promise<NovelAssetSuggestionsResult> {
    const source = this.repository.sourceForGeneration(projectId, documentId, principal)
    if (!source) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权生成资产建议')
    if (!source.summaries.length) {
      throw new AppError(409, 'NOVEL_SUMMARIES_REQUIRED', '请先生成至少一批章节概要，再生成小说资产建议')
    }

    const fallback = fallbackNovelAssetSuggestions(source, input.maxAssets)
    let warnings: string[] = []
    let result = fallback

    if (!this.textProvider) {
      warnings = ['文本服务未配置，已根据章节概要和故事概要做基础资产建议']
    } else {
      try {
        const response = await this.textProvider.generate({
          systemPrompt: NOVEL_ASSET_SUGGESTIONS_SYSTEM_PROMPT,
          userPrompt: novelAssetSuggestionsPrompt(source, input.maxAssets),
          maxOutputTokens: NOVEL_ASSET_SUGGESTIONS_MAX_TOKENS,
        })
        result = scriptAssetSuggestionsContentSchema.parse(
          parseProviderJsonValue(response, '小说资产建议结果格式错误'),
        )
      } catch {
        warnings = ['文本服务返回格式异常，已根据章节概要和故事概要做基础资产建议']
        result = fallback
      }
    }

    return {
      summary: result.summary,
      assets: deduplicateNovelAssetSuggestions(result.assets).slice(0, input.maxAssets),
      generatedAt: new Date().toISOString(),
      warnings,
    }
  }

  async generateChapterAdaptation(
    projectId: string,
    documentId: string,
    input: GenerateNovelChapterAdaptationRequest,
    clientRequestId: string,
    principal: Principal,
  ): Promise<NovelChapterAdaptationResult> {
    const source = this.repository.sourceForGeneration(projectId, documentId, principal)
    if (!source) throw new AppError(404, 'NOVEL_NOT_FOUND', '小说不存在或无权生成章节改编剧本')
    const selectedChapters = selectChaptersForAdaptation(source.chapters, input)
    if (selectedChapters.length !== new Set(input.chapterIds).size) {
      throw new AppError(400, 'NOVEL_CHAPTER_NOT_FOUND', '选择的章节不存在或不属于当前小说')
    }
    if (!this.textProvider) throw new AppError(503, 'TEXT_PROVIDER_NOT_CONFIGURED', '文本生成服务尚未配置')

    return this.runBillableNovelOperation(
      principal,
      `novel-chapter-adaptation-${documentId}-${clientRequestId}`,
      NOVEL_OPERATION_CREDITS.chapterAdaptation,
      '生成小说章节视频改编剧本',
      async () => {
        const response = await this.textProvider!.generate({
          systemPrompt: NOVEL_CHAPTER_ADAPTATION_SYSTEM_PROMPT,
          userPrompt: chapterAdaptationPrompt(
            source.document.name,
            selectedChapters,
            source.summaries,
            source.storyBible,
            input,
          ),
          maxOutputTokens: NOVEL_CHAPTER_ADAPTATION_MAX_TOKENS,
        })
        const script = normalizeAdaptedScript(response)
        if (!script) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '章节改编剧本为空')
        return {
          document: publicDocument(source.document),
          chapters: selectedChapters.map(publicChapter),
          script,
          targetSeconds: input.targetSeconds,
          mode: input.mode,
          generatedAt: new Date().toISOString(),
          warnings: chapterAdaptationWarnings(source.summaries, source.storyBible, selectedChapters),
        }
      },
    )
  }

  private async runBillableNovelOperation<T>(
    principal: Principal,
    referenceId: string,
    credits: number,
    description: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.creditLedger) return operation()
    const reserved = await this.creditLedger.reserve(principal, credits, referenceId, description)
    if (!reserved) throw new AppError(409, 'DUPLICATE_REQUEST', '该请求已处理，请勿重复提交')
    try {
      return await operation()
    } catch (error) {
      await this.creditLedger.refundReservation(principal, referenceId, `${description} · 失败退款`)
      throw error
    }
  }
}

function detectBoundaryDrafts(chapters: BoundaryChapter[]): BoundaryDraft[] {
  const drafts: BoundaryDraft[] = []
  const ordered = chapters.slice().sort((left, right) => left.order - right.order)
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const previous = ordered[index]!
    const next = ordered[index + 1]!
    const issues = boundaryIssues(previous, next)
    if (!issues.length) continue
    drafts.push({
      previousChapterId: previous.id,
      nextChapterId: next.id,
      previousOrder: previous.order,
      nextOrder: next.order,
      severity: boundarySeverity(issues),
      issues,
      previousTail: boundaryTail(previous.content),
      nextHead: boundaryHead(next.content),
    })
  }
  return drafts
}

function boundaryIssues(previous: BoundaryChapter, next: BoundaryChapter): NovelBoundaryIssue[] {
  const issues = new Set<NovelBoundaryIssue>()
  const tail = boundaryTail(previous.content)
  const head = boundaryHead(next.content)
  if (!endsLikeCompleteSentence(tail) && !startsLikeChapterHeading(head)) issues.add('sentence-fragment')
  if (hasUnbalancedDialogue(tail) || startsInsideDialogue(head)) issues.add('dialogue-fragment')
  if (previous.sourceEndOffset < next.sourceStartOffset) issues.add('offset-gap')
  if (
    (previous.crossesChapterBoundary || next.crossesChapterBoundary) &&
    previous.sourceChapterTitle !== next.sourceChapterTitle
  ) {
    issues.add('cross-chapter')
  }
  return Array.from(issues)
}

function boundarySeverity(issues: NovelBoundaryIssue[]): NovelBoundarySeverity {
  if (issues.includes('dialogue-fragment') || issues.includes('offset-gap')) return 'high'
  if (issues.includes('sentence-fragment')) return 'medium'
  return 'low'
}

function boundaryTail(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(-300)
}

function boundaryHead(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function endsLikeCompleteSentence(text: string): boolean {
  return /[。！？!?…」』”’）)】\]]$/u.test(text.trim())
}

function startsLikeChapterHeading(text: string): boolean {
  return /^(第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部集幕]|序章|楔子|引子|尾声|番外|Chapter\s+\d+)/iu.test(
    text.trim(),
  )
}

function hasUnbalancedDialogue(text: string): boolean {
  const value = text.trim()
  return (
    countMatches(value, /“/gu) > countMatches(value, /”/gu) ||
    countMatches(value, /「/gu) > countMatches(value, /」/gu)
  )
}

function startsInsideDialogue(text: string): boolean {
  return /^[^“「”」]{0,30}[”」]/u.test(text.trim())
}

function prepareNovelSplit(input: Pick<ImportNovelRequest, 'content' | 'splitOptions'>): PreparedNovelSplit {
  const content = normalizeNovelContent(input.content)
  if (!content) throw new AppError(400, 'NOVEL_CONTENT_REQUIRED', '请上传有正文内容的小说文件')
  if (looksLikeUnreadableNovelContent(content)) {
    throw new AppError(
      400,
      'NOVEL_CONTENT_UNREADABLE',
      '小说正文疑似编码乱码，请重新选择文件或转成 UTF-8 / GB18030 后再导入',
    )
  }

  const settings = normalizeSplitSettings(input.splitOptions ?? {})
  const chapters = splitNovelChapters(content, settings)
  if (chapters.length > MAX_CHAPTERS) {
    throw new AppError(400, 'NOVEL_TOO_MANY_CHAPTERS', `章节数量超过 ${MAX_CHAPTERS} 个，请先拆分文件`)
  }

  return {
    content,
    chapters,
    settings,
    warnings: splitWarnings(settings, chapters),
  }
}

function createNovelSplitPreviewId(
  name: string,
  format: string,
  content: string,
  settings: NovelSplitSettings,
): string {
  return createHash('sha256')
    .update(name)
    .update('\0')
    .update(format)
    .update('\0')
    .update(JSON.stringify(settings))
    .update('\0')
    .update(content)
    .digest('hex')
    .slice(0, 24)
}

function toPreviewChapter(chapter: SplitNovelChapter): NovelSplitPreviewChapter {
  const preview = chapterPreviewFor(chapter.content, chapter.title)
  return {
    id: `preview-chapter-${chapter.order}`,
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
    preview: preview.text,
    previewTruncated: preview.truncated,
  }
}

function splitWarnings(settings: NovelSplitSettings, chapters: SplitNovelChapter[]): string[] {
  const warnings: string[] = []
  const splitMode = chapters[0]?.splitMode ?? settings.mode
  if (settings.mode === 'heading' && splitMode === 'fixed') {
    warnings.push('未识别到至少 2 个可靠章节标题，已按固定分块处理')
  }
  if (splitMode === 'fixed') {
    warnings.push(`本次按约 ${settings.targetChars} 字切分，适合无章节或章节质量不稳定的长文本`)
  }
  const splitLongChapterCount = chapters.filter((chapter) => / · 分段 \d+$/u.test(chapter.title)).length
  if (splitLongChapterCount > 0) {
    warnings.push(`检测到长章节，已继续拆成 ${splitLongChapterCount} 个可处理分块`)
  }
  const crossBoundaryCount = chapters.filter((chapter) => chapter.crossesChapterBoundary).length
  if (crossBoundaryCount > 0) {
    warnings.push(`有 ${crossBoundaryCount} 个分块跨越章节边界，后续会进入边界衔接检查`)
  }
  return warnings
}

export function normalizeNovelContent(input: string): string {
  return input
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^\s*声明：本书为.*(?:\n|$)/gmu, '')
    .replace(/^\s*-{5,}.*用户上传之内容开始.*-{5,}\s*$/gmu, '')
    .replace(/^\s*\(?\s*重要提示：.*(?:t\s*x\s*t|txt|域名|本站).*$/gimu, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

export function looksLikeUnreadableNovelContent(content: string): boolean {
  const sample = content.slice(0, 20_000)
  const replacementCount = countMatches(sample, REPLACEMENT_PATTERN)
  const suspiciousCount = countMatches(sample, MOJIBAKE_PATTERN)
  return (
    replacementCount > Math.max(8, sample.length * 0.004) ||
    suspiciousCount > Math.max(12, sample.length * 0.006)
  )
}

export function splitNovelChapters(
  content: string,
  options: Partial<NovelSplitOptions> = {},
): SplitNovelChapter[] {
  const settings = normalizeSplitSettings(options)
  const headings = detectChapterHeadings(content)
  const sourceChapters = sourceRangesFor(content, headings)
  const splitMode = resolvedSplitMode(settings.mode, headings)
  const chapters =
    splitMode === 'heading'
      ? splitBySourceChapters(content, sourceChapters, settings)
      : splitByLength(content, sourceChapters, settings, splitMode)
  assertSourceCoverage(content, chapters)
  return chapters
}

function normalizeSplitSettings(options: Partial<NovelSplitOptions>): NovelSplitSettings {
  const targetChars = clampInteger(options.targetChars, 1_000, 20_000, DEFAULT_SPLIT_OPTIONS.targetChars)
  const overlapChars = clampInteger(options.overlapChars, 0, 1_000, DEFAULT_SPLIT_OPTIONS.overlapChars)
  return {
    mode: options.mode ?? DEFAULT_SPLIT_OPTIONS.mode,
    targetChars,
    overlapChars: Math.min(overlapChars, targetChars - 1),
  }
}

function resolvedSplitMode(mode: NovelSplitMode, headings: ChapterHeading[]): NovelSplitMode {
  if (mode === 'auto') return headings.length >= 2 ? 'heading' : 'fixed'
  if (mode === 'heading' && headings.length < 2) return 'fixed'
  return mode
}

function sourceRangesFor(content: string, headings: ChapterHeading[]): SourceChapterRange[] {
  if (headings.length < 2) return [{ title: '全文', startOffset: 0, endOffset: content.length }]

  const ranges: SourceChapterRange[] = []
  const openingEndOffset = headings[0]?.startOffset ?? 0
  if (content.slice(0, openingEndOffset).trim()) {
    ranges.push({ title: '开篇', startOffset: 0, endOffset: openingEndOffset })
  }

  for (const [index, heading] of headings.entries()) {
    ranges.push({
      title: heading.title,
      startOffset: heading.startOffset,
      endOffset: headings[index + 1]?.startOffset ?? content.length,
    })
  }

  return ranges
}

function splitBySourceChapters(
  content: string,
  sourceChapters: SourceChapterRange[],
  settings: NovelSplitSettings,
): SplitNovelChapter[] {
  const chapters: SplitNovelChapter[] = []
  for (const sourceChapter of sourceChapters) {
    const characterCount = countCharacters(content.slice(sourceChapter.startOffset, sourceChapter.endOffset))
    if (characterCount > settings.targetChars * AUTO_LONG_CHAPTER_FACTOR) {
      chapters.push(...splitRangeByLength(content, sourceChapter, settings, 'heading', chapters.length))
      continue
    }
    const chapter = createChapter(
      content,
      {
        title: sourceChapter.title,
        startOffset: sourceChapter.startOffset,
        endOffset: sourceChapter.endOffset,
        sourceStartOffset: sourceChapter.startOffset,
        sourceEndOffset: sourceChapter.endOffset,
        sourceChapterTitle: sourceChapter.title,
        splitMode: 'heading',
        overlapBeforeChars: 0,
        overlapAfterChars: 0,
        crossesChapterBoundary: false,
      },
      chapters.length + 1,
    )
    if (chapter) chapters.push(chapter)
  }
  return chapters
}

function splitByLength(
  content: string,
  sourceChapters: SourceChapterRange[],
  settings: NovelSplitSettings,
  splitMode: NovelSplitMode,
): SplitNovelChapter[] {
  return splitRangeByLength(
    content,
    { title: '全文', startOffset: 0, endOffset: content.length },
    settings,
    splitMode,
    0,
    sourceChapters,
  )
}

function splitRangeByLength(
  content: string,
  range: SourceChapterRange,
  settings: NovelSplitSettings,
  splitMode: NovelSplitMode,
  orderOffset: number,
  sourceChapters: SourceChapterRange[] = [range],
): SplitNovelChapter[] {
  const chapters: SplitNovelChapter[] = []
  let startOffset = range.startOffset
  while (startOffset < range.endOffset) {
    const endOffset = chooseAutoSplitEnd(content, startOffset, range.endOffset, settings.targetChars)
    const order = orderOffset + chapters.length + 1
    const title = chunkTitleFor(range.title, order, startOffset, range, endOffset)
    const sourceInfo = sourceInfoForRange(sourceChapters, startOffset, endOffset)
    const chapter = createChapter(
      content,
      {
        title,
        startOffset,
        endOffset,
        sourceStartOffset: startOffset,
        sourceEndOffset: endOffset,
        sourceChapterTitle: sourceInfo.sourceChapterTitle,
        splitMode,
        overlapBeforeChars: Math.min(settings.overlapChars, Math.max(0, startOffset - range.startOffset)),
        overlapAfterChars: Math.min(settings.overlapChars, Math.max(0, range.endOffset - endOffset)),
        crossesChapterBoundary: sourceInfo.crossesChapterBoundary,
      },
      order,
    )
    if (chapter) chapters.push(chapter)
    startOffset = endOffset
  }
  return chapters
}

function detectChapterHeadings(content: string): ChapterHeading[] {
  const headings: ChapterHeading[] = []
  const linePattern = /^.*$/gm
  for (const match of content.matchAll(linePattern)) {
    const rawLine = match[0] ?? ''
    const title = cleanHeading(rawLine)
    if (!title) continue
    headings.push({
      title,
      startOffset: match.index ?? 0,
    })
  }
  return headings
}

function cleanHeading(line: string): string {
  const title = line
    .trim()
    .replace(/^#{1,3}\s+/u, '')
    .trim()
  if (!title || title.length > 120) return ''
  if (/^#{1,3}\s+\S/u.test(line)) return title.slice(0, 120)
  if (/^(序章|楔子|引子|尾声|番外)(?:[：:、\s-].{0,80})?$/u.test(title)) return title
  if (
    /^第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部集幕](?:[：:、\s.-].{0,80}|.{0,40})$/u.test(title)
  ) {
    return title
  }
  if (/^Chapter\s+\d+\b.{0,80}$/iu.test(title)) return title
  return ''
}

function chooseAutoSplitEnd(
  content: string,
  startOffset: number,
  maxEndOffset: number,
  targetChars: number,
): number {
  const target = Math.min(maxEndOffset, startOffset + targetChars)
  if (target === maxEndOffset) return maxEndOffset

  const windowStart = Math.max(startOffset + Math.floor(targetChars * 0.6), target - AUTO_SPLIT_WINDOW_CHARS)
  const windowEnd = Math.min(maxEndOffset, target + AUTO_SPLIT_WINDOW_CHARS)
  const windowText = content.slice(windowStart, windowEnd)
  const relativeCandidates = [
    windowText.lastIndexOf('\n\n'),
    Math.max(
      windowText.lastIndexOf('。'),
      windowText.lastIndexOf('！'),
      windowText.lastIndexOf('？'),
      windowText.lastIndexOf('.'),
      windowText.lastIndexOf('!'),
      windowText.lastIndexOf('?'),
    ),
    windowText.lastIndexOf('\n'),
  ].filter((index) => index >= 0)
  if (!relativeCandidates.length) return Math.max(target, startOffset + 1)
  return Math.min(maxEndOffset, Math.max(windowStart + Math.max(...relativeCandidates) + 1, startOffset + 1))
}

function createChapter(
  content: string,
  segment: {
    title: string
    startOffset: number
    endOffset: number
    sourceStartOffset: number
    sourceEndOffset: number
    sourceChapterTitle: string | null
    splitMode: NovelSplitMode
    overlapBeforeChars: number
    overlapAfterChars: number
    crossesChapterBoundary: boolean
  },
  order: number,
): SplitNovelChapter | null {
  const rawContent = content.slice(segment.startOffset, segment.endOffset)
  if (!rawContent.trim()) return null
  const characterCount = countCharacters(rawContent)
  if (!characterCount) return null

  return {
    order,
    title: segment.title.slice(0, 120),
    startOffset: segment.startOffset,
    endOffset: segment.endOffset,
    sourceStartOffset: segment.sourceStartOffset,
    sourceEndOffset: segment.sourceEndOffset,
    sourceChapterTitle: segment.sourceChapterTitle,
    splitMode: segment.splitMode,
    overlapBeforeChars: segment.overlapBeforeChars,
    overlapAfterChars: segment.overlapAfterChars,
    crossesChapterBoundary: segment.crossesChapterBoundary,
    characterCount,
    preview: previewFor(rawContent, segment.title),
    content: rawContent,
  }
}

function previewFor(content: string, title: string): string {
  return content.replace(title, '').replace(/\s+/g, ' ').trim().slice(0, 160)
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

function countCharacters(content: string): number {
  return content.replace(/\s/g, '').length
}

function chunkTitleFor(
  sourceTitle: string,
  order: number,
  startOffset: number,
  range: SourceChapterRange,
  endOffset: number,
): string {
  if (range.title !== '全文') {
    const suffix =
      startOffset === range.startOffset && endOffset === range.endOffset ? '' : ` · 分段 ${order}`
    return `${sourceTitle}${suffix}`.slice(0, 120)
  }
  return `自动分段 ${String(order).padStart(2, '0')}`
}

function sourceInfoForRange(
  sourceChapters: SourceChapterRange[],
  startOffset: number,
  endOffset: number,
): { sourceChapterTitle: string | null; crossesChapterBoundary: boolean } {
  const overlapping = sourceChapters.filter(
    (chapter) => chapter.startOffset < endOffset && chapter.endOffset > startOffset,
  )
  if (overlapping.length === 1) {
    return {
      sourceChapterTitle: overlapping[0]?.title ?? null,
      crossesChapterBoundary: false,
    }
  }
  return {
    sourceChapterTitle: null,
    crossesChapterBoundary: overlapping.length > 1,
  }
}

function assertSourceCoverage(content: string, chapters: SplitNovelChapter[]): void {
  const sourceText = compactCoverageText(content)
  const coveredText = compactCoverageText(
    chapters
      .slice()
      .sort((left, right) => left.sourceStartOffset - right.sourceStartOffset)
      .map((chapter) => content.slice(chapter.sourceStartOffset, chapter.sourceEndOffset))
      .join(''),
  )
  if (coveredText !== sourceText) {
    throw new AppError(500, 'NOVEL_SPLIT_COVERAGE_FAILED', '小说切分覆盖校验失败，请调整切分参数后重试')
  }
}

function compactCoverageText(content: string): string {
  return content.replace(/\s/g, '')
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function selectBoundariesForNotes(
  boundaries: NovelBoundary[],
  input: GenerateNovelBoundaryNotesRequest,
): NovelBoundary[] {
  const requestedIds = new Set(input.boundaryIds ?? [])
  return (input.boundaryIds ? boundaries.filter((boundary) => requestedIds.has(boundary.id)) : boundaries)
    .filter((boundary) => boundary.status !== 'ignored')
    .filter((boundary) => input.force || !boundary.note)
    .sort((left, right) => left.previousOrder - right.previousOrder)
    .slice(0, input.batchSize)
}

function missingBoundaryNoteCount(boundaries: NovelBoundary[]): number {
  return boundaries.filter((boundary) => boundary.status !== 'ignored' && !boundary.note).length
}

function selectChaptersForSummary(
  chapters: SummarySourceChapter[],
  summaries: NovelChapterSummary[],
  input: GenerateNovelChapterSummariesRequest,
): SummarySourceChapter[] {
  const summarizedIds = new Set(summaries.map((summary) => summary.chapterId))
  const requestedIds = new Set(input.chapterIds ?? [])
  const candidates = input.chapterIds
    ? chapters.filter((chapter) => requestedIds.has(chapter.id))
    : input.force
      ? chapters
      : chapters.filter((chapter) => !summarizedIds.has(chapter.id))

  return candidates
    .filter((chapter) => input.force || !summarizedIds.has(chapter.id))
    .sort((left, right) => left.order - right.order)
    .slice(0, input.batchSize)
}

function selectChaptersForAdaptation<T extends { id: string; order: number }>(
  chapters: T[],
  input: GenerateNovelChapterAdaptationRequest,
): T[] {
  const requestedIds = Array.from(new Set(input.chapterIds))
  const requested = new Set(requestedIds)
  return chapters
    .filter((chapter) => requested.has(chapter.id))
    .sort((left, right) => left.order - right.order)
}

function publicDocument(document: NovelDocument & { clientRequestId?: string }): NovelDocument {
  const { clientRequestId: _clientRequestId, ...publicValue } = document
  return publicValue
}

function publicChapter(chapter: NovelChapter & { content?: string }): NovelChapter {
  const { content: _content, ...publicValue } = chapter
  return publicValue
}

function chapterSummaryPrompt(name: string, chapters: SummarySourceChapter[]): string {
  const chapterBlocks = chapters
    .map((chapter) =>
      [
        `章节序号：${chapter.order}`,
        `章节标题：${chapter.title}`,
        `章节字数：${chapter.characterCount}`,
        `正文：\n${headExcerpt(chapter.content, CHAPTER_PROMPT_CHAR_LIMIT)}`,
      ].join('\n'),
    )
    .join('\n\n---\n\n')
  return [
    `作品名称：${name}`,
    '请按章节逐条摘要。不要合并章节，不要虚构正文没有的信息。',
    '每条 summaries 的 order 必须等于输入章节序号，title 使用输入章节标题。',
    '字段要求：summary 写剧情因果摘要；keyEvents 写关键事件；characters 写人物及状态；locations 写地点；timeline 写时间线变化；keyProps 写关键道具；foreshadowing 写伏笔；worldRules 写世界观规则；adaptationNotes 写后续改编注意点。',
    '字段类型要求：keyEvents、characters、locations、timeline、keyProps、foreshadowing、worldRules 必须是字符串数组；adaptationNotes 和 batchNotes 必须是字符串；不要返回对象数组。',
    '',
    chapterBlocks,
  ].join('\n')
}

function chapterAdaptationPrompt(
  name: string,
  chapters: AdaptationSourceChapter[],
  summaries: NovelChapterSummary[],
  storyBible: NovelStoryBible | null,
  input: GenerateNovelChapterAdaptationRequest,
): string {
  const summaryByChapterId = new Map(summaries.map((summary) => [summary.chapterId, summary]))
  const excerptLimit = Math.max(
    3_000,
    Math.floor(CHAPTER_ADAPTATION_TOTAL_PROMPT_CHAR_LIMIT / Math.max(1, chapters.length)),
  )
  const chapterBlocks = chapters
    .map((chapter) => {
      const summary = summaryByChapterId.get(chapter.id)
      return [
        `章节序号：${chapter.order}`,
        `章节标题：${chapter.title}`,
        `所属原章节：${chapter.sourceChapterTitle ?? '未识别'}`,
        `是否跨章节：${chapter.crossesChapterBoundary ? '是' : '否'}`,
        `章节摘要：${summary?.summary ?? '暂无摘要，请只依据原文摘录改编'}`,
        `关键人物：${summary ? compactFactList(summary.characters, 6) : '暂无'}`,
        `关键地点：${summary ? compactFactList(summary.locations, 5) : '暂无'}`,
        `关键道具：${summary ? compactFactList(summary.keyProps, 5) : '暂无'}`,
        `改编注意：${summary?.adaptationNotes || '保持原文事实，不提前补完未知剧情'}`,
        `原文摘录：\n${headExcerpt(chapter.content, excerptLimit)}`,
      ].join('\n')
    })
    .join('\n\n---\n\n')

  return [
    `作品名称：${name}`,
    `目标时长：约 ${input.targetSeconds} 秒`,
    `改编模式：${chapterAdaptationModeLabel(input.mode)}`,
    storyBible
      ? [
          `故事概要：${headExcerpt(storyBible.synopsis, 900)}`,
          `改编策略：${headExcerpt(storyBible.adaptationStrategy, 700)}`,
          `核心人物：${storyBible.characters
            .slice(0, 8)
            .map((character) => `${character.name}（${character.role}）：${character.description}`)
            .join('；')}`,
          `核心地点：${storyBible.locations
            .slice(0, 6)
            .map((location) => `${location.name}：${location.description}`)
            .join('；')}`,
        ].join('\n')
      : '故事概要：暂无，请只依据已选章节和章节摘要生成。',
    '',
    '请把所选章节改编成可直接写入“剧本页”的中文 AI 视频改编剧本。',
    '硬性要求：只改编所选章节，不剧透后续；不要输出 Markdown 标题或解释；不要输出 JSON；不要把原文逐字搬运成长段落。',
    '结构要求：生成 4-8 个场次，每个场次用一行或短段呈现，必须包含字段：场次、剧情、场景、角色、动作、对白、风格、构图、光影、运镜、衔接。',
    '资产友好：人物、场景、重要且多次出现的道具要写清名称，便于后续自动建议资产；一次性小物件不要强行资产化。',
    '视频友好：每个场次控制在 1-3 个核心动作，避免过多内心独白；对白短，画面可拍，适合继续生成资产建议和分镜。',
    '',
    chapterBlocks,
  ].join('\n')
}

function chapterAdaptationModeLabel(mode: GenerateNovelChapterAdaptationRequest['mode']): string {
  if (mode === 'opening') return '短视频开场钩子'
  if (mode === 'summary') return '章节概要式改编'
  return '镜头场次式改编'
}

function boundaryNotesPrompt(name: string, boundaries: NovelBoundary[]): string {
  const boundaryBlocks = boundaries
    .map((boundary) =>
      [
        `boundaryId：${boundary.id}`,
        `边界位置：${boundary.previousOrder} -> ${boundary.nextOrder}`,
        `问题类型：${boundary.issues.join('、')}`,
        `严重级别：${boundary.severity}`,
        `上一段尾部：${boundary.previousTail}`,
        `下一段开头：${boundary.nextHead}`,
      ].join('\n'),
    )
    .join('\n\n---\n\n')
  return [
    `作品名称：${name}`,
    '请为每个边界生成一条衔接说明，说明上一段和下一段如何连续阅读，以及后续摘要/改编时应注意什么。',
    '要求：不要改写原文，不要补写剧情；note 控制在 80-180 字，明确指出断裂点和衔接依据。',
    '',
    boundaryBlocks,
  ].join('\n')
}

function storyBiblePrompt(name: string, summaries: NovelChapterSummary[]): string {
  const summaryBlocks = summaries
    .map((summary) =>
      [
        `章节 ${summary.order}：${summary.title}`,
        `摘要：${headExcerpt(summary.summary, STORY_OVERVIEW_SUMMARY_CHAR_LIMIT)}`,
        `关键事件：${compactFactList(summary.keyEvents, 3)}`,
        `人物：${compactFactList(summary.characters, 4)}`,
        `地点：${compactFactList(summary.locations, 3)}`,
        `关键道具：${compactFactList(summary.keyProps, 3)}`,
        `伏笔：${compactFactList(summary.foreshadowing, 2)}`,
        `世界观规则：${compactFactList(summary.worldRules, 2)}`,
      ].join('\n'),
    )
    .join('\n\n')
  return [
    `作品名称：${name}`,
    `已完成章节摘要数量：${summaries.length}`,
    '请基于所有章节摘要生成全书故事概要。只使用摘要中出现的事实，缺失处写入 risks，不要自行补完。',
    '故事概要要服务 AI 视频改编：人物、地点、道具和世界观规则必须可供后续大纲、分集、资产和分镜复用。',
    '输出控制：synopsis 保持 500-900 字；characters、locations、keyProps、timeline、foreshadowing、worldRules 只保留最关键条目；不要展开成完整长文。',
    '字段类型必须符合约定：characters、locations、keyProps 是对象数组；timeline 是 {order,label,event} 数组；foreshadowing 是 {setup,payoff,status} 数组；themes、worldRules、risks 是字符串数组。',
    '语言要求：除 JSON 字段名外，所有面向用户的内容必须以中文为主；必要英文术语写成“中文（English）”；不要在 adaptationStrategy 等字段中输出 coreApproach、episodeStructure、visualLanguage、continuityPriority 这类裸英文标签。',
    '',
    summaryBlocks,
  ].join('\n')
}

function novelAssetSuggestionsPrompt(source: NovelAssetSuggestionSource, maxAssets: number): string {
  const storyBible = source.storyBible
  const summaryBlocks = source.summaries
    .slice(0, 40)
    .map((summary) =>
      [
        `章节 ${summary.order}：${summary.title}`,
        `摘要：${headExcerpt(summary.summary, 260)}`,
        `人物：${compactFactList(summary.characters, 5)}`,
        `地点：${compactFactList(summary.locations, 4)}`,
        `道具：${compactFactList(summary.keyProps, 4)}`,
        `世界观：${compactFactList(summary.worldRules, 2)}`,
        `改编注意：${headExcerpt(summary.adaptationNotes, 180) || '无'}`,
      ].join('\n'),
    )
    .join('\n\n')
  const storyOverview = storyBible
    ? [
        `故事概要标题：${storyBible.title}`,
        `故事概要：${headExcerpt(storyBible.synopsis, 900)}`,
        `核心人物：${storyBible.characters
          .slice(0, 12)
          .map(
            (character) =>
              `${character.name}：${character.role}；${character.description}；${character.visualNotes}`,
          )
          .join('；')}`,
        `核心地点：${storyBible.locations
          .slice(0, 10)
          .map((location) => `${location.name}：${location.description}；${location.visualNotes}`)
          .join('；')}`,
        `关键道具：${storyBible.keyProps
          .slice(0, 10)
          .map((prop) => `${prop.name}：${prop.description}；${prop.visualNotes}`)
          .join('；')}`,
        `世界观规则：${storyBible.worldRules.slice(0, 10).join('；')}`,
      ].join('\n')
    : '故事概要：暂未生成，请仅依据章节概要提取资产。'

  return [
    `作品名称：${source.document.name}`,
    `最多返回资产数：${maxAssets}`,
    storyOverview,
    '',
    '请基于小说事实源生成 AI 视频资产建议。只建议后续多次出现、需要保持一致、或者对世界观/剧情识别很重要的资产。',
    '人物建议必须把性别、年龄段、身份职业写进 description 和 prompt。比如“老船夫/祖父/摆渡老人”必须识别为男性、老年、船夫/摆渡人。',
    '场景建议要优先保留核心地点；道具只保留重要或多次出现的，不要把一次性小物件都资产化；服装只建议主角或高频人物的稳定造型。',
    '请只返回严格 JSON，不要 Markdown，不要代码块。返回对象必须包含 summary 和 assets。',
    'assets 每项必须完全符合现有资产建议结构：kind 为 character、scene、prop、costume 之一；必须包含 name、description、prompt、negativePrompt、reason、priority、attributes。',
    'character.attributes 必须包含 type、subjectType、gender、ageGroup、exactAge、species、anthropomorphic、visualStyle、framing、bodyType、background、faceStatus、bodyStatus、faceReference、bodyReference、portraitSource、trustedPortrait、legStretch、turnaround、turnaroundLayout。',
    'scene.attributes 必须包含 type、space、sceneType、era、time、weather、mood、camera、visualStyle、emptyScene、activitySpace。',
    'prop.attributes 必须包含 type、category、material、condition、view、background、visualStyle。',
    'costume.attributes 必须包含 type、audience、category、season、design、presentation、visualStyle、turnaround。',
    '',
    summaryBlocks,
  ].join('\n')
}

function fallbackNovelAssetSuggestions(
  source: NovelAssetSuggestionSource,
  maxAssets: number,
): { summary: string; assets: ScriptAssetSuggestion[] } {
  const characters = novelCharacterSeeds(source)
  const locations = novelEntitySeeds(
    source.storyBible?.locations,
    source.summaries.flatMap((summary) => summary.locations),
    4,
  )
  const props = novelEntitySeeds(
    source.storyBible?.keyProps,
    source.summaries.flatMap((summary) => summary.keyProps),
    5,
  )
  const costumes = characters.slice(0, 3)
  const assets: ScriptAssetSuggestion[] = [
    ...characters.map(novelCharacterSuggestion),
    ...locations.map(novelSceneSuggestion),
    ...props.map(novelPropSuggestion),
    ...costumes.map(novelCostumeSuggestion),
  ]

  return {
    summary: source.storyBible
      ? `已根据《${source.document.name}》的章节概要和故事概要提取核心人物、地点、道具与稳定服装建议。`
      : `已根据《${source.document.name}》现有章节概要提取基础资产建议；生成故事概要后建议会更稳定。`,
    assets: deduplicateNovelAssetSuggestions(assets).slice(0, maxAssets),
  }
}

type NovelCharacterSeed = {
  name: string
  role: string
  description: string
  visualNotes: string
}

type NovelEntitySeed = {
  name: string
  description: string
  visualNotes: string
}

function novelCharacterSeeds(source: NovelAssetSuggestionSource): NovelCharacterSeed[] {
  const storyCharacters = source.storyBible?.characters ?? []
  const seeds = storyCharacters.length
    ? storyCharacters.map((character) => ({
        name: character.name,
        role: character.role,
        description: [character.description, character.storyFunction, character.motivation]
          .filter(Boolean)
          .join('；'),
        visualNotes: character.visualNotes,
      }))
    : uniqueNovelFacts(source.summaries.flatMap((summary) => summary.characters))
        .slice(0, 5)
        .map((text) => ({
          name: entityNameFromText(text, '人物'),
          role: roleFromText(text),
          description: text,
          visualNotes: '',
        }))
  return seeds.filter((seed) => seed.name).slice(0, 5)
}

function novelEntitySeeds(
  storyEntities: Array<{
    name: string
    description: string
    storyFunction?: string
    visualNotes?: string
  }> = [],
  summaryFacts: string[],
  limit: number,
): NovelEntitySeed[] {
  const seeds = storyEntities.length
    ? storyEntities.map((entity) => ({
        name: entity.name,
        description: [entity.description, entity.storyFunction].filter(Boolean).join('；'),
        visualNotes: entity.visualNotes ?? '',
      }))
    : uniqueNovelFacts(summaryFacts).map((text) => ({
        name: entityNameFromText(text, '条目'),
        description: text,
        visualNotes: '',
      }))
  return seeds.filter((seed) => seed.name).slice(0, limit)
}

function novelCharacterSuggestion(seed: NovelCharacterSeed): ScriptAssetSuggestion {
  const text = `${seed.name} ${seed.role} ${seed.description} ${seed.visualNotes}`
  const gender = inferNovelCharacterGender(text)
  const ageGroup = inferNovelCharacterAge(text)
  const identityTags = novelCharacterIdentityTags(text)
  const profile = [
    gender === 'male' ? '男性' : gender === 'female' ? '女性' : '',
    ageLabel(ageGroup),
    ...identityTags,
  ].filter(Boolean)
  return {
    kind: 'character',
    name: seed.name,
    description: `${seed.name}，${profile.join('，') || seed.role}。${seed.description}`,
    prompt: `${seed.name}，${profile.join('，')}，${seed.visualNotes || seed.description}，中文 AI 视频人物设定，全身完整，面部清晰，造型稳定，符合小说事实源。`,
    negativePrompt: '',
    reason: '小说事实源中的核心人物，后续镜头需要保持身份、年龄、职业和外观一致。',
    priority: 5,
    attributes: {
      type: 'character',
      subjectType: 'human',
      gender,
      ageGroup,
      exactAge: null,
      species: '',
      anthropomorphic: false,
      visualStyle: 'cinematic-cg',
      framing: 'full',
      bodyType: ageGroup === 'senior' ? 'balanced' : 'balanced',
      background: 'solid',
      faceStatus: 'pending',
      bodyStatus: 'pending',
      faceReference: null,
      bodyReference: null,
      portraitSource: 'ai-virtual',
      trustedPortrait: null,
      legStretch: false,
      turnaround: false,
      turnaroundLayout: 'sheet',
    },
  }
}

function novelSceneSuggestion(seed: NovelEntitySeed): ScriptAssetSuggestion {
  const text = `${seed.name} ${seed.description} ${seed.visualNotes}`
  return {
    kind: 'scene',
    name: seed.name,
    description: `${seed.name}。${seed.description}`,
    prompt: `${seed.name}，${seed.description}，${seed.visualNotes}，空场景，空间层次清晰，预留人物表演和运镜空间，符合小说世界观，不出现人物。`,
    negativePrompt: '',
    reason: '小说事实源中的核心地点，适合先建立统一空间资产，保证后续分镜连续性。',
    priority: 4,
    attributes: {
      type: 'scene',
      space: inferNovelSceneSpace(text),
      sceneType: inferNovelSceneType(text),
      era: inferNovelEra(text),
      time: 'day',
      weather: inferNovelWeather(text),
      mood: inferNovelSceneMood(text),
      camera: 'wide',
      visualStyle: 'cinematic-cg',
      emptyScene: true,
      activitySpace: true,
    },
  }
}

function novelPropSuggestion(seed: NovelEntitySeed): ScriptAssetSuggestion {
  const text = `${seed.name} ${seed.description} ${seed.visualNotes}`
  return {
    kind: 'prop',
    name: seed.name,
    description: `${seed.name}。${seed.description}`,
    prompt: `${seed.name}，${seed.description}，${seed.visualNotes}，关键道具单品展示，材质细节清晰，形状稳定，纯色背景，适合多镜头复用。`,
    negativePrompt: '',
    reason: '小说事实源中的关键道具或高频物件，需要保持外观连续性。',
    priority: /渡船|白塔|信|胶片|铁盒|剑/u.test(text) ? 5 : 4,
    attributes: {
      type: 'prop',
      category: inferNovelPropCategory(text),
      material: inferNovelPropMaterial(text),
      condition: /旧|老|年久|破|损|残/u.test(text) ? 'aged' : 'used',
      view: 'front',
      background: 'solid',
      visualStyle: 'cinematic-cg',
    },
  }
}

function novelCostumeSuggestion(seed: NovelCharacterSeed): ScriptAssetSuggestion {
  const text = `${seed.name} ${seed.role} ${seed.description} ${seed.visualNotes}`
  const gender = inferNovelCharacterGender(text)
  const identityTags = novelCharacterIdentityTags(text)
  return {
    kind: 'costume',
    name: `${seed.name}常用服装`,
    description: `${seed.name}的稳定服装资产，体现${identityTags.join('、') || seed.role}身份。${seed.visualNotes || seed.description}`,
    prompt: `${seed.name}常用服装，${identityTags.join('，')}，平铺或模特展示，完整轮廓，材质和配色清晰，不出现人物脸部，用于保持角色造型一致。`,
    negativePrompt: '',
    reason: '主线人物需要稳定服装设定，避免跨镜头造型漂移。',
    priority: 3,
    attributes: {
      type: 'costume',
      audience: gender === 'male' ? 'male' : gender === 'female' ? 'female' : 'unisex',
      category: /船夫|摆渡|军|警|医生|药师|职业/u.test(text) ? 'professional' : 'daily',
      season: 'all-season',
      design: /湘西|茶峒|边城|古|中式|苗/u.test(text) ? 'chinese' : 'retro',
      presentation: 'flat',
      visualStyle: 'cinematic-cg',
      turnaround: false,
    },
  }
}

function inferNovelCharacterGender(text: string): 'male' | 'female' | 'unspecified' {
  if (/老船夫|船夫|祖父|爷爷|爷|爹|父亲|男人|男性|哥哥|弟弟|少爷|他\b/u.test(text)) return 'male'
  if (/翠翠|女性|少女|姑娘|女孩|母亲|娘|妻|小姐|她\b/u.test(text)) return 'female'
  return 'unspecified'
}

function inferNovelCharacterAge(text: string): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  if (/老|年迈|祖父|爷爷|爷|老人|老船夫|老年|晚年/u.test(text)) return 'senior'
  if (/儿童|孩子|小孩|幼/u.test(text)) return 'child'
  if (/少年|少女|十几/u.test(text)) return 'teen'
  if (/中年/u.test(text)) return 'middle'
  return 'young'
}

function novelCharacterIdentityTags(text: string): string[] {
  const tags: string[] = []
  if (/船夫|摆渡|渡船|渡口/u.test(text)) tags.push('船夫/摆渡人')
  if (/祖父|爷爷|爷/u.test(text)) tags.push('祖父')
  if (/外孙女|孙女/u.test(text)) tags.push('外孙女')
  if (/导演/u.test(text)) tags.push('导演')
  if (/药师|医生/u.test(text)) tags.push('医者')
  if (/剑客|武侠|门派/u.test(text)) tags.push('武侠人物')
  return [...new Set(tags)].slice(0, 4)
}

function ageLabel(ageGroup: 'child' | 'teen' | 'young' | 'middle' | 'senior'): string {
  return (
    {
      child: '儿童',
      teen: '少年/少女',
      young: '青年',
      middle: '中年',
      senior: '老年',
    } as const
  )[ageGroup]
}

function inferNovelSceneSpace(text: string): 'interior' | 'exterior' {
  return /屋|房|室内|客栈|药铺|车站|厅|店/u.test(text) ? 'interior' : 'exterior'
}

function inferNovelSceneType(
  text: string,
): 'city' | 'street' | 'residential' | 'commercial' | 'nature' | 'ancient' | 'industrial' | 'fantasy' {
  if (/河|溪|山|渡口|码头|白塔|茶峒|湘西/u.test(text)) return 'nature'
  if (/古|边城|寨|城门|江湖/u.test(text)) return 'ancient'
  if (/车站|街|路/u.test(text)) return 'street'
  if (/店|药铺|市集/u.test(text)) return 'commercial'
  if (/家|屋|房/u.test(text)) return 'residential'
  return 'city'
}

function inferNovelEra(text: string): 'ancient' | 'recent' | 'modern' | 'future' {
  if (/未来|赛博|机器/u.test(text)) return 'future'
  if (/民国|近代|湘西|茶峒|边城|渡船|码头|白塔/u.test(text)) return 'recent'
  if (/古代|江湖|门派|剑客/u.test(text)) return 'ancient'
  return 'modern'
}

function inferNovelWeather(text: string): 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' {
  if (/雪/u.test(text)) return 'snow'
  if (/雨|暴风/u.test(text)) return 'rain'
  if (/雾|烟雨/u.test(text)) return 'fog'
  if (/阴|云/u.test(text)) return 'cloudy'
  return 'clear'
}

function inferNovelSceneMood(text: string): 'warm' | 'tense' | 'mystery' | 'romantic' | 'epic' | 'desolate' {
  if (/等待|爱情|相遇|歌/u.test(text)) return 'romantic'
  if (/悬疑|匿名|秘密|胶片|线索/u.test(text)) return 'mystery'
  if (/死亡|失去|孤独|废弃/u.test(text)) return 'desolate'
  if (/冲突|危险|追查/u.test(text)) return 'tense'
  return 'warm'
}

function inferNovelPropCategory(
  text: string,
): 'weapon' | 'vehicle' | 'furniture' | 'electronics' | 'jewelry' | 'food' | 'daily' | 'other' {
  if (/剑|刀|枪|弓|武器/u.test(text)) return 'weapon'
  if (/船|车|马车/u.test(text)) return 'vehicle'
  if (/椅|桌|床|柜/u.test(text)) return 'furniture'
  if (/灯|电|机器|胶片|相机/u.test(text)) return 'electronics'
  if (/玉|戒|项链|首饰/u.test(text)) return 'jewelry'
  if (/酒|茶|饭|食/u.test(text)) return 'food'
  if (/信|纸|书|盒|伞|塔/u.test(text)) return 'daily'
  return 'other'
}

function inferNovelPropMaterial(
  text: string,
): 'wood' | 'metal' | 'glass' | 'fabric' | 'leather' | 'ceramic' | 'mixed' {
  if (/船|木|桌|椅|柜/u.test(text)) return 'wood'
  if (/剑|刀|铁|铜|金属|盒/u.test(text)) return 'metal'
  if (/玻璃|镜/u.test(text)) return 'glass'
  if (/布|衣|伞/u.test(text)) return 'fabric'
  if (/皮/u.test(text)) return 'leather'
  if (/瓷|碗|杯/u.test(text)) return 'ceramic'
  return 'mixed'
}

function deduplicateNovelAssetSuggestions(assets: ScriptAssetSuggestion[]): ScriptAssetSuggestion[] {
  const seen = new Set<string>()
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.name.trim().toLocaleLowerCase('zh-CN')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueNovelFacts(values: string[]): string[] {
  const seen = new Set<string>()
  const facts: string[] = []
  for (const value of values) {
    const text = cleanProviderText(value, 220)
    const name = entityNameFromText(text, '')
    const key = name.toLocaleLowerCase('zh-CN')
    if (!key || seen.has(key)) continue
    seen.add(key)
    facts.push(text)
  }
  return facts
}

function entityNameFromText(text: string, fallback: string): string {
  const name = cleanProviderText(text, 120)
    .replace(/^[\s\-·•、，。；:：]+/u, '')
    .split(/[：:，,。；;\n]/u)[0]!
    .replace(/^(人物|角色|地点|道具|关键道具)\s*/u, '')
    .trim()
  return name || fallback
}

function roleFromText(text: string): string {
  const parts = cleanProviderText(text, 160).split(/[：:，,。；;]/u)
  return parts[1]?.trim() || '角色'
}

function compactFactList(values: string[], maxItems: number): string {
  const text = values
    .slice(0, maxItems)
    .map((value) => headExcerpt(value, STORY_OVERVIEW_FACT_CHAR_LIMIT))
    .join('；')
  return text || '无'
}

function chapterSummaryMaxTokens(chapterCount: number): number {
  return Math.min(24_000, Math.max(3_000, chapterCount * 1_200))
}

function headExcerpt(value: string, limit: number): string {
  const text = value.trim()
  return text.length <= limit ? text : text.slice(0, limit)
}

function normalizeAdaptedScript(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function chapterAdaptationWarnings(
  summaries: NovelChapterSummary[],
  storyBible: NovelStoryBible | null,
  chapters: AdaptationSourceChapter[],
): string[] {
  const warnings: string[] = []
  const summaryChapterIds = new Set(summaries.map((summary) => summary.chapterId))
  const missingSummaryCount = chapters.filter((chapter) => !summaryChapterIds.has(chapter.id)).length
  if (missingSummaryCount > 0) {
    warnings.push(`有 ${missingSummaryCount} 个所选章节尚无摘要，已使用原文摘录直接改编`)
  }
  if (!storyBible) warnings.push('当前小说还没有故事概要，角色和世界观一致性需要后续复核')
  if (chapters.some((chapter) => chapter.crossesChapterBoundary)) {
    warnings.push('所选章节包含跨章节分块，建议写入剧本后人工检查首尾衔接')
  }
  return warnings
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '章节摘要生成失败'
}

function parseChapterSummariesProviderJson(raw: string) {
  const parsed = parseProviderJsonValue(raw, '章节摘要结果格式错误')
  try {
    return novelChapterSummariesContentSchema.parse(normalizeChapterSummariesProviderContent(parsed))
  } catch {
    throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '章节摘要结果格式错误')
  }
}

function parseBoundaryNotesProviderJson(raw: string) {
  const parsed = parseProviderJsonValue(raw, '边界衔接说明结果格式错误')
  try {
    return novelBoundaryNotesContentSchema.parse(normalizeBoundaryNotesProviderContent(parsed))
  } catch {
    throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '边界衔接说明结果格式错误')
  }
}

function parseStoryBibleProviderJson(raw: string) {
  const parsed = parseProviderJsonValue(raw, '故事概要结果格式错误')
  try {
    return novelStoryBibleContentSchema.parse(normalizeStoryBibleProviderContent(parsed))
  } catch {
    throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', '故事概要结果格式错误')
  }
}

function parseProviderJsonValue(raw: string, errorMessage: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0)
  const start = starts.length ? Math.min(...starts) : -1
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (start < 0 || end < start) throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
  }
}

function normalizeChapterSummariesProviderContent(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    summaries: Array.isArray(value.summaries)
      ? value.summaries.map((summary) => normalizeChapterSummaryProviderItem(summary))
      : value.summaries,
    batchNotes: normalizeProviderText(value.batchNotes, 700),
  }
}

function normalizeChapterSummaryProviderItem(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    title: normalizeProviderText(value.title, 120),
    summary: normalizeProviderText(value.summary, 1_200),
    keyEvents: normalizeProviderTextList(value.keyEvents, 8, 260),
    characters: normalizeProviderTextList(value.characters, 12, 160),
    locations: normalizeProviderTextList(value.locations, 12, 160),
    timeline: normalizeProviderTextList(value.timeline, 8, 220),
    keyProps: normalizeProviderTextList(value.keyProps, 10, 160),
    foreshadowing: normalizeProviderTextList(value.foreshadowing, 10, 220),
    worldRules: normalizeProviderTextList(value.worldRules, 10, 220),
    adaptationNotes: normalizeProviderText(value.adaptationNotes, 700),
  }
}

function normalizeBoundaryNotesProviderContent(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    notes: Array.isArray(value.notes)
      ? value.notes.map((note) => normalizeBoundaryNoteProviderItem(note))
      : value.notes,
    batchNotes: normalizeProviderText(value.batchNotes, 700),
  }
}

function normalizeBoundaryNoteProviderItem(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    boundaryId: normalizeProviderText(value.boundaryId ?? value.id, 128),
    note: normalizeProviderText(value.note ?? value.summary ?? value.description, 1_000),
  }
}

function normalizeStoryBibleProviderContent(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    title: normalizeProviderText(value.title, 120) || '未命名故事',
    logline: normalizeProviderText(value.logline, 240),
    premise: normalizeProviderText(value.premise, 700),
    synopsis: normalizeProviderText(value.synopsis, 2_000),
    themes: normalizeProviderTextList(value.themes, 8, 160),
    characters: normalizeStoryCharacterList(value.characters),
    locations: normalizeStoryEntityList(value.locations, 24),
    timeline: normalizeStoryTimelineList(value.timeline),
    keyProps: normalizeStoryEntityList(value.keyProps, 24),
    foreshadowing: normalizeStoryForeshadowingList(value.foreshadowing),
    worldRules: normalizeProviderTextList(value.worldRules, 30, 300),
    adaptationStrategy: normalizeStoryOverviewText(value.adaptationStrategy, 1_000),
    risks: normalizeProviderTextList(value.risks, 10, 300),
    nextStep: normalizeProviderText(value.nextStep, 500),
  }
}

function normalizeStoryCharacterList(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items.map((item) => normalizeStoryCharacter(item)).slice(0, 24)
}

function normalizeStoryCharacter(value: unknown): unknown {
  if (!isRecord(value)) {
    const text = normalizeProviderText(value, 600)
    return {
      name: text || '未命名人物',
      role: '角色',
      description: text || '人物信息待后续确认',
      storyFunction: text || '故事功能待后续确认',
      visualNotes: '',
      motivation: text || '动机待后续确认',
      arc: text || '角色弧光待后续确认',
    }
  }

  const name = normalizeProviderText(value.name ?? value.title ?? value.label, 120) || '未命名人物'
  const role = normalizeProviderText(value.role ?? value.identity ?? value.type, 120) || '角色'
  const description =
    normalizeProviderText(value.description, 600) ||
    normalizeProviderText(value.traits, 600) ||
    normalizeProviderText(value.relations ?? value.relationships, 600) ||
    role
  const storyFunction =
    normalizeProviderText(value.storyFunction ?? value.function ?? value.storyRole, 500) ||
    normalizeProviderText(value.relations ?? value.relationships, 500) ||
    description
  const motivation =
    normalizeProviderText(value.motivation ?? value.goal ?? value.desire, 500) ||
    normalizeProviderText(value.arc, 500) ||
    storyFunction
  const arc =
    normalizeProviderText(value.arc ?? value.development ?? value.change, 700) ||
    normalizeProviderText(value.timeline, 700) ||
    storyFunction

  return {
    name,
    role,
    description,
    storyFunction,
    visualNotes: normalizeProviderText(value.visualNotes ?? value.visualFeatures ?? value.look, 500),
    motivation,
    arc,
  }
}

function normalizeStoryEntityList(value: unknown, maxItems: number): unknown[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items.map((item) => normalizeStoryEntity(item)).slice(0, maxItems)
}

function normalizeStoryEntity(value: unknown): unknown {
  if (!isRecord(value)) {
    const text = normalizeProviderText(value, 600)
    return {
      name: text || '未命名条目',
      description: text || '信息待后续确认',
      storyFunction: text || '故事功能待后续确认',
      visualNotes: '',
    }
  }

  const name = normalizeProviderText(value.name ?? value.title ?? value.label, 120) || '未命名条目'
  const description =
    normalizeProviderText(value.description, 600) ||
    normalizeProviderText(value.features ?? value.traits ?? value.visualFeatures, 600) ||
    normalizeProviderText(value.type ?? value.category, 600) ||
    name
  const storyFunction =
    normalizeProviderText(value.storyFunction ?? value.function ?? value.use ?? value.significance, 500) ||
    description

  return {
    name,
    description,
    storyFunction,
    visualNotes: normalizeProviderText(value.visualNotes ?? value.visualFeatures ?? value.features, 500),
  }
}

function normalizeStoryTimelineList(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items.map((item, index) => normalizeStoryTimelineBeat(item, index)).slice(0, 40)
}

function normalizeStoryTimelineBeat(value: unknown, index: number): unknown {
  if (!isRecord(value)) {
    const text = normalizeProviderText(value, 500)
    return {
      order: index + 1,
      label: `节点 ${index + 1}`,
      event: text || '事件待后续确认',
    }
  }

  const parsedOrder = Number(value.order)
  const order = Number.isInteger(parsedOrder) && parsedOrder > 0 ? parsedOrder : index + 1
  return {
    order,
    label:
      normalizeProviderText(value.label ?? value.stage ?? value.time ?? value.title, 120) ||
      `节点 ${index + 1}`,
    event: normalizeProviderText(value.event ?? value.description ?? value.summary, 500) || '事件待后续确认',
  }
}

function normalizeStoryForeshadowingList(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items.map((item) => normalizeStoryForeshadowing(item)).slice(0, 30)
}

function normalizeStoryForeshadowing(value: unknown): unknown {
  if (!isRecord(value)) {
    const text = normalizeProviderText(value, 400)
    return {
      setup: text || '伏笔待后续确认',
      payoff: '回收方式待后续确认',
      status: 'open',
    }
  }

  return {
    setup:
      normalizeProviderText(value.setup ?? value.event ?? value.clue ?? value.description, 400) ||
      '伏笔待后续确认',
    payoff:
      normalizeProviderText(value.payoff ?? value.resolution ?? value.significance, 400) ||
      '回收方式待后续确认',
    status: normalizeForeshadowingStatus(value.status),
  }
}

function normalizeForeshadowingStatus(value: unknown): 'open' | 'paid-off' | 'ambiguous' {
  const status = normalizeProviderText(value, 80).toLowerCase()
  if (!status) return 'open'
  if (
    status.includes('paid') ||
    status.includes('closed') ||
    status.includes('已回收') ||
    status.includes('兑现')
  ) {
    return status.includes('partial') || status.includes('部分') ? 'ambiguous' : 'paid-off'
  }
  if (
    status.includes('ambiguous') ||
    status.includes('unclear') ||
    status.includes('partial') ||
    status.includes('部分') ||
    status.includes('不明') ||
    status.includes('未定')
  ) {
    return 'ambiguous'
  }
  return 'open'
}

function normalizeProviderTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items
    .map((item) => normalizeProviderText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

function normalizeProviderText(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return cleanProviderText(value, maxLength)
  if (typeof value === 'number' || typeof value === 'boolean')
    return cleanProviderText(String(value), maxLength)
  if (Array.isArray(value)) {
    return cleanProviderText(
      value
        .map((item) => normalizeProviderText(item, maxLength))
        .filter(Boolean)
        .join('、'),
      maxLength,
    )
  }
  if (!isRecord(value)) return ''

  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const entries = Object.entries(value)
    .filter(
      ([key, item]) =>
        key !== 'name' && item !== undefined && item !== null && normalizeProviderText(item, 80),
    )
    .slice(0, 6)
    .map(([key, item]) => `${providerFieldLabel(key)}：${normalizeProviderText(item, 120)}`)
  return cleanProviderText([name, ...entries].filter(Boolean).join('；'), maxLength)
}

function cleanProviderText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizeStoryOverviewText(value: unknown, maxLength: number): string {
  let text = normalizeProviderText(value, maxLength)
  const labels: Record<string, string> = {
    coreApproach: '核心改编方式',
    episodeStructure: '篇章结构',
    visualLanguage: '视觉语言',
    continuityPriority: '连续性重点',
    adaptationStrategy: '改编策略',
    characterArc: '人物弧光',
    assetPriority: '资产优先级',
    pacingPlan: '节奏规划',
    productionNotes: '制作注意',
    riskControl: '风险控制',
    nextStep: '下一步',
  }
  for (const [key, label] of Object.entries(labels)) {
    text = text.replace(new RegExp(`(^|[\\s,;，；。])${key}\\s*[:：]`, 'g'), `$1${label}：`)
  }
  return cleanProviderText(text.replace(/\s*;\s*/g, '；').replace(/\s*,\s*/g, '，'), maxLength)
}

function providerFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    role: '身份',
    traits: '特征',
    relationships: '关系',
    description: '描述',
    stage: '阶段',
    event: '事件',
    significance: '意义',
    sourceType: '来源',
    adaptationFocus: '改编重点',
    tone: '基调',
    cautions: '注意',
  }
  return labels[key] ?? key
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0
}

const NOVEL_CHAPTER_SUMMARY_SYSTEM_PROMPT =
  '你是长篇小说改编统筹和剧情资料整理员。请只返回严格 JSON，不要 Markdown，不要代码块。返回对象必须包含 summaries 和 batchNotes。summaries 每项必须包含 order、title、summary、keyEvents、characters、locations、timeline、keyProps、foreshadowing、worldRules、adaptationNotes。keyEvents、characters、locations、timeline、keyProps、foreshadowing、worldRules 必须是字符串数组，adaptationNotes 和 batchNotes 必须是字符串，不要返回对象数组。所有内容必须来自输入章节，不得虚构。'

const NOVEL_BOUNDARY_NOTE_SYSTEM_PROMPT =
  '你是长篇小说切分边界校对员。请只返回严格 JSON，不要 Markdown，不要代码块。返回对象必须包含 notes 和 batchNotes。notes 每项必须包含 boundaryId 和 note。你只根据输入的上一段尾部、下一段开头和问题类型，说明两段如何衔接；不要改写原文，不要补写剧情，不要虚构事实。'

const NOVEL_STORY_BIBLE_SYSTEM_PROMPT =
  '你是影视改编总编剧和故事概要编辑。请只返回严格 JSON，不要 Markdown，不要代码块。返回对象必须包含 title、logline、premise、synopsis、themes、characters、locations、timeline、keyProps、foreshadowing、worldRules、adaptationStrategy、risks、nextStep。必须基于章节摘要建立可供 AI 视频生产复用的事实源，不得引入摘要之外的事实。'

const NOVEL_ASSET_SUGGESTIONS_SYSTEM_PROMPT =
  '你是中文 AI 视频项目的资产制片和美术统筹。请只返回严格 JSON，不要 Markdown，不要代码块。你的任务是从小说章节概要、故事概要和世界观事实源中提取需要资产化的角色、场景、道具、服装建议。建议必须服务后续视频生成的一致性；不要建议一次性小物件；不要虚构小说事实源没有的信息。'

const NOVEL_CHAPTER_ADAPTATION_SYSTEM_PROMPT =
  '你是中文 AI 视频改编编剧。你的任务是把用户选择的小说章节改编成可直接进入资产建议和分镜的短视频剧本。只输出中文剧本正文，不要 JSON，不要 Markdown，不要代码块，不要解释。必须遵守原文事实，不剧透未选择章节，不补写未知设定。每个场次都要包含场次、剧情、场景、角色、动作、对白、风格、构图、光影、运镜、衔接字段。'
