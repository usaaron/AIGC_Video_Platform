import 'dotenv/config'
import type {
  NovelBoundaryDetectionResult,
  NovelChapterSummary,
  NovelImportResult,
  NovelSplitPreviewResult,
  NovelStoryBibleResult,
  NovelSummaryQueueBatchResult,
  NovelSummaryQueueCommitResult,
  NovelSummaryQueueResult,
} from '@seqora/contracts'
import type { FastifyInstance } from 'fastify'
import { readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import type { TextGenerationProvider, TextGenerationRequest } from '../core/generation/textProvider.js'

type RegressionMode = 'mock' | 'live'

type CliOptions = {
  mode: RegressionMode
  path: string
  chunks: number
  targetChars: number
  overlapChars: number
}

type QualityReport = {
  summaryCount: number
  averageSummaryChars: number
  averageKeyEvents: number
  averageCharacters: number
  averageLocations: number
  averageTimeline: number
  averageKeyProps: number
  averageForeshadowing: number
  averageWorldRules: number
  adaptationNoteCount: number
  uniqueCharacters: string[]
  uniqueLocations: string[]
  uniqueKeyProps: string[]
  score: number
  verdict: 'ready-for-partial-outline' | 'needs-review'
  notes: string[]
}

type RegressionReport = {
  mode: RegressionMode
  file: {
    path: string
    bytes: number
    rawCharacters: number
    effectiveCharacters: number
  }
  split: {
    mode: string
    targetChars: number
    overlapChars: number
    previewChapterCount: number
    importedChapterCount: number
    warnings: string[]
    firstChapterTitle: string
    publicDetailExposesContent: boolean
  }
  boundaries: {
    detected: number
    notesGenerated: number
  }
  summaries: {
    requestedChunks: number
    queueTotalItems: number
    queueRuns: number
    queueFinalStatus: string
    committed: number
    missing: number
  }
  storyOverview:
    | {
        generated: true
        title: string
        sourceSummaryCount: number
        chapterCount: number
      }
    | {
        generated: false
        reason: string
      }
  quality: QualityReport
}

const PROJECT_ID = 'project-midnight-film'
const HEADERS = {
  'x-demo-role': 'member',
  'x-demo-user-id': 'user-creator',
  'x-demo-tenant-id': 'tenant-seqora-demo',
}
const DEFAULT_BIANCHENG_PATH = 'E:\\Firefox下载\\边城.txt'
const DEFAULT_TARGET_CHARS = 3_000
const DEFAULT_OVERLAP_CHARS = 300
const DEFAULT_LIVE_CHUNKS = 4

async function runRegression(options: CliOptions): Promise<RegressionReport> {
  const file = await loadNovelFile(options.path)
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'demo',
    AUTH_SECRET: process.env.AUTH_SECRET || 'test-secret-with-at-least-32-characters',
    DATA_FILE: ':memory:',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: resolve('./data/novel-biancheng-regression'),
    MAX_UPLOAD_BYTES: '10485760',
  })
  if (options.mode === 'live' && !hasConfiguredLiveTextProvider(config.TEXT_MODEL, config)) {
    throw new Error(
      'Live provider mode requires REHDASU_API_KEY for GLM/Kimi models, TOKENADVENT_API_KEY for SEQORA models, or DEEPSEEK_API_KEY/STRINGX_API_KEY for DeepSeek models in apps/api/.env',
    )
  }

  const app = await buildApp({
    config,
    videoProvider: null,
    imageProvider: null,
    assetLibraryProvider: null,
    filmPreviewComposer: null,
    startWorker: false,
    ...(options.mode === 'mock' ? { textProvider: new MockBianchengTextProvider() } : {}),
  })

  try {
    return await runRegressionInApp(app, options, file)
  } finally {
    await app.close()
    await rm(config.UPLOAD_DIR, { recursive: true, force: true })
  }
}

