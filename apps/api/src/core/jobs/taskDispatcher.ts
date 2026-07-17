import type { GenerationTask } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'

export interface TaskDispatcher {
  dispatch(task: GenerationTask): Promise<void>
}

export class LocalTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null

  constructor(private readonly store: AppStore) {}

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
    const hasActiveTasks = this.store.read((state) =>
      state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
    )
    if (!hasActiveTasks) return

    await this.store.mutate((state) => {
      const now = new Date().toISOString()

      for (const user of state.users) {
        const userTasks = state.tasks.filter((task) => task.userId === user.id)
        const running = userTasks.filter((task) => task.status === 'running')
        const available = Math.max(0, (user.plan === 'member' ? 3 : 1) - running.length)
        userTasks
          .filter((task) => task.status === 'queued')
          .slice(0, available)
          .forEach((task) => {
            task.status = 'running'
            task.progress = 8
            task.updatedAt = now
          })
      }

      state.tasks
        .filter((task) => task.status === 'running')
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
  }
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
