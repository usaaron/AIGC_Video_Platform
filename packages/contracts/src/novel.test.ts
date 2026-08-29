import { describe, expect, it } from 'vitest'
import {
  generateNovelChapterSummariesRequestSchema,
  generateNovelChapterAdaptationRequestSchema,
  generateNovelAssetSuggestionsRequestSchema,
  generateNovelStoryBibleRequestSchema,
  commitNovelSummaryQueueResultsRequestSchema,
  createNovelSummaryQueueRequestSchema,
  detectNovelBoundariesRequestSchema,
  generateNovelBoundaryNotesRequestSchema,
  importNovelRequestSchema,
  NOVEL_IMPORT_MAX_CONTENT_CHARS,
  NOVEL_IMPORT_MAX_FILE_BYTES,
  novelChapterSummariesResultSchema,
  novelBoundaryDetectionResultSchema,
  novelBoundaryNotesResultSchema,
  novelImportResultSchema,
  novelSplitPreviewResultSchema,
  novelSummaryQueueBatchResultSchema,
  novelSummaryQueueCommitResultSchema,
  novelSummaryQueueResultSchema,
  novelSplitOptionsSchema,
  novelChapterAdaptationResultSchema,
  novelAssetSuggestionsResultSchema,
  novelStoryBibleReadResultSchema,
  novelStoryBibleResultSchema,
} from './novel.js'