async function runRegressionInApp(
  app: FastifyInstance,
  options: CliOptions,
  file: { path: string; bytes: number; content: string },
): Promise<RegressionReport> {
  const splitOptions = {
    mode: 'auto',
    targetChars: options.targetChars,
    overlapChars: options.overlapChars,
  }
  const preview = await injectJson<NovelSplitPreviewResult>(
    app,
    'POST',
    `/api/v1/projects/${PROJECT_ID}/novels/preview-split`,
    {
      name: '边城基准',
      content: file.content,
      splitOptions,
    },
  )
  const imported = await injectJson<NovelImportResult>(
    app,
    'POST',
    `/api/v1/projects/${PROJECT_ID}/novels/import`,
    {
      clientRequestId: `biancheng-regression-import-${options.mode}`,
      name: '边城基准',
      content: file.content,
      splitOptions,
    },
  )
  const documentId = imported.document.id
  const boundaries = await injectJson<NovelBoundaryDetectionResult>(
    app,
    'POST',
    `/api/v1/projects/${PROJECT_ID}/novels/${documentId}/boundaries/detect`,
    { maxBoundaries: 20 },
  )
  const boundaryNotesGenerated = boundaries.boundaries.length
    ? (
        await injectJson<{ generatedBoundaryIds: string[] }>(
          app,
          'POST',
          `/api/v1/projects/${PROJECT_ID}/novels/${documentId}/boundaries/notes/generate`,
          {
            clientRequestId: `biancheng-regression-boundaries-${options.mode}`,
            batchSize: Math.min(8, boundaries.boundaries.length),
          },
        )
      ).generatedBoundaryIds.length
    : 0

  const selectedChapters =
    options.mode === 'live' ? imported.chapters.slice(0, options.chunks) : imported.chapters
  const queueCreated = await injectJson<NovelSummaryQueueResult>(
    app,
    'POST',
    `/api/v1/projects/${PROJECT_ID}/novels/${documentId}/summary-queue`,
    {
      clientRequestId: `biancheng-regression-summary-queue-${options.mode}`,
      batchSize: options.mode === 'live' ? selectedChapters.length : 8,
      maxAttempts: 2,
      chapterIds: selectedChapters.map((chapter) => chapter.id),
    },
  )

  const createdQueue = queueCreated.queue
  if (!createdQueue) throw new Error('摘要队列创建失败：queue 为空')
  const queueId = createdQueue.id
  let queueState: NovelSummaryQueueResult | NovelSummaryQueueBatchResult = queueCreated
  let queueRuns = 0
  while ((queueState.queue?.pendingCount ?? 0) > 0 && queueRuns < 50) {
    queueState = await injectJson<NovelSummaryQueueBatchResult>(
      app,
      'POST',
      `/api/v1/projects/${PROJECT_ID}/novels/${documentId}/summary-queue/${queueId}/run-batch`,
      {
        clientRequestId: `biancheng-regression-run-${options.mode}-${queueRuns}`,
        batchSize: options.mode === 'live' ? selectedChapters.length : 8,
      },
    )
    queueRuns += 1
  }
  if ((queueState.queue?.pendingCount ?? 0) > 0) {
    throw new Error('摘要队列超过 50 轮仍未完成，请检查队列状态')
  }

  const committed = await injectJson<NovelSummaryQueueCommitResult>(
    app,
    'POST',
    `/api/v1/projects/${PROJECT_ID}/novels/${documentId}/summary-queue/${queueId}/commit-results`,
    {},
  )
  const detail = await injectJson<NovelImportResult>(
    app,
    'GET',
    `/api/v1/projects/${PROJECT_ID}/novels/${documentId}`,
  )
  const quality = evaluateSummaryQuality(committed.summaries)
  const storyOverview = await maybeGenerateStoryOverview(app, documentId, options.mode)

  return {
    mode: options.mode,
    file: {
      path: file.path,
      bytes: file.bytes,
      rawCharacters: file.content.length,
      effectiveCharacters: imported.document.characterCount,
    },
    split: {
      mode: preview.splitMode,
      targetChars: options.targetChars,
      overlapChars: options.overlapChars,
      previewChapterCount: preview.chapterCount,
      importedChapterCount: imported.document.chapterCount,
      warnings: preview.warnings,
      firstChapterTitle: imported.chapters[0]?.title ?? '',
      publicDetailExposesContent: JSON.stringify(detail).includes('"content"'),
    },
    boundaries: {
      detected: boundaries.boundaries.length,
      notesGenerated: boundaryNotesGenerated,
    },
    summaries: {
      requestedChunks: selectedChapters.length,
      queueTotalItems: createdQueue.totalItems,
      queueRuns,
      queueFinalStatus: queueState.queue?.status ?? 'unknown',
      committed: committed.summaries.length,
      missing: committed.missingSummaryCount,
    },
    storyOverview,
    quality,
  }
}

