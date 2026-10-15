import type { GenerationTask } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import { frameSizeForFilmExport, normalizeFilmExportOptions } from './filmExportOptions.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { AppState, StateStore, StoredMedia } from '../../infra/store.js'

export type FilmExportResult = {
  outputs: GenerationTask['outputs']
  media: StoredMedia[]
}

export interface FilmExporter {
  export(task: GenerationTask): Promise<FilmExportResult>
}

type FilmExportPlan = {
  clips: FilmExportClip[]
  audioMedia: StoredMedia | null
  exportOptions: ReturnType<typeof normalizeFilmExportOptions>
}

type FilmExportClip = {
  taskId: string
  media: StoredMedia
  duration: number
  subtitle: string
}

export class FfmpegFilmExporter implements FilmExporter {
  constructor(
    private readonly store: StateStore,
    private readonly storage: ObjectStorage,
    private readonly ffmpegPath = 'ffmpeg',
    private readonly timeoutMs = 300_000,
  ) {}

  async export(task: GenerationTask): Promise<FilmExportResult> {
    const plan = await this.store.read((state) => exportPlanFor(state, task))
    const directory = join(tmpdir(), `seqora-film-${task.id}-${randomUUID()}`)
    await mkdir(directory, { recursive: true })

    try {
      const targetSize = frameSizeForFilmExport(plan.exportOptions.ratio, plan.exportOptions.resolution)
      const videoFiles = await Promise.all(
        plan.clips.map(async (clip, index) => {
          const path = join(
            directory,
            `shot-${String(index + 1).padStart(3, '0')}${extensionFor(clip.media)}`,
          )
          await writeFile(path, await this.storage.get(clip.media.storageKey))
          return this.normalizeClip(directory, path, clip, targetSize, plan.exportOptions)
        }),
      )
      const audioFile = plan.audioMedia ? join(directory, `audio${extensionFor(plan.audioMedia)}`) : null
      if (plan.audioMedia && audioFile)
        await writeFile(audioFile, await this.storage.get(plan.audioMedia.storageKey))

      const concatList = join(directory, 'concat.txt')
      await writeFile(
        concatList,
        videoFiles.map((file) => `file '${escapeFfmpegPath(file)}'`).join('\n'),
        'utf8',
      )

      const silentOutput = join(directory, 'video-only.mp4')
      await this.runFfmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatList,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(plan.exportOptions.fps),
        '-an',
        silentOutput,
      ])

      const outputPath = join(directory, 'film.mp4')
      if (audioFile) {
        await this.runFfmpeg([
          '-y',
          '-i',
          silentOutput,
          '-i',
          audioFile,
          '-shortest',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputPath,
        ])
      } else {
        await this.runFfmpeg(['-y', '-i', silentOutput, '-c', 'copy', '-movflags', '+faststart', outputPath])
      }

      const content = await readFile(outputPath)
      const mediaId = randomUUID()
      const storageKey = `${task.tenantId}/${task.projectId}/exports/${task.id}/${mediaId}.mp4`
      await this.storage.put(storageKey, content, 'video/mp4')

