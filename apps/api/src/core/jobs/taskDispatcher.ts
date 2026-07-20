import type { GenerationTask } from '@seqora/contracts'
import type { VideoGenerationProvider, VideoGenerationRequest } from '../generation/videoProvider.js'
import type { StateStore } from '../../infra/store.js'

export interface TaskDispatcher {
  dispatch(task: GenerationTask): Promise<void>
}

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null

  constructor(
    private readonly store: StateStore,
    private readonly videoProvider: VideoGenerationProvider | null = null,
    private readonly providerPollIntervalMs = 5_000,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 900)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async dispatch(_task: GenerationTask): Promise<void> {
    await this.tick()
  }

  async tick(): Promise<void> {
    if (this.tickPromise) return this.tickPromise

    const tickPromise = this.runTick()
    this.tickPromise = tickPromise

    try {
      await tickPromise
    } finally {
      if (this.tickPromise === tickPromise) this.tickPromise = null
    }
  }

  private async runTick(): Promise<void> {
    const hasActiveTasks = await this.store.read((state) =>
      state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
    )
    if (!hasActiveTasks) return

    const remoteTasks = await this.store.mutate((state) => {
      const now = new Date().toISOString()
      const selectedRemoteTasks: GenerationTask[] = []

      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            task.metadata.providerName === 'aideos-seedance' &&
            task.metadata.providerState === 'submitting' &&
            !task.metadata.providerTaskId,
        )
        .forEach((task) => {
          task.status = 'failed'
          task.progress = 100
          task.error = 'Seedance 提交过程被中断，请重新生成此镜头'
          task.updatedAt = now
        })

      for (const user of state.users) {
        const userTasks = state.tasks.filter((task) => task.userId === user.id)
        const running = userTasks.filter((task) => task.status === 'running')
        const available = Math.max(0, (user.plan === 'member' ? 3 : 1) - running.length)
        userTasks
          .filter((task) => task.status === 'queued')
          .slice(0, available)
          .forEach((task) => {
            task.status = 'running'
            task.progress = this.usesRemoteVideoProvider(task) ? 1 : 8
            task.updatedAt = now
            if (this.usesRemoteVideoProvider(task)) {
              task.metadata = {
                ...task.metadata,
                providerName: 'aideos-seedance',
                providerState: 'submitting',
              }
              selectedRemoteTasks.push(task)
            }
          })
      }

      return selectedRemoteTasks
    })

    for (const task of remoteTasks) await this.submitRemoteVideo(task)

    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter((task) => task.status === 'running' && task.metadata.providerName !== 'aideos-seedance')
        .forEach((task) => {
          task.progress = Math.min(100, task.progress + 12)
          task.updatedAt = now
          if (task.progress >= 100) {
            task.status = 'completed'
            task.outputs = outputsFor(task)
            task.resultUrl = task.outputs[0]?.url ?? null
          }
        })
    })

    await this.pollRemoteVideos()
  }

  private usesRemoteVideoProvider(task: GenerationTask): boolean {
    return Boolean(this.videoProvider) && task.kind === 'video' && task.provider === 'seedance'
  }

  private async submitRemoteVideo(task: GenerationTask): Promise<void> {
    try {
      const submission = await this.videoProvider!.submit(videoRequestFor(task))
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'running') return
        stored.progress = Math.max(1, submission.progress)
        stored.metadata = {
          ...stored.metadata,
          providerState: submission.status,
          providerTaskId: submission.providerTaskId,
          providerPolledAt: Date.now(),
          providerPollErrors: 0,
        }
        stored.updatedAt = new Date().toISOString()
      })
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  private async pollRemoteVideos(): Promise<void> {
    if (!this.videoProvider) return
    const now = Date.now()
    const tasks = await this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.status === 'running' &&
          task.metadata.providerName === 'aideos-seedance' &&
          typeof task.metadata.providerTaskId === 'string' &&
          now - numberValue(task.metadata.providerPolledAt, 0) >= this.providerPollIntervalMs,
      ),
    )

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (stored) stored.metadata = { ...stored.metadata, providerPolledAt: now }
      })
      try {
        const status = await this.videoProvider.getStatus(providerTaskId)
        await this.store.mutate((state) => {
          const stored = state.tasks.find((item) => item.id === task.id)
          if (!stored || stored.status !== 'running') return
          stored.status = status.status
          stored.progress = status.progress
          stored.error = status.error
          stored.metadata = { ...stored.metadata, providerState: status.status, providerPollErrors: 0 }
          stored.updatedAt = new Date().toISOString()
          if (status.status === 'completed') {
            const url = `/api/v1/generation/tasks/${stored.id}/content`
            stored.outputs = [{ id: `${stored.id}-video`, url, mediaType: 'video', view: 'single' }]
            stored.resultUrl = url
          }
        })
      } catch (error) {
        const attempts = numberValue(task.metadata.providerPollErrors, 0) + 1
        if (attempts >= 3) {
          await this.failTask(task.id, messageFor(error))
        } else {
          await this.store.mutate((state) => {
            const stored = state.tasks.find((item) => item.id === task.id)
            if (stored) stored.metadata = { ...stored.metadata, providerPollErrors: attempts }
          })
        }
      }
    }
  }

  private async failTask(taskId: string, error: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      task.status = 'failed'
      task.progress = 100
      task.error = error.slice(0, 1_000)
      task.updatedAt = new Date().toISOString()
    })
  }
}

function videoRequestFor(task: GenerationTask): VideoGenerationRequest {
  const seed = optionalInteger(task.metadata.seed)
  const watermark = optionalBoolean(task.metadata.watermark)
  const cameraFixed = optionalBoolean(task.metadata.cameraFixed)
  return {
    taskId: task.id,
    model: task.model,
    prompt: task.prompt,
    seconds: boundedInteger(task.metadata.duration, 5, 1, 120),
    ratio: stringValue(task.metadata.aspectRatio, '16:9'),
    resolution: stringValue(task.metadata.resolution, '720p'),
    images: Array.isArray(task.metadata.images)
      ? task.metadata.images.filter(
          (value): value is string => typeof value === 'string' && /^https?:\/\//.test(value),
        )
      : [],
    generateAudio: task.metadata.generateAudio === true,
    ...(seed === null ? {} : { seed }),
    ...(watermark === null ? {} : { watermark }),
    ...(cameraFixed === null ? {} : { cameraFixed }),
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = numberValue(value, fallback)
  return Math.min(max, Math.max(min, Math.round(number)))
}

function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Seedance 请求失败'
}

function outputsFor(task: GenerationTask): GenerationTask['outputs'] {
  if (task.kind === 'image' || task.kind === 'video') {
    const images = ['/demo/lin.jpg', '/demo/station.jpg', '/demo/rain.jpg', '/demo/room.jpg']
    const start = Math.abs(hash(task.id)) % images.length
    const mediaType: 'image' | 'video' = task.kind
    const views =
      task.metadata.turnaround === true ? (['front', 'side', 'back'] as const) : (['single'] as const)
    return views.map((view, index) => ({
      id: `${task.id}-${view}`,
      url: images[(start + index) % images.length] ?? images[0]!,
      mediaType,
      view,
    }))
  }
  return []
}

function hash(value: string): number {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) | 0, 0)
}
