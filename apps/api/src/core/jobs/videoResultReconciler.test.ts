import { Readable } from 'node:stream'
import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type {
  VideoRecoveryClaim,
  VideoRecoveryRepository,
} from '../../modules/generation/recoveryRepository.js'
import { VideoResultReconciler } from './videoResultReconciler.js'

const now = new Date('2026-09-21T05:00:00.000Z')
function setup(overrides: Partial<VideoRecoveryClaim> = {}) {
  const task = {
    id: 'task-1',
    tenantId: 'tenant-1',
    projectId: 'project-1',
    status: 'failed',
  } as GenerationTask
  const claim: VideoRecoveryClaim = {
    task,
    providerTaskId: 'existing-remote',
    token: 'token',
    revision: 'revision',
    expiresAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  }
  const repository: VideoRecoveryRepository = {
    claimDue: vi.fn(async () => [claim]),
    defer: vi.fn(async () => true),
    complete: vi.fn(async () => true),
  }
  const videoBytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32)])
  const tailBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)])
  const media = (bytes: Buffer, contentType: string) => ({
    stream: Readable.from(bytes),
    contentType,
    statusCode: 200,
    contentLength: String(bytes.length),
    acceptRanges: null,
    contentRange: null,
  })
  const provider: VideoGenerationProvider = {
    submit: vi.fn(async () => {
      throw new Error('must never submit')
    }),
    getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
    getContent: vi.fn(async () => media(videoBytes, 'video/mp4')),
    getLastFrameContent: vi.fn(async () => media(tailBytes, 'image/jpeg')),
  }
  const storage: ObjectStorage = { put: vi.fn(async () => {}), get: vi.fn(), delete: vi.fn() }
  const service = new VideoResultReconciler(repository, provider, storage, () => now)
  return { service, repository, provider, storage, claim }
}

describe('known remote video result reconciliation', () => {
  it('only reads the existing remote and persists both outputs before completing', async () => {
    const { service, provider, repository, storage, claim } = setup()
    await service.tick()
    expect(repository.claimDue).toHaveBeenCalledWith(now, 2)
    expect(provider.getStatus).toHaveBeenCalledWith('existing-remote')
    expect(provider.getContent).toHaveBeenCalledWith('existing-remote')
    expect(provider.getLastFrameContent).toHaveBeenCalledWith('existing-remote')
    expect(provider.submit).not.toHaveBeenCalled()
    expect(storage.put).toHaveBeenCalledTimes(2)
    expect(repository.complete).toHaveBeenCalledWith(
      claim,
      [
        expect.objectContaining({ view: 'single', contentType: 'video/mp4' }),
        expect.objectContaining({ view: 'last-frame', contentType: 'image/jpeg' }),
      ],
      now,
    )
    expect(vi.mocked(storage.put).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(repository.complete).mock.invocationCallOrder[0]!,
    )
  })

  it('stops checking confirmed upstream failures without downloading or submitting', async () => {
    const { service, provider, repository, claim } = setup()
    vi.mocked(provider.getStatus).mockResolvedValue({
      status: 'failed',
      progress: 100,
      error: 'copyright denied',
    })
    await service.tick()
    expect(repository.defer).toHaveBeenCalledWith(claim, 'upstream_failed', 'REMOTE_TASK_FAILED', now)
    expect(provider.getContent).not.toHaveBeenCalled()
    expect(provider.submit).not.toHaveBeenCalled()
  })

  it('keeps a still-running remote failed locally and schedules another read', async () => {
    const { service, provider, repository, claim } = setup()
    vi.mocked(provider.getStatus).mockResolvedValue({ status: 'running', progress: 50, error: null })
    await service.tick()
    expect(repository.defer).toHaveBeenCalledWith(claim, 'pending', 'REMOTE_TASK_RUNNING', now)
    expect(repository.complete).not.toHaveBeenCalled()
    expect(claim.task.status).toBe('failed')
  })

  it('retains a pending retry on network errors without exposing error text', async () => {
    const { service, provider, repository, claim } = setup()
    vi.mocked(provider.getStatus).mockRejectedValue(new Error('secret upstream response'))
    await service.tick()
    expect(repository.defer).toHaveBeenCalledWith(claim, 'pending', 'REMOTE_RESULT_READ_RETRY', now)
    expect(provider.submit).not.toHaveBeenCalled()
  })

  it('expires the durable recovery window without calling a provider', async () => {
    const { service, provider, repository, claim } = setup({ expiresAt: now.toISOString() })
    await service.tick()
    expect(repository.defer).toHaveBeenCalledWith(claim, 'expired', 'RECOVERY_WINDOW_EXPIRED', now)
    expect(provider.getStatus).not.toHaveBeenCalled()
  })

  it('does not complete when tail-frame or durable storage fails', async () => {
    const tailFailure = setup()
    vi.mocked(tailFailure.provider.getLastFrameContent!).mockRejectedValue(new Error('tail unavailable'))
    await tailFailure.service.tick()
    expect(tailFailure.repository.complete).not.toHaveBeenCalled()
    expect(tailFailure.storage.put).not.toHaveBeenCalled()
    const storageFailure = setup()
    vi.mocked(storageFailure.storage.put).mockRejectedValue(new Error('disk full'))
    await storageFailure.service.tick()
    expect(storageFailure.repository.complete).not.toHaveBeenCalled()
    expect(storageFailure.repository.defer).toHaveBeenCalled()
  })

  it('does not bind or delete outputs after a failed completion CAS', async () => {
    const { service, repository, storage, claim } = setup()
    vi.mocked(repository.complete).mockResolvedValue(false)
    await service.tick()
    expect(repository.defer).toHaveBeenCalledWith(claim, 'pending', 'RECOVERY_WRITEBACK_DEFERRED', now)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('coalesces concurrent local ticks', async () => {
    const { service, repository } = setup()
    await Promise.all([service.tick(), service.tick(), service.tick()])
    expect(repository.claimDue).toHaveBeenCalledTimes(1)
  })
})
