import { extractScreenText } from '@seqora/prompting'
import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { VideoGenerationProvider, VideoProviderName } from '../generation/videoProvider.js'
import type { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { observabilityMetrics, observeProviderCall } from '../observability/metrics.js'
import { traceIdFromGenerationTask } from '../observability/trace.js'
import { usageCollector } from '../observability/usage.js'
import {
  claimGenerationTaskLease,
  generationTaskLeaseMatches,
  releaseGenerationTaskLease,
  renewGenerationTaskLease,
} from '../jobs/taskLease.js'

type PreviewTarget = { width: number; height: number }
type ComposeRunner = (
  inputPaths: string[],
  outputPath: string,
  target: PreviewTarget,
  ffmpegPath: string,
  timeoutMs: number,
  overlayTexts?: string[],
) => Promise<void>

type FilmPreviewComposerOptions = {
  composeRunner?: ComposeRunner
  leaseTtlMs?: number
  ioTimeoutMs?: number
  stateChangeTimeoutMs?: number
  onStateChange?: () => Promise<void>
}

export type FfmpegInputMedia = {
  duration: number
  hasAudio: boolean
}

export interface FilmPreviewDispatcher {
  recoverInterrupted(): Promise<void>
  start(task: GenerationTask): Promise<GenerationTask>
}

export class FilmPreviewComposer implements FilmPreviewDispatcher {
  private readonly leaseOwnerId = `film-preview-composer-${process.pid}-${randomUUID()}`
  private readonly leaseTtlMs: number
  private readonly ioTimeoutMs: number
  private readonly stateChangeTimeoutMs: number
  private readonly composeRunner: ComposeRunner
  private readonly onStateChange: () => Promise<void>

  constructor(
    private readonly store: AppStore,
    private readonly videoProvider: VideoGenerationProvider,
    private readonly objectStorage: ObjectStorage,
    private readonly ffmpegPath: string,
    private readonly timeoutMs: number,
    private readonly videoProviderName: VideoProviderName = 'stringx-seedance',
    options: FilmPreviewComposerOptions = {},
  ) {
    this.ioTimeoutMs = options.ioTimeoutMs ?? Math.max(30_000, Math.min(timeoutMs, 120_000))
    this.leaseTtlMs = options.leaseTtlMs ?? Math.max(120_000, this.ioTimeoutMs + 30_000)
    this.stateChangeTimeoutMs = options.stateChangeTimeoutMs ?? Math.min(this.ioTimeoutMs, 30_000)
    this.composeRunner = options.composeRunner ?? runFfmpegComposition
    this.onStateChange = options.onStateChange ?? (async () => {})
  }

  async recoverInterrupted(): Promise<void> {
    const recovered = await this.store.mutate((state) => {
      const now = new Date().toISOString()
      const tasks: GenerationTask[] = []
      for (const task of state.tasks) {
        if (task.provider !== 'local-compose' || task.status !== 'running') continue
        const expiresAt = task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : Number.NaN
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) continue
        task.status = 'failed'
        task.progress = 100
        task.error = '完整预览合成被服务重启中断，请重新合成'
        task.metadata = {
          ...task.metadata,
          providerState: 'failed',
          compositionStage: 'failed',
          compositionRecoveredAt: now,
        }
        releaseGenerationTaskLease(task)
        task.updatedAt = now
        tasks.push(task)
      }
      return tasks
    })
    for (const task of recovered) recordPreviewTaskUsage(task)
    if (recovered.length) await this.notifyStateChange()
  }

  async start(task: GenerationTask): Promise<GenerationTask> {
    const started = await this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored || stored.status !== 'queued') return stored ?? task
      const now = new Date()
      claimGenerationTaskLease(stored, this.leaseOwnerId, this.leaseTtlMs, now)
      const nowIso = now.toISOString()
      stored.status = 'running'
      stored.progress = 1
      stored.error = null
      stored.metadata = {
        ...stored.metadata,
        providerState: 'composing',
        compositionStage: 'preparing',
        compositionStartedAt: nowIso,
      }
      stored.updatedAt = nowIso
      return stored
    })
    await this.notifyStateChange()
    if (
      started.id === task.id &&
      started.status === 'running' &&
      started.leaseOwnerId === this.leaseOwnerId
    ) {
      usageCollector.startJob({
        jobId: started.id,
        source: 'generation_task',
        kind: started.kind,
        tenantId: started.tenantId,
        organizationId: started.tenantId,
        userId: started.userId,
        traceId: traceIdFromGenerationTask(started),
      })
    }
    void this.compose(task.id, typeof started.leaseToken === 'string' ? started.leaseToken : '')
    return started
  }

  private async compose(taskId: string, leaseToken: string): Promise<void> {
    const startedAt = Date.now()
    let temporaryDirectory: string | null = null
    let stopLeaseHeartbeat: (() => void) | null = null
    let usageTask: GenerationTask | null = null
    try {
      const task = this.store.read((state) => state.tasks.find((item) => item.id === taskId) ?? null)
      usageTask = task
      if (!task) throw new Error('完整预览任务不存在')
      if (task.status !== 'running' || !generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken))
        return
      const sourceTaskIds = stringArray(task.metadata.sourceVideoTaskIds)
      if (!sourceTaskIds.length) throw new Error('没有可用于合成的镜头视频')
      const sourceTasks = this.store.read((state) =>
        sourceTaskIds.map((sourceTaskId) => {
          const source = state.tasks.find(
            (item) =>
              item.id === sourceTaskId &&
              item.projectId === task.projectId &&
              item.tenantId === task.tenantId &&
              item.kind === 'video' &&
              item.provider === 'seedance' &&
              item.status === 'completed',
          )
          if (!source || typeof source.metadata.providerTaskId !== 'string') {
            throw new Error(`镜头视频 ${sourceTaskId} 不可用于合成`)
          }
          if (
            typeof source.metadata.providerName === 'string' &&
            source.metadata.providerName !== this.videoProviderName
          ) {
            throw new Error(`镜头视频 ${sourceTaskId} 属于其他视频 Provider，请切回对应配置后合成`)
          }
          return source
        }),
      )
      stopLeaseHeartbeat = this.startLeaseHeartbeat(taskId, leaseToken)

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'seqora-film-'))
      let downloadedCount = 0
      const downloadedPaths = await mapWithConcurrency(sourceTasks, 4, async (source, index) => {
        const current = this.store.read((state) => state.tasks.find((item) => item.id === taskId) ?? null)
        if (
          !current ||
          current.status !== 'running' ||
          !generationTaskLeaseMatches(current, this.leaseOwnerId, leaseToken)
        ) {
          return null
        }
        const inputPath = join(temporaryDirectory!, `shot-${String(index + 1).padStart(3, '0')}.mp4`)
        await this.updateProgress(taskId, current.progress, leaseToken, {
          compositionStage: 'downloading',
          compositionSourceIndex: index + 1,
          compositionSourceTaskId: source.id,
          compositionSourceCount: sourceTasks.length,
        })
        const cachedOutput = cachedVideoOutput(source)
        if (cachedOutput) {
          const cachedContent = await withTimeout(
            this.objectStorage.get(cachedOutput.storageKey),
            this.ioTimeoutMs,
            `读取第 ${index + 1} 个镜头缓存超时`,
          )
          await writeFile(inputPath, cachedContent)
        } else {
          const content = await observeProviderCall(
            {
              provider: this.videoProviderName,
              operation: 'video.getContent',
              tenantId: task.tenantId,
              organizationId: task.tenantId,
              userId: task.userId,
              taskId,
              traceId: traceIdFromGenerationTask(task),
            },
            () =>
              withTimeout(
                this.videoProvider.getContent(String(source.metadata.providerTaskId)),
                this.ioTimeoutMs,
                `读取第 ${index + 1} 个镜头视频超时`,
              ),
          )
          const destination = createWriteStream(inputPath)
          try {
            await withTimeout(
              pipeline(content.stream, destination),
              this.ioTimeoutMs,
              `写入第 ${index + 1} 个镜头视频超时`,
              () => {
                content.stream.destroy()
                destination.destroy()
              },
            )
          } catch (error) {
            content.stream.destroy()
            destination.destroy()
            throw error
          }
        }
        downloadedCount += 1
        await this.updateProgress(
          taskId,
          5 + Math.round((downloadedCount / sourceTasks.length) * 40),
          leaseToken,
          { compositionStage: 'downloaded' },
        )
        return inputPath
      })
      if (downloadedPaths.some((inputPath) => inputPath === null)) return
      const inputPaths = downloadedPaths.filter((inputPath): inputPath is string => Boolean(inputPath))

      const outputPath = join(temporaryDirectory, 'film-preview.mp4')
      const overlayTexts = sourceTasks.map((source) =>
        extractScreenText(
          typeof source.metadata.sourcePromptSnapshot === 'string'
            ? source.metadata.sourcePromptSnapshot
            : source.prompt,
        ),
      )
      await this.updateProgress(taskId, 50, leaseToken, {
        compositionStage: 'composing',
        compositionSourceIndex: null,
        compositionSourceTaskId: null,
      })
      await this.composeRunner(
        inputPaths,
        outputPath,
        previewTarget(String(task.metadata.aspectRatio || '16:9')),
        this.ffmpegPath,
        this.timeoutMs,
        overlayTexts,
      )
      await this.updateProgress(taskId, 92, leaseToken, {
        compositionStage: 'uploading',
        compositionSourceIndex: null,
        compositionSourceTaskId: null,
      })

      const output = await readFile(outputPath)
      const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-film-preview.mp4`
      await withTimeout(
        this.objectStorage.put(storageKey, output, 'video/mp4'),
        this.ioTimeoutMs,
        '上传完整预览视频超时',
      )
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === taskId)
        if (!stored || stored.status !== 'running') return
        if (!generationTaskLeaseMatches(stored, this.leaseOwnerId, leaseToken)) return
        const now = new Date().toISOString()
        const url = `/api/v1/generation/tasks/${stored.id}/content`
        stored.status = 'completed'
        stored.progress = 100
        stored.error = null
        stored.resultUrl = url
        stored.outputs = [{ id: `${stored.id}-film`, url, mediaType: 'video', view: 'single' }]
        stored.metadata = {
          ...stored.metadata,
          providerState: 'completed',
          compositionStage: 'completed',
          previewStorageKey: storageKey,
          previewContentType: 'video/mp4',
          previewSize: output.length,
          compositionCompletedAt: now,
        }
        stored.updatedAt = now
        releaseGenerationTaskLease(stored)
      })
      await this.notifyStateChange()
    } catch (error) {
      const message = error instanceof Error ? error.message : '完整预览合成失败'
      await this.store.mutate((state) => {
        const task = state.tasks.find((item) => item.id === taskId)
        if (!task) return
        if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
        task.status = 'failed'
        task.progress = 100
        task.error = message.slice(0, 1_000)
        task.metadata = {
          ...task.metadata,
          providerState: 'failed',
          compositionStage: 'failed',
          compositionFailedAt: new Date().toISOString(),
        }
        releaseGenerationTaskLease(task)
        task.updatedAt = new Date().toISOString()
      })
      await this.notifyStateChange()
    } finally {
      stopLeaseHeartbeat?.()
      const finalTask = this.store.read((state) => state.tasks.find((item) => item.id === taskId) ?? null)
      if (finalTask?.status === 'completed' || finalTask?.status === 'failed') {
        const durationMs = Date.now() - startedAt
        const ok = finalTask.status === 'completed'
        const error = finalTask.error ? new Error(finalTask.error) : undefined
        observabilityMetrics.recordFilmPreview({
          tenantId: finalTask.tenantId,
          taskId: finalTask.id,
          durationMs,
          ok,
          error,
        })
        observabilityMetrics.recordTaskTerminal({
          kind: `${finalTask.kind}:${finalTask.provider}`,
          tenantId: finalTask.tenantId,
          taskId: finalTask.id,
          status: finalTask.status,
        })
        observabilityMetrics.recordTaskExecution({
          kind: `${finalTask.kind}:${finalTask.provider}`,
          tenantId: finalTask.tenantId,
          taskId: finalTask.id,
          durationMs,
          ok,
          error,
        })
        recordPreviewTaskUsage(finalTask)
      }
      const usageFinalTask = finalTask ?? usageTask
      if (usageFinalTask) {
        usageCollector.finishJob({
          jobId: usageFinalTask.id,
          source: 'generation_task',
          kind: usageFinalTask.kind,
          status: terminalUsageStatus(usageFinalTask.status),
          recordUsage: false,
          tenantId: usageFinalTask.tenantId,
          organizationId: usageFinalTask.tenantId,
          userId: usageFinalTask.userId,
          traceId: traceIdFromGenerationTask(usageFinalTask),
        })
      }
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  private async updateProgress(
    taskId: string,
    progress: number,
    leaseToken: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const updated = await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return false
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return false
      task.progress = Math.min(99, Math.max(task.progress, progress))
      task.metadata = { ...task.metadata, ...metadata }
      renewGenerationTaskLease(task, this.leaseOwnerId, leaseToken, this.leaseTtlMs)
      task.updatedAt = new Date().toISOString()
      return true
    })
    if (updated) await this.notifyStateChange()
  }

  private startLeaseHeartbeat(taskId: string, leaseToken: string): () => void {
    const interval = setInterval(
      () => void this.renewLease(taskId, leaseToken),
      Math.max(1_000, Math.floor(this.leaseTtlMs / 3)),
    )
    interval.unref?.()
    return () => clearInterval(interval)
  }

  private async renewLease(taskId: string, leaseToken: string): Promise<void> {
    const renewed = await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return false
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return false
      renewGenerationTaskLease(task, this.leaseOwnerId, leaseToken, this.leaseTtlMs)
      task.updatedAt = new Date().toISOString()
      return true
    })
    if (renewed) await this.notifyStateChange()
  }

  private async notifyStateChange(): Promise<void> {
    await withTimeout(this.onStateChange(), this.stateChangeTimeoutMs, '合成任务状态同步超时').catch(() => {})
  }
}

function recordPreviewTaskUsage(task: GenerationTask): void {
  if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') return
  usageCollector.recordJobTerminal({
    jobId: task.id,
    source: 'generation_task',
    kind: task.kind,
    status: task.status,
    creditsUsed: task.status === 'completed' ? task.estimatedCredits : 0,
    tenantId: task.tenantId,
    organizationId: task.tenantId,
    userId: task.userId,
    traceId: traceIdFromGenerationTask(task),
  })
}

function terminalUsageStatus(
  status: GenerationTask['status'],
): 'completed' | 'failed' | 'cancelled' | 'unknown' {
  return status === 'completed' || status === 'failed' || status === 'cancelled' ? status : 'unknown'
}

function cachedVideoOutput(task: GenerationTask): { storageKey: string } | null {
  if (!Array.isArray(task.metadata.generatedOutputs)) return null
  const output = task.metadata.generatedOutputs.find(
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      (value as { view?: unknown }).view === 'single' &&
      typeof (value as { storageKey?: unknown }).storageKey === 'string',
  )
  return output ? { storageKey: (output as { storageKey: string }).storageKey } : null
}

export async function runFfmpegComposition(
  inputPaths: string[],
  outputPath: string,
  target: PreviewTarget,
  ffmpegPath: string,
  timeoutMs: number,
  overlayTexts: string[] = [],
): Promise<void> {
  const media = await Promise.all(
    inputPaths.map((inputPath) => probeInputMedia(inputPath, ffmpegPath, timeoutMs)),
  )
  const overlayTextPaths = await Promise.all(
    overlayTexts.map(async (text, index) => {
      if (!text.trim()) return null
      const path = join(dirname(outputPath), `overlay-${String(index + 1).padStart(3, '0')}.txt`)
      await writeFile(path, text, 'utf8')
      return path
    }),
  )
  const fontFile = overlayTextPaths.some(Boolean) ? await findCjkFont() : undefined
  const args = createFfmpegCompositionArgs(inputPaths, outputPath, target, media, overlayTextPaths, fontFile)
  await runProcess(ffmpegPath, args, timeoutMs, 'FFmpeg 合成失败')
}

export function createFfmpegCompositionArgs(
  inputPaths: string[],
  outputPath: string,
  target: PreviewTarget,
  media: FfmpegInputMedia[],
  overlayTextPaths: Array<string | null> = [],
  fontFile = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
): string[] {
  if (inputPaths.length !== media.length || !inputPaths.length) {
    throw new Error('FFmpeg 合成输入不完整')
  }

  const inputs = inputPaths.flatMap((path) => ['-i', path])
  const silenceInputs: string[] = []
  const audioInputIndexes = media.map((item, index) => {
    if (item.hasAudio) return index
    const silenceIndex = inputPaths.length + silenceInputs.length / 6
    silenceInputs.push('-f', 'lavfi', '-t', ffmpegDuration(item.duration), '-i', 'anullsrc=r=48000:cl=stereo')
    return silenceIndex
  })
  const filters = inputPaths.map((_, index) => {
    const overlayPath = overlayTextPaths[index]
    const overlay = overlayPath
      ? `drawtext=fontfile=${escapeFilterPath(fontFile)}:textfile=${escapeFilterPath(overlayPath)}:` +
        'fontcolor=white:fontsize=42:box=1:boxcolor=black@0.58:boxborderw=12:' +
        'x=(w-text_w)/2:y=h-text_h-80,'
      : ''
    return (
      `[${index}:v]scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
      `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=24,` +
      overlay +
      `format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`
    )
  })
  for (const [index, item] of media.entries()) {
    filters.push(
      `[${audioInputIndexes[index]}:a]aresample=48000:async=1:first_pts=0,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,apad,` +
        `atrim=duration=${ffmpegDuration(item.duration)},asetpts=PTS-STARTPTS[a${index}]`,
    )
  }
  filters.push(
    `${inputPaths.map((_, index) => `[v${index}][a${index}]`).join('')}` +
      `concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`,
  )
  return [
    '-hide_banner',
    '-y',
    ...inputs,
    ...silenceInputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outputPath,
  ]
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/:/gu, '\\:').replace(/'/gu, "\\'")
}

