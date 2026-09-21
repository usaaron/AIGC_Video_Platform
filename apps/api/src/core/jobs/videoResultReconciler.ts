import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type {
  VideoRecoveryClaim,
  VideoRecoveryRepository,
} from '../../modules/generation/recoveryRepository.js'
import type { GeneratedOutputDescriptor } from './taskWriteback.js'

type ReadOnlyVideoProvider = Pick<VideoGenerationProvider, 'getStatus' | 'getContent' | 'getLastFrameContent'>

/** Reconciles known remote results without occupying a generation slot or submitting any work. */
export class VideoResultReconciler {
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<void> | null = null

  constructor(
    private readonly repository: VideoRecoveryRepository,
    private readonly provider: ReadOnlyVideoProvider,
    private readonly storage: ObjectStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (this.timer) return
    const run = () =>
      void this.tick().catch(() => {
        // Provider responses can contain signed media URLs or user input; never log their errors.
        process.emitWarning('Video result reconciliation will retry on the next interval', {
          code: 'SEQORA_VIDEO_RECONCILIATION_RETRY',
        })
      })
    this.timer = setInterval(run, 60_000)
    this.timer.unref?.()
    run()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.inFlight?.catch(() => {})
  }

  tick(): Promise<void> {
    this.inFlight ??= this.runBatch().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async runBatch(): Promise<void> {
    const claims = await this.repository.claimDue(this.now(), 2)
    // Limit media downloads to one at a time; the batch never blocks generation polling.
    for (const claim of claims) await this.reconcile(claim)
  }

  private async reconcile(claim: VideoRecoveryClaim): Promise<void> {
    if (
      !Number.isFinite(Date.parse(claim.expiresAt)) ||
      Date.parse(claim.expiresAt) <= this.now().getTime()
    ) {
      await this.repository.defer(claim, 'expired', 'RECOVERY_WINDOW_EXPIRED', this.now())
      return
    }
    try {
      const status = await this.provider.getStatus(claim.providerTaskId)
      if (status.status === 'failed') {
        await this.repository.defer(claim, 'upstream_failed', 'REMOTE_TASK_FAILED', this.now())
        return
      }
      if (status.status === 'running') {
        await this.repository.defer(claim, 'pending', 'REMOTE_TASK_RUNNING', this.now())
        return
      }
      const descriptors = await this.persistOutputs(claim)
      if (!(await this.repository.complete(claim, descriptors, this.now()))) {
        // Receipt or task version may have changed while downloading. Never resubmit or select a shot.
        await this.repository.defer(claim, 'pending', 'RECOVERY_WRITEBACK_DEFERRED', this.now())
      }
    } catch {
      await this.repository.defer(claim, 'pending', 'REMOTE_RESULT_READ_RETRY', this.now())
    }
  }

  private async persistOutputs(claim: VideoRecoveryClaim): Promise<GeneratedOutputDescriptor[]> {
    if (!this.provider.getLastFrameContent) throw new Error('LAST_FRAME_UNAVAILABLE')
    const video = await this.provider.getContent(claim.providerTaskId)
    const videoBytes = await readBounded(video.stream, 256 * 1024 * 1024)
    if (videoBytes.length < 12 || videoBytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
      throw new Error('INVALID_MP4_CONTENT')
    }
    const tail = await this.provider.getLastFrameContent(claim.providerTaskId)
    const tailBytes = await readBounded(tail.stream, 16 * 1024 * 1024)
    const jpeg = tailBytes[0] === 0xff && tailBytes[1] === 0xd8 && tailBytes[2] === 0xff
    const png = tailBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if ((!jpeg && !png) || tailBytes.length < 16) throw new Error('INVALID_LAST_FRAME_CONTENT')
    const prefix = `${claim.task.tenantId}/${claim.task.projectId}/generated/${claim.task.id}-reconciled`
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    const descriptors: GeneratedOutputDescriptor[] = [
      {
        view: 'single',
        storageKey: `${prefix}-${hash(videoBytes)}.mp4`,
        contentType: 'video/mp4',
        size: videoBytes.length,
      },
      {
        view: 'last-frame',
        storageKey: `${prefix}-${hash(tailBytes)}.${jpeg ? 'jpg' : 'png'}`,
        contentType: jpeg ? 'image/jpeg' : 'image/png',
        size: tailBytes.length,
      },
    ]
    await this.storage.put(descriptors[0]!.storageKey, videoBytes, descriptors[0]!.contentType)
    await this.storage.put(descriptors[1]!.storageKey, tailBytes, descriptors[1]!.contentType)
    // A failed CAS may leave an unreferenced object; never delete another worker's output.
    return descriptors
  }
}

async function readBounded(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of stream) {
    const chunk = Buffer.from(value as Uint8Array)
    size += chunk.length
    if (size > limit) throw new Error('MEDIA_SIZE_LIMIT')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