describe('novel contracts', () => {
  it('accepts txt novel imports with a safe default format', () => {
    expect(
      importNovelRequestSchema.parse({
        name: '雨夜旧站',
        content: '第一章 雨夜来信\n林夏收到一封没有署名的信。',
        splitOptions: {
          mode: 'fixed',
          targetChars: 3_000,
          overlapChars: 300,
        },
      }),
    ).toMatchObject({
      name: '雨夜旧站',
      format: 'txt',
      splitOptions: {
        mode: 'fixed',
        targetChars: 3_000,
        overlapChars: 300,
      },
    })
    expect(novelSplitOptionsSchema.parse({})).toEqual({
      mode: 'auto',
      targetChars: 6_000,
      overlapChars: 300,
    })
    expect(novelSplitOptionsSchema.safeParse({ targetChars: 1_000, overlapChars: 1_000 }).success).toBe(false)
  })

  it('rejects empty or oversized novel content', () => {
    expect(importNovelRequestSchema.safeParse({ name: '空稿', content: '   ' }).success).toBe(false)
    expect(NOVEL_IMPORT_MAX_FILE_BYTES).toBe(5_657_407)
    expect(
      importNovelRequestSchema.safeParse({
        name: '超长稿',
        content: '字'.repeat(NOVEL_IMPORT_MAX_CONTENT_CHARS + 1),
      }).success,
    ).toBe(false)
  })

  it('validates split chapter import results', () => {
    const now = new Date().toISOString()

    expect(
      novelImportResultSchema.safeParse({
        document: {
          id: 'novel-1',
          projectId: 'project-1',
          tenantId: 'tenant-1',
          name: '雨夜旧站',
          format: 'txt',
          characterCount: 42,
          chapterCount: 1,
          createdAt: now,
          updatedAt: now,
        },
        chapters: [
          {
            id: 'chapter-1',
            documentId: 'novel-1',
            projectId: 'project-1',
            tenantId: 'tenant-1',
            order: 1,
            title: '第一章 雨夜来信',
            startOffset: 0,
            endOffset: 42,
            sourceStartOffset: 0,
            sourceEndOffset: 42,
            sourceChapterTitle: '第一章 雨夜来信',
            splitMode: 'heading',
            overlapBeforeChars: 0,
            overlapAfterChars: 0,
            crossesChapterBoundary: false,
            characterCount: 42,
            preview: '林夏收到一封没有署名的信。',
            createdAt: now,
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('validates novel split preview results before import', () => {
    const now = new Date().toISOString()

    expect(
      novelSplitPreviewResultSchema.safeParse({
        previewId: 'preview-1',
        name: '雨夜旧站',
        format: 'txt',
        characterCount: 42,
        chapterCount: 1,
        splitMode: 'heading',
        splitOptions: {
          mode: 'auto',
          targetChars: 6_000,
          overlapChars: 300,
        },
        coveragePassed: true,
        warnings: [],
        previewedAt: now,
        chapters: [
          {
            id: 'preview-chapter-1',
            order: 1,
            title: '第一章 雨夜来信',
            startOffset: 0,
            endOffset: 42,
            sourceStartOffset: 0,
            sourceEndOffset: 42,
            sourceChapterTitle: '第一章 雨夜来信',
            splitMode: 'heading',
            overlapBeforeChars: 0,
            overlapAfterChars: 0,
            crossesChapterBoundary: false,
            characterCount: 42,
            preview: '林夏收到一封没有署名的信。',
            previewTruncated: false,
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('validates chapter summary and story bible workflow payloads', () => {
    const now = new Date().toISOString()
    const document = {
      id: 'novel-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      name: '雨夜旧站',
      format: 'txt' as const,
      characterCount: 240,
      chapterCount: 1,
      createdAt: now,
      updatedAt: now,
    }
    const summary = {
      id: 'summary-1',
      documentId: 'novel-1',
      chapterId: 'chapter-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      order: 1,
      title: '第一章 雨夜来信',
      summary: '林夏收到匿名来信，前往旧车站寻找父亲留下的胶片线索。',
      keyEvents: ['匿名来信出现', '林夏决定前往旧车站'],
      characters: ['林夏：年轻导演，寻找父亲留下的线索'],
      locations: ['旧车站'],
      timeline: ['雨夜，故事开端'],
      keyProps: ['匿名来信', '胶片线索'],
      foreshadowing: ['来信没有署名'],
      worldRules: ['胶片可能记录未来'],
      adaptationNotes: '适合作为悬疑开场。',
      createdAt: now,
      updatedAt: now,
    }

    expect(generateNovelChapterSummariesRequestSchema.parse({})).toMatchObject({
      batchSize: 4,
      force: false,
    })
    expect(generateNovelChapterSummariesRequestSchema.parse({ batchSize: 24 }).batchSize).toBe(24)
    expect(generateNovelChapterSummariesRequestSchema.safeParse({ batchSize: 25 }).success).toBe(false)
    expect(createNovelSummaryQueueRequestSchema.parse({})).toMatchObject({
      batchSize: 4,
      force: false,
      maxAttempts: 3,
    })
    expect(createNovelSummaryQueueRequestSchema.safeParse({ maxAttempts: 6 }).success).toBe(false)
    expect(commitNovelSummaryQueueResultsRequestSchema.parse({})).toEqual({ force: false })
    expect(detectNovelBoundariesRequestSchema.parse({})).toEqual({
      force: false,
      maxBoundaries: 300,
    })
    expect(generateNovelBoundaryNotesRequestSchema.parse({})).toMatchObject({
      batchSize: 8,
      force: false,
    })
    expect(
      novelChapterSummariesResultSchema.safeParse({
        document,
        summaries: [summary],
        completed: true,
        missingSummaryCount: 0,
      }).success,
    ).toBe(true)
    expect(
      novelSummaryQueueResultSchema.safeParse({
        document,
        queue: {
          id: 'queue-1',
          documentId: 'novel-1',
          projectId: 'project-1',
          tenantId: 'tenant-1',
          status: 'queued',
          batchSize: 4,
          force: false,
          totalItems: 1,
          pendingCount: 1,
          runningCount: 0,
          completedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        items: [
          {
            id: 'queue-item-1',
            queueId: 'queue-1',
            documentId: 'novel-1',
            chapterId: 'chapter-1',
            projectId: 'project-1',
            tenantId: 'tenant-1',
            order: 1,
            title: '第一章 雨夜来信',
            status: 'pending',
            attempts: 0,
            maxAttempts: 3,
            characterCount: 42,
            sourceStartOffset: 0,
            sourceEndOffset: 42,
            sourceChapterTitle: '第一章 雨夜来信',
            crossesChapterBoundary: false,
            summaryId: null,
            result: null,
            errorMessage: null,
            lockedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        summaryCount: 0,
        missingSummaryCount: 1,
      }).success,
    ).toBe(true)
    expect(
      novelSummaryQueueBatchResultSchema.safeParse({
        document,
        queue: {
          id: 'queue-1',
          documentId: 'novel-1',
          projectId: 'project-1',
          tenantId: 'tenant-1',
          status: 'completed',
          batchSize: 4,
          force: false,
          totalItems: 1,
          pendingCount: 0,
          runningCount: 0,
          completedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        items: [
          {
            id: 'queue-item-1',
            queueId: 'queue-1',
            documentId: 'novel-1',
            chapterId: 'chapter-1',
            projectId: 'project-1',
            tenantId: 'tenant-1',
            order: 1,
            title: '第一章 雨夜来信',
            status: 'completed',
            attempts: 1,
            maxAttempts: 3,
            characterCount: 42,
            sourceStartOffset: 0,
            sourceEndOffset: 42,
            sourceChapterTitle: '第一章 雨夜来信',
            crossesChapterBoundary: false,
            summaryId: null,
            result: {
              summary: '林夏收到一封没有署名的信，前往旧车站追查父亲留下的胶片线索。',
              keyEvents: ['收到匿名来信'],
              characters: ['林夏'],
              locations: ['旧车站'],
              timeline: ['雨夜开端'],
              keyProps: ['匿名来信'],
              foreshadowing: ['来信没有署名'],
              worldRules: [],
              adaptationNotes: '适合作为开场。',
            },
            errorMessage: null,
            lockedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        summaryCount: 0,
        missingSummaryCount: 1,
        processedItemIds: ['queue-item-1'],
        failedItemIds: [],
        warnings: [],
      }).success,
    ).toBe(true)
    expect(
      novelSummaryQueueCommitResultSchema.safeParse({
        document,
        queue: {
          id: 'queue-1',
          documentId: 'novel-1',
          projectId: 'project-1',
          tenantId: 'tenant-1',
          status: 'completed',
          batchSize: 4,
          force: false,
          totalItems: 1,
          pendingCount: 0,
          runningCount: 0,
          completedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        items: [
          {
            id: 'queue-item-1',
            queueId: 'queue-1',
            documentId: 'novel-1',
            chapterId: 'chapter-1',
            projectId: 'project-1',
            tenantId: 'tenant-1',
            order: 1,
            title: '第一章 雨夜来信',
            status: 'completed',
            attempts: 1,
            maxAttempts: 3,
            characterCount: 42,
            sourceStartOffset: 0,
            sourceEndOffset: 42,
            sourceChapterTitle: '第一章 雨夜来信',
            crossesChapterBoundary: false,
            summaryId: 'summary-1',
            result: {
              summary: '林夏收到一封没有署名的信，前往旧车站追查父亲留下的胶片线索。',
              keyEvents: ['收到匿名来信'],
              characters: ['林夏'],
              locations: ['旧车站'],
              timeline: ['雨夜开端'],
              keyProps: ['匿名来信'],
              foreshadowing: ['来信没有署名'],
              worldRules: [],
              adaptationNotes: '适合作为开场。',
            },
            errorMessage: null,
            lockedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        summaries: [summary],
        summaryCount: 1,
        missingSummaryCount: 0,
        committedItemIds: ['queue-item-1'],
        skippedItemIds: [],
        warnings: [],
      }).success,
    ).toBe(true)
    expect(
      novelBoundaryDetectionResultSchema.safeParse({
        document,
        detectedAt: now,
        warnings: [],
        boundaries: [
          {
            id: 'boundary-1',
            documentId: 'novel-1',
            projectId: 'project-1',
            tenantId: 'tenant-1',
            previousChapterId: 'chapter-1',
            nextChapterId: 'chapter-2',
            previousOrder: 1,
            nextOrder: 2,
            status: 'pending',
            severity: 'medium',
            issues: ['sentence-fragment'],
            previousTail: '她推开门，看见',
            nextHead: '窗外站着一个陌生人。',
            note: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      novelBoundaryNotesResultSchema.safeParse({
        document,
        generatedBoundaryIds: ['boundary-1'],
        missingNoteCount: 0,
        generatedAt: now,
        warnings: [],
        boundaries: [
          {
            id: 'boundary-1',
            documentId: 'novel-1',
            projectId: 'project-1',
            tenantId: 'tenant-1',
            previousChapterId: 'chapter-1',
            nextChapterId: 'chapter-2',
            previousOrder: 1,
            nextOrder: 2,
            status: 'resolved',
            severity: 'medium',
            issues: ['sentence-fragment'],
            previousTail: '她推开门，看见',
            nextHead: '窗外站着一个陌生人。',
            note: '上一块停在“看见”，下一块补足看见对象，改编时应保持同一句动作连续。',
            createdAt: now,
            updatedAt: now,
          },
        ],
      }).success,
    ).toBe(true)
    expect(generateNovelStoryBibleRequestSchema.parse({})).toEqual({
      force: false,
      model: 'deepseek-v4-flash',
    })
    expect(generateNovelAssetSuggestionsRequestSchema.parse({})).toEqual({
      maxAssets: 12,
      model: 'deepseek-v4-flash',
    })
    expect(
      novelAssetSuggestionsResultSchema.safeParse({
        summary: '已从小说事实源提取核心人物和场景建议。',
        generatedAt: now,
        warnings: [],
        assets: [
          {
            kind: 'character',
            name: '老船夫',
            description: '老船夫，男性，老年，船夫/摆渡人，翠翠的祖父。',
            prompt: '老船夫，男性，老年，船夫/摆渡人，全身完整，面部清晰。',
            negativePrompt: '',
            reason: '核心人物，需要保持身份、年龄和职业一致。',
            priority: 5,
            attributes: {
              type: 'character',
              subjectType: 'human',
              gender: 'male',
              ageGroup: 'senior',
              exactAge: null,
              species: '',
              anthropomorphic: false,
              visualStyle: 'cinematic-cg',
              framing: 'full',
              bodyType: 'balanced',
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
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      generateNovelChapterAdaptationRequestSchema.parse({
        chapterIds: ['chapter-1'],
      }),
    ).toMatchObject({
      chapterIds: ['chapter-1'],
      targetSeconds: 60,
      mode: 'scene',
    })
    expect(
      generateNovelChapterAdaptationRequestSchema.safeParse({
        chapterIds: ['1', '2', '3', '4', '5', '6', '7'],
      }).success,
    ).toBe(false)
    expect(
      novelStoryBibleReadResultSchema.safeParse({
        storyBible: null,
        summaryCount: 1,
        chapterCount: 1,
        missingSummaryCount: 0,
      }).success,
    ).toBe(true)
    expect(
      novelStoryBibleResultSchema.safeParse({
        storyBible: storyBible(now),
        missingSummaryCount: 0,
        generatedAt: now,
        warnings: [],
      }).success,
    ).toBe(true)
    expect(
      novelChapterAdaptationResultSchema.safeParse({
        document,
        chapters: [
          {
            id: 'chapter-1',
            documentId: 'novel-1',
            projectId: 'project-1',
            tenantId: 'tenant-1',
            order: 1,
            title: '第一章 雨夜来信',
            startOffset: 0,
            endOffset: 42,
            sourceStartOffset: 0,
            sourceEndOffset: 42,
            sourceChapterTitle: '第一章 雨夜来信',
            splitMode: 'heading',
            overlapBeforeChars: 0,
            overlapAfterChars: 0,
            crossesChapterBoundary: false,
            characterCount: 42,
            preview: '林夏收到一封没有署名的信。',
            previewTruncated: false,
            createdAt: now,
          },
        ],
        script:
          '场次：1｜剧情：翠翠在渡口等待归人，河风带出人物处境。｜场景：茶峒渡口｜角色：翠翠、祖父｜动作：翠翠抬头望向对岸。｜对白：翠翠：爷爷，他还会来吗？｜风格：写实抒情｜构图：远景转中景｜光影：自然柔光｜运镜：缓慢推进｜衔接：水声转场',
        targetSeconds: 60,
        mode: 'scene',
        generatedAt: now,
        warnings: [],
      }).success,
    ).toBe(true)
  })
})

function storyBible(now: string) {
  return {
    id: 'bible-1',
    documentId: 'novel-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    title: '雨夜旧站',
    logline: '年轻导演在雨夜旧站追查父亲胶片，发现影像能预示未来。',
    premise: '一封匿名来信把林夏带回废弃车站，迫使她面对父亲失踪和未来影像的秘密。',
    synopsis:
      '林夏收到没有署名的来信，前往废弃旧车站寻找父亲留下的胶片。她在站台发现铁盒和旧胶片，意识到这些影像记录的不只是过去，而可能是尚未发生的明天。随着线索推进，她必须判断来信背后的真实意图，并决定是否继续打开父亲留下的秘密，同时面对父亲失踪多年后重新浮现的危险。',
    themes: ['记忆与未来', '亲情悬疑'],
    characters: [
      {
        name: '林夏',
        role: '主角',
        description: '年轻导演，寻找父亲留下的胶片线索。',
        storyFunction: '承担调查主线并推动真相揭开。',
        visualNotes: '雨夜风衣、克制表情。',
        motivation: '弄清父亲失踪真相。',
        arc: '从被动赴约到主动追查未来影像的秘密。',
      },
    ],
    locations: [
      {
        name: '旧车站',
        description: '废弃多年、雨夜空旷的核心悬疑场景。',
        storyFunction: '承载匿名来信、铁盒和胶片发现。',
        visualNotes: '冷色灯光、潮湿站台。',
      },
    ],
    timeline: [{ order: 1, label: '雨夜来信', event: '林夏收到匿名来信并前往旧车站。' }],
    keyProps: [
      {
        name: '旧胶片',
        description: '父亲留下的关键线索。',
        storyFunction: '揭示影像预示未来的核心设定。',
        visualNotes: '老式胶片卷。',
      },
    ],
    foreshadowing: [{ setup: '匿名来信没有署名', payoff: '寄信人与父亲秘密相关', status: 'open' }],
    worldRules: ['旧胶片可能记录未来影像，但触发方式未知。'],
    adaptationStrategy: '先强化雨夜旧站的悬疑开场，再围绕胶片规则拆分短视频钩子。',
    risks: ['原著后续规则不足时不能提前补完。'],
    nextStep: '生成 3 个改编方向。',
    sourceSummaryCount: 1,
    chapterCount: 1,
    createdAt: now,
    updatedAt: now,
  }
}