      const media: StoredMedia = {
        id: mediaId,
        projectId: task.projectId,
        tenantId: task.tenantId,
        kind: 'video',
        name: `${task.label}.mp4`.slice(0, 255),
        contentType: 'video/mp4',
        size: content.length,
        storageKey,
        createdAt: new Date().toISOString(),
      }
      return {
        outputs: [{ id: mediaId, url: `/api/v1/media/${mediaId}`, mediaType: 'video', view: 'single' }],
        media: [media],
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegPath, args, { windowsHide: true })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`ffmpeg timed out after ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      const errors: Buffer[] = []
      child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)))
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`ffmpeg unavailable: ${error.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve()
          return
        }
        const message = Buffer.concat(errors).toString('utf8').slice(-1_000)
        reject(new Error(`ffmpeg export failed (${code})${message ? `: ${message}` : ''}`))
      })
    })
  }

  private async normalizeClip(
    directory: string,
    sourcePath: string,
    clip: FilmExportClip,
    targetSize: { width: number; height: number },
    exportOptions: ReturnType<typeof normalizeFilmExportOptions>,
  ): Promise<string> {
    const normalizedPath = join(directory, `${basename(sourcePath, extensionFor(clip.media))}-normalized.mp4`)
    const args = ['-y', '-i', sourcePath, '-t', String(clip.duration)]
    const filters = [
      `scale=${targetSize.width}:${targetSize.height}:force_original_aspect_ratio=decrease`,
      `pad=${targetSize.width}:${targetSize.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1',
    ]

    if (exportOptions.subtitlesEnabled && clip.subtitle.trim()) {
      const subtitlePath = join(directory, `${basename(sourcePath, extensionFor(clip.media))}.txt`)
      await writeFile(subtitlePath, clip.subtitle, 'utf8')
      filters.push(
        `drawtext=textfile='${escapeFfmpegPath(subtitlePath)}':fontcolor=white:fontsize=${subtitleFontSize(targetSize.height)}:box=1:boxcolor=black@0.45:boxborderw=18:x=(w-text_w)/2:y=h*0.82`,
      )
    }

    args.push(
      '-vf',
      filters.join(','),
      '-r',
      String(exportOptions.fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      normalizedPath,
    )

    await this.runFfmpeg(args)
    return normalizedPath
  }
}

function exportPlanFor(state: AppState, task: GenerationTask): FilmExportPlan {
  const project = state.projects.find((item) => item.id === task.projectId && item.tenantId === task.tenantId)
  if (!project) throw new Error('Project not found for film export')

  const requestedTaskIds = stringArray(task.metadata.sourceTaskIds)
  const videoTasks =
    requestedTaskIds.length > 0
      ? requestedTaskIds.map((taskId) => completedVideoTaskById(state, task, taskId))
      : state.shots
          .filter((shot) => shot.projectId === task.projectId && shot.tenantId === task.tenantId)
          .sort((left, right) => left.order - right.order)
          .map((shot) => completedVideoTaskForShot(state, task, shot.id))

  const exportOptions = normalizeFilmExportOptions(task.metadata.exportOptions, project.aspectRatio)
  const timelineByTaskId = new Map(exportOptions.timeline.map((item) => [item.taskId, item]))
  const clips = videoTasks
    .map((item) => {
      const media = mediaForOutput(state, task, item)
      if (!media) return null
      const timeline = timelineByTaskId.get(item.id)
      return {
        taskId: item.id,
        media,
        duration: timeline?.duration ?? clipDurationForTask(item),
        subtitle: timeline?.subtitle ?? item.label,
      }
    })
    .filter(isFilmExportClip)

  if (clips.length === 0) throw new Error('No completed shot videos found for film export')
  if (requestedTaskIds.length > 0 && clips.length < requestedTaskIds.length) {
    throw new Error('Some selected shot videos are missing platform media outputs')
  }
  if (exportOptions.timeline.length === 0) {
    exportOptions.timeline = clips.map((clip, index) => {
      const taskItem = videoTasks[index]
      const shot = state.shots.find((item) => item.id === taskItem?.metadata?.shotId)
      return {
        shotId: shot?.id ?? clip.taskId,
        taskId: clip.taskId,
        title: shot?.title ?? taskItem?.label ?? `镜头 ${index + 1}`,
        duration: clip.duration,
        subtitle: shot?.title ?? taskItem?.label ?? `镜头 ${index + 1}`,
      }
    })
  }

  const audioTaskIds = stringArray(task.metadata.audioTaskIds)
  const audioTask =
    exportModeFor(task.metadata.exportOptions) === 'silent'
      ? null
      : (audioTaskIds.map((taskId) => completedAudioTaskById(state, task, taskId)).find(Boolean) ??
        state.tasks.find(
          (item) =>
            item.projectId === task.projectId &&
            item.tenantId === task.tenantId &&
            item.kind === 'audio' &&
            item.status === 'completed' &&
            item.outputs.some((output) => output.mediaType === 'audio'),
        ) ??
        null)

  return {
    clips,
    audioMedia: audioTask ? mediaForOutput(state, task, audioTask, 'audio') : null,
    exportOptions,
  }
}

function completedVideoTaskById(state: AppState, parent: GenerationTask, taskId: string): GenerationTask {
  const task = state.tasks.find(
    (item) =>
      item.id === taskId &&
      item.projectId === parent.projectId &&
      item.tenantId === parent.tenantId &&
      item.kind === 'video' &&
      item.status === 'completed',
  )
  if (!task) throw new Error(`Shot video task is not completed: ${taskId}`)
  return task
}

function completedVideoTaskForShot(state: AppState, parent: GenerationTask, shotId: string): GenerationTask {
  const task = state.tasks.find(
    (item) =>
      item.projectId === parent.projectId &&
      item.tenantId === parent.tenantId &&
      item.kind === 'video' &&
      item.status === 'completed' &&
      item.metadata.shotId === shotId &&
      item.outputs.some((output) => output.mediaType === 'video'),
  )
  if (!task) throw new Error(`Shot has no completed video: ${shotId}`)
  return task
}

function completedAudioTaskById(
  state: AppState,
  parent: GenerationTask,
  taskId: string,
): GenerationTask | null {
  return (
    state.tasks.find(
      (item) =>
        item.id === taskId &&
        item.projectId === parent.projectId &&
        item.tenantId === parent.tenantId &&
        item.kind === 'audio' &&
        item.status === 'completed',
    ) ?? null
  )
}

function mediaForOutput(
  state: AppState,
  parent: GenerationTask,
  task: GenerationTask,
  mediaType: 'video' | 'audio' = 'video',
): StoredMedia | null {
  const output = task.outputs.find((item) => item.mediaType === mediaType)
  const mediaId = output ? mediaIdForUrl(output.url) : null
  if (!mediaId) return null
  return (
    state.media.find(
      (media) =>
        media.id === mediaId &&
        media.projectId === parent.projectId &&
        media.tenantId === parent.tenantId &&
        media.kind === mediaType,
    ) ?? null
  )
}

function mediaIdForUrl(url: string): string | null {
  const match = /^\/api\/v1\/media\/([^/?#]+)/.exec(url)
  return match?.[1] ?? null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function exportModeFor(value: unknown): 'selected' | 'silent' {
  return isRecord(value) && value.audioMode === 'silent' ? 'silent' : 'selected'
}

function isFilmExportClip(value: FilmExportClip | null): value is FilmExportClip {
  return Boolean(value)
}

function clipDurationForTask(task: GenerationTask): number {
  const value = Number(task.metadata.duration)
  if (!Number.isFinite(value)) return 4
  return Math.min(120, Math.max(1, Math.round(value)))
}

function subtitleFontSize(height: number): number {
  return Math.max(28, Math.round(height * 0.035))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extensionFor(media: StoredMedia): string {
  const extension = basename(media.storageKey).match(/\.[a-z0-9]+$/i)?.[0]
  if (extension) return extension
  if (media.contentType === 'video/webm') return '.webm'
  if (media.contentType === 'audio/wav' || media.contentType === 'audio/x-wav') return '.wav'
  if (media.contentType === 'audio/ogg') return '.ogg'
  if (media.contentType.startsWith('audio/')) return '.mp3'
  return '.mp4'
}

function escapeFfmpegPath(path: string): string {
  return path.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''")
}