async function maybeGenerateStoryOverview(
  app: FastifyInstance,
  documentId: string,
  mode: RegressionMode,
): Promise<RegressionReport['storyOverview']> {
  if (mode === 'live') {
    return {
      generated: false,
      reason: '真实 Provider 小批量模式只检查前几个分块摘要质量，不生成全书故事概要。',
    }
  }
  const overview = await injectJson<NovelStoryBibleResult>(
    app,
    'POST',
    `/api/v1/projects/${PROJECT_ID}/novels/${documentId}/story-bible/generate`,
    {
      clientRequestId: `biancheng-regression-overview-${mode}`,
    },
  )
  return {
    generated: true,
    title: overview.storyBible.title,
    sourceSummaryCount: overview.storyBible.sourceSummaryCount,
    chapterCount: overview.storyBible.chapterCount,
  }
}

async function injectJson<T>(
  app: FastifyInstance,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const response =
    payload === undefined
      ? await app.inject({ method, url, headers: HEADERS })
      : await app.inject({ method, url, headers: HEADERS, payload })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${method} ${url} failed (${response.statusCode}): ${response.body}`)
  }
  return response.json() as T
}

async function loadNovelFile(path: string): Promise<{ path: string; bytes: number; content: string }> {
  const [metadata, buffer] = await Promise.all([stat(path), readFile(path)])
  return {
    path,
    bytes: metadata.size,
    content: decodeNovelText(buffer).replace(/^\uFEFF/u, ''),
  }
}

function decodeNovelText(buffer: Buffer): string {
  for (const encoding of ['utf-8', 'gb18030', 'gbk']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer)
    } catch {
      // Try the next common Chinese plain-text encoding.
    }
  }
  return buffer.toString('utf8')
}

function parseCliOptions(args: string[], environment: NodeJS.ProcessEnv): CliOptions {
  const mode: RegressionMode =
    args.includes('--live') || environment.NOVEL_REGRESSION_MODE === 'live' ? 'live' : 'mock'
  const path =
    valueAfter(args, '--path=') || environment.NOVEL_REGRESSION_BIANCHENG_PATH || DEFAULT_BIANCHENG_PATH
  const chunks = clampInteger(
    Number(valueAfter(args, '--chunks=') ?? environment.NOVEL_REGRESSION_LIVE_CHUNKS),
    2,
    4,
    DEFAULT_LIVE_CHUNKS,
  )
  const targetChars = clampInteger(
    Number(valueAfter(args, '--target=') ?? environment.NOVEL_REGRESSION_TARGET_CHARS),
    1_000,
    20_000,
    DEFAULT_TARGET_CHARS,
  )
  const overlapChars = clampInteger(
    Number(valueAfter(args, '--overlap=') ?? environment.NOVEL_REGRESSION_OVERLAP_CHARS),
    0,
    1_000,
    DEFAULT_OVERLAP_CHARS,
  )
  if (overlapChars >= targetChars) throw new Error('overlap 必须小于 target')
  return { mode, path, chunks, targetChars, overlapChars }
}

function hasConfiguredLiveTextProvider(
  model: string,
  config: { TOKENADVENT_API_KEY: string; DEEPSEEK_API_KEY: string; REHDASU_API_KEY: string },
): boolean {
  const normalizedModel = model.trim().toLowerCase()
  if (normalizedModel.startsWith('gpt-')) return Boolean(config.TOKENADVENT_API_KEY)
  if (normalizedModel.startsWith('deepseek')) return Boolean(config.DEEPSEEK_API_KEY)
  if (/^(glm-5\.2|glm-5\.2-fast|kimi-k3|kimi-k3-thinking)$/.test(normalizedModel)) {
    return Boolean(config.REHDASU_API_KEY)
  }
  return false
}

function valueAfter(args: string[], prefix: string): string | undefined {
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function evaluateSummaryQuality(summaries: NovelChapterSummary[]): QualityReport {
  const summaryCount = summaries.length
  const averages = {
    summaryChars: average(summaries.map((summary) => summary.summary.length)),
    keyEvents: average(summaries.map((summary) => summary.keyEvents.length)),
    characters: average(summaries.map((summary) => summary.characters.length)),
    locations: average(summaries.map((summary) => summary.locations.length)),
    timeline: average(summaries.map((summary) => summary.timeline.length)),
    keyProps: average(summaries.map((summary) => summary.keyProps.length)),
    foreshadowing: average(summaries.map((summary) => summary.foreshadowing.length)),
    worldRules: average(summaries.map((summary) => summary.worldRules.length)),
  }
  const adaptationNoteCount = summaries.filter((summary) => summary.adaptationNotes.trim()).length
  const uniqueCharacters = uniqueFacts(summaries.flatMap((summary) => summary.characters)).slice(0, 12)
  const uniqueLocations = uniqueFacts(summaries.flatMap((summary) => summary.locations)).slice(0, 12)
  const uniqueKeyProps = uniqueFacts(summaries.flatMap((summary) => summary.keyProps)).slice(0, 12)
  const notes: string[] = []
  let score = 0

  if (summaryCount >= 2) score += 10
  else notes.push('摘要条目少于 2 个，不能稳定支撑多方案大纲。')
  if (averages.summaryChars >= 80) score += 15
  else notes.push('单块剧情摘要偏短，应要求 Provider 写出因果链。')
  if (averages.keyEvents >= 2) score += 15
  else notes.push('关键事件不足，大纲生成会缺少可取舍的剧情节点。')
  if (averages.characters >= 1.5 || uniqueCharacters.length >= 2) score += 15
  else notes.push('人物事实不足，大纲方案难以区分主角、关系和弧光。')
  if (averages.locations >= 1 || uniqueLocations.length >= 1) score += 10
  else notes.push('地点事实不足，后续资产和分镜缺少空间锚点。')
  if (averages.timeline >= 1) score += 10
  else notes.push('时间线不足，长篇改编容易出现顺序混乱。')
  if (averages.keyProps + averages.foreshadowing + averages.worldRules >= 2) score += 15
  else notes.push('道具、伏笔或世界观规则不足，后续大纲会偏泛化。')
  if (adaptationNoteCount === summaryCount) score += 10
  else notes.push('部分摘要缺少改编注意点，需要补齐面向视频生产的建议。')

  return {
    summaryCount,
    averageSummaryChars: Math.round(averages.summaryChars),
    averageKeyEvents: round1(averages.keyEvents),
    averageCharacters: round1(averages.characters),
    averageLocations: round1(averages.locations),
    averageTimeline: round1(averages.timeline),
    averageKeyProps: round1(averages.keyProps),
    averageForeshadowing: round1(averages.foreshadowing),
    averageWorldRules: round1(averages.worldRules),
    adaptationNoteCount,
    uniqueCharacters,
    uniqueLocations,
    uniqueKeyProps,
    score,
    verdict: score >= 70 ? 'ready-for-partial-outline' : 'needs-review',
    notes,
  }
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function uniqueFacts(values: string[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const fact = value.replace(/\s+/g, ' ').trim()
    if (fact) seen.add(fact)
  }
  return [...seen]
}

function printReport(report: RegressionReport): void {
  writeLine('--- Biancheng Novel Regression Report ---')
  writeLine(JSON.stringify(report, null, 2))
  writeLine('')
  writeLine(`Summary quality score: ${report.quality.score}/100 (${report.quality.verdict})`)
  if (report.mode === 'live') {
    writeLine(
      report.quality.verdict === 'ready-for-partial-outline'
        ? 'Result: 前几个分块摘要足够支撑局部/第一篇章的大纲多方案生成。'
        : 'Result: 摘要质量还不足以稳定支撑大纲多方案生成，请先调整提示词或批次设置。',
    )
  }
}

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`)
}