async function findCjkFont(): Promise<string> {
  const candidates = [
    process.env.SEQORA_CJK_FONT,
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error('后期叠字需要中文字体，请配置 SEQORA_CJK_FONT')
}

async function probeInputMedia(
  inputPath: string,
  ffmpegPath: string,
  timeoutMs: number,
): Promise<FfmpegInputMedia> {
  const ffprobePath = join(dirname(ffmpegPath), `ffprobe${extname(ffmpegPath)}`)
  const stdout = await runProcess(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', inputPath],
    Math.min(timeoutMs, 15_000),
    'FFprobe 媒体检查失败',
    true,
  )
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; duration?: string }>
  }
  const streamDurations = (parsed.streams ?? [])
    .map((stream) => Number(stream.duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0)
  const duration = Number(parsed.format?.duration) || Math.max(0, ...streamDurations)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('FFprobe 无法识别视频时长')
  return {
    duration,
    hasAudio: (parsed.streams ?? []).some((stream) => stream.codec_type === 'audio'),
  }
}

async function runProcess(
  executable: string,
  args: string[],
  timeoutMs: number,
  failurePrefix: string,
  captureStdout = false,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
    })
    let stdout = ''
    if (captureStdout) child.stdout?.on('data', (chunk) => (stdout += String(chunk)))
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000)
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`${failurePrefix}：超时`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(new Error(`${failurePrefix}：${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${failurePrefix}${stderr ? `：${stderr.slice(-1_000)}` : ''}`))
    })
  })
}

function ffmpegDuration(duration: number): string {
  return Math.max(0.001, duration).toFixed(3)
}

function previewTarget(aspectRatio: string): PreviewTarget {
  if (aspectRatio === '9:16') return { width: 1080, height: 1920 }
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 }
  return { width: 1920, height: 1080 }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(message))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
