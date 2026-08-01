import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { VideoGenerationProvider, VideoProviderName } from '../generation/videoProvider.js'
import type { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { observabilityMetrics, observeProviderCall } from '../observability/metrics.js'
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
) => Promise<void>

export interface FilmPreviewDispatcher {
  recoverInterrupted(): Promise<void>
  start(task: GenerationTask): Promise<GenerationTask>
}

export class FilmPreviewComposer implements FilmPreviewDispatcher {
  private readonly leaseOwnerId = `film-preview-composer-${process.pid}-${randomUUID()}`
  private readonly leaseTtlMs: number

  constructor(
    private readonly store: AppStore,
    private readonly videoProvider: VideoGenerationProvider,
    private readonly objectStorage: ObjectStorage,
    private readonly ffmpegPath: string,
    private readonly timeoutMs: number,
    private readonly videoProviderName: VideoProviderName = 'stringx-seedance',
    private readonly composeRunner: ComposeRunner = runFfmpegComposition,
    leaseTtlMs = 120_000,
  ) {
    this.leaseTtlMs = leaseTtlMs
  }

  async recoverInterrupted(): Promise<void> {
    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter((task) => task.provider === 'local-compose' && task.status === 'running')
        .forEach((task) => {
          task.status = 'failed'
          task.progress = 100
          task.error = '完整预览合成被服务重启中断，请重新合成'
          releaseGenerationTaskLease(task)
          task.updatedAt = now
        })
    })
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
      stored.metadata = { ...stored.metadata, providerState: 'composing', compositionStartedAt: nowIso }
      stored.updatedAt = nowIso
      return stored
    })
    void this.compose(task.id, typeof started.leaseToken === 'string' ? started.leaseToken : '')
    return started
  }

  private async compose(taskId: string, leaseToken: string): Promise<void> {
    const startedAt = Date.now()
    let temporaryDirectory: string | null = null
    try {
      const task = this.store.read((state) => state.tasks.find((item) => item.id === taskId) ?? null)
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

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'seqora-film-'))
      const inputPaths: string[] = []
      for (const [index, source] of sourceTasks.entries()) {
        const current = this.store.read((state) => state.tasks.find((item) => item.id === taskId) ?? null)
        if (
          !current ||
          current.status !== 'running' ||
          !generationTaskLeaseMatches(current, this.leaseOwnerId, leaseToken)
        ) {
          return
        }
        const inputPath = join(temporaryDirectory, `shot-${String(index + 1).padStart(3, '0')}.mp4`)
        const content = await observeProviderCall(
          {
            provider: this.videoProviderName,
            operation: 'video.getContent',
            tenantId: task.tenantId,
            taskId,
          },
          () => this.videoProvider.getContent(String(source.metadata.providerTaskId)),
        )
        await pipeline(content.stream, createWriteStream(inputPath))
        inputPaths.push(inputPath)
        await this.updateProgress(taskId, 5 + Math.round(((index + 1) / sourceTasks.length) * 40), leaseToken)
      }

      const outputPath = join(temporaryDirectory, 'film-preview.mp4')
      await this.updateProgress(taskId, 50, leaseToken)
      await this.composeRunner(
        inputPaths,
        outputPath,
        previewTarget(String(task.metadata.aspectRatio || '16:9')),
        this.ffmpegPath,
        this.timeoutMs,
      )
      await this.updateProgress(taskId, 92, leaseToken)

      const output = await readFile(outputPath)
      const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-film-preview.mp4`
      await this.objectStorage.put(storageKey, output, 'video/mp4')
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
          previewStorageKey: storageKey,
          previewContentType: 'video/mp4',
          previewSize: output.length,
          compositionCompletedAt: now,
        }
        stored.updatedAt = now
        releaseGenerationTaskLease(stored)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '完整预览合成失败'
      await this.store.mutate((state) => {
        const task = state.tasks.find((item) => item.id === taskId)
        if (!task) return
        if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
        task.status = 'failed'
        task.progress = 100
        task.error = message.slice(0, 1_000)
        task.metadata = { ...task.metadata, providerState: 'failed' }
        releaseGenerationTaskLease(task)
        task.updatedAt = new Date().toISOString()
      })
    } finally {
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
      }
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  private async updateProgress(taskId: string, progress: number, leaseToken: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return
      if (!generationTaskLeaseMatches(task, this.leaseOwnerId, leaseToken)) return
      task.progress = Math.min(99, Math.max(task.progress, progress))
      renewGenerationTaskLease(task, this.leaseOwnerId, leaseToken, this.leaseTtlMs)
      task.updatedAt = new Date().toISOString()
    })
  }
}

export async function runFfmpegComposition(
  inputPaths: string[],
  outputPath: string,
  target: PreviewTarget,
  ffmpegPath: string,
  timeoutMs: number,
): Promise<void> {
  const inputs = inputPaths.flatMap((path) => ['-i', path])
  const filters = inputPaths.map(
    (_, index) =>
      `[${index}:v]scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
      `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=24,` +
      `format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`,
  )
  filters.push(
    `${inputPaths.map((_, index) => `[v${index}]`).join('')}concat=n=${inputPaths.length}:v=1:a=0[outv]`,
  )
  const args = [
    '-hide_banner',
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-movflags',
    '+faststart',
    outputPath,
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000)
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('完整预览合成超时'))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(new Error(`FFmpeg 无法启动：${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg 合成失败${stderr ? `：${stderr.slice(-1_000)}` : ''}`))
    })
  })
}

function previewTarget(aspectRatio: string): PreviewTarget {
  if (aspectRatio === '9:16') return { width: 1080, height: 1920 }
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 }
  return { width: 1920, height: 1080 }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