class MockBianchengTextProvider implements TextGenerationProvider {
  async generate(request: TextGenerationRequest): Promise<string> {
    if (request.systemPrompt.includes('故事概要编辑')) return mockStoryOverviewJson()
    if (request.systemPrompt.includes('切分边界校对员')) return mockBoundaryNotesJson(request.userPrompt)
    return mockSummariesJson(request.userPrompt)
  }
}

function mockSummariesJson(prompt: string): string {
  const matches = [...prompt.matchAll(/章节序号：(\d+)\n章节标题：([^\n]+)/gu)]
  return JSON.stringify({
    summaries: matches.map((match) => {
      const order = Number(match[1])
      const title = match[2] ?? `分块 ${order}`
      return {
        order,
        title,
        summary: `《边城》基准片段 ${order} 围绕茶峒、水码头、渡船与人物关系推进，保留原作的乡土氛围、等待情绪和爱情悲剧线索。`,
        keyEvents: [`片段 ${order} 的茶峒生活与人物关系被整理`, '翠翠、祖父、天保、傩送相关线索进入事实库'],
        characters: ['翠翠：渡船老人外孙女，纯真并处在等待与选择中', '祖父：摆渡老人，守护翠翠与渡船生活'],
        locations: ['茶峒', '白河渡口', '河街'],
        timeline: [`片段 ${order} 延续茶峒日常与爱情线索`],
        keyProps: ['渡船', '白塔', '龙舟'],
        foreshadowing: ['等待与离别持续累积，指向结尾的不确定归来'],
        worldRules: ['茶峒社会依水而生，渡船、码头、节庆和乡约构成行动规则'],
        adaptationNotes: '适合提炼成慢节奏乡土爱情短剧，重点保持环境、人物关系和情绪克制。',
      }
    }),
    batchNotes: '边城基准摘要批次通过，未使用真实 Provider。',
  })
}

function mockBoundaryNotesJson(prompt: string): string {
  const ids = [...prompt.matchAll(/boundaryId：([^\n]+)/gu)].map((match) => match[1])
  return JSON.stringify({
    notes: ids.map((id) => ({
      boundaryId: id,
      note: '该边界只作为分块上下文衔接参考，摘要时保持同一叙事段落连续，不改写原文。',
    })),
    batchNotes: '边界说明基准批次通过。',
  })
}

function mockStoryOverviewJson(): string {
  return JSON.stringify({
    title: '边城故事概要',
    logline: '湘西茶峒渡口的少女翠翠在亲情、爱情和等待中经历纯净而惆怅的成长。',
    premise: '故事以茶峒水码头和渡船生活为背景，通过翠翠、祖父、天保和傩送的关系，呈现自然人情与命运错失。',
    synopsis:
      '茶峒依水而建，渡船老人和外孙女翠翠生活在白河边。当地节庆、河街与船运构成稳定的乡土世界，翠翠在祖父守护下成长。天保与傩送先后进入她的生命，爱情线索在含蓄表达、家庭期待和命运误会中推进。随着人物选择和外部事件变化，纯净的情感逐渐走向失落：天保离世，傩送离开，祖父也在风雨中去世。翠翠最终守着渡船和白塔继续等待，那个人也许永远不回来，也许明天回来。',
    themes: ['等待', '乡土人情', '命运错失', '纯净爱情'],
    characters: [
      {
        name: '翠翠',
        role: '主角',
        description: '渡船老人外孙女，纯真敏感。',
        storyFunction: '承担爱情等待和成长主线。',
        visualNotes: '湘西少女，清澈自然。',
        motivation: '守住亲情并理解自己的情感。',
        arc: '从被守护的少女走向独自等待。',
      },
      {
        name: '祖父',
        role: '守护者',
        description: '摆渡老人。',
        storyFunction: '连接翠翠、渡船和乡土秩序。',
        visualNotes: '苍老、朴素、亲和。',
        motivation: '让翠翠获得安稳幸福。',
        arc: '以守护开始，以风雨夜离世结束。',
      },
    ],
    locations: [
      {
        name: '茶峒',
        description: '湘西边城水码头。',
        storyFunction: '承载全书生活秩序和人物关系。',
        visualNotes: '青山绿水、河街、吊脚楼。',
      },
      {
        name: '白河渡口',
        description: '翠翠和祖父生活工作的地方。',
        storyFunction: '反复出现的核心场景。',
        visualNotes: '渡船、河水、岸边白塔。',
      },
    ],
    timeline: [
      { order: 1, label: '茶峒生活', event: '建立渡口、翠翠和祖父的日常。' },
      { order: 2, label: '爱情展开', event: '天保与傩送相关情感线索推进。' },
      { order: 3, label: '等待结尾', event: '翠翠守着渡船等待傩送归来。' },
    ],
    keyProps: [
      {
        name: '渡船',
        description: '连接两岸和人物关系的日常工具。',
        storyFunction: '承载翠翠与祖父的生活。',
        visualNotes: '木船、河面、绳索。',
      },
      {
        name: '白塔',
        description: '渡口边的重要地标。',
        storyFunction: '形成结尾等待的视觉锚点。',
        visualNotes: '河边白塔。',
      },
    ],
    foreshadowing: [{ setup: '反复出现的等待与渡船意象', payoff: '结尾翠翠继续等待', status: 'paid-off' }],
    worldRules: ['茶峒依水运和码头生活组织社会关系', '人物表达情感含蓄，行动常受乡约、人情和家庭期待影响'],
    adaptationStrategy:
      '优先做成乡土爱情短剧或文艺短片，以渡口、白塔、龙舟和河街为核心资产，避免过度戏剧化。',
    risks: ['摘要来自分块压缩，细节仍需人工校对', '改编时容易把原作含蓄气质处理得过度直白'],
    nextStep: '基于故事概要生成 3 套改编方向。',
  })
}

const options = parseCliOptions(process.argv.slice(2), process.env)
const regressionReport = await runRegression(options)
printReport(regressionReport)
