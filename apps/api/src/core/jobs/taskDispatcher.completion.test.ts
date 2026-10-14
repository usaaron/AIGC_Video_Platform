import type { GenerationTask } from '@seqora/contracts'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

const video = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')

describe('provider completion notification after persistence', () => {
  it.each(['accepted', 'cancelled', 'new lease', 'new attempt', 'different receipt', 'different media'])(
    'notifies only the accepted completion when persistence returns %s',
    async (outcome) => {
      const store = new AppStore(null)
      await store.initialize()
      const now = new Date().toISOString()
      const task: GenerationTask = {
        id: `notification-${outcome.replaceAll(' ', '-')}`,
        clientRequestId: 'notification-fixture',
        tenantId: 'tenant-seqora-demo',
        projectId: 'project-midnight-film',
        userId: 'user-member',
        kind: 'video',
        provider: 'seedance',
        model: null,
        label: 'Synthetic completion',
        prompt: 'Synthetic completion',
        negativePrompt: '',
        metadata: {
          providerName: 'stringx-seedance',
          providerTaskId: 'remote-notification',
          providerState: 'running',
        },
        status: 'running',
        progress: 50,
        attempts: 1,
        maxAttempts: 3,
        estimatedCredits: 18,
        createdAt: now,
        updatedAt: now,
        resultUrl: null,
        outputs: [],
        error: null,
      }
      await store.mutate((state) => {
        state.tasks = [task]
      })
      const onVideoCompleted = vi.fn(async () => {})
      const provider: VideoGenerationProvider = {
        submit: vi.fn(),
        getStatus: vi.fn<VideoGenerationProvider['getStatus']>(async () => ({
          status: 'completed',
          progress: 100,
          error: null,
        })),
        getContent: vi.fn(async () => ({
          stream: Readable.from([video]),
          contentType: 'video/mp4',
          contentLength: String(video.length),
          statusCode: 200,
          acceptRanges: null,
          contentRange: null,
        })),
      }
      let persistenceCalls = 0
      const runner = new GenerationTaskRunner(store, {
        videoProvider: provider,
        providerPollIntervalMs: 60_000,
        onVideoCompleted,
        objectStorage: { put: async () => {}, get: async () => video, delete: async () => {} },
        persistTask: async (taskId) => {
          await store.mutateGenerationTaskRuntimeCacheAsync((state) => {
            const current = state.tasks.find((item) => item.id === taskId)!
            if (current.status !== 'completed') return
            persistenceCalls += 1
            if (outcome === 'accepted') return
            if (outcome === 'cancelled') current.status = 'cancelled'
            if (outcome === 'new lease') {
              current.status = 'running'
              current.leaseOwnerId = 'worker-2'
              current.leaseToken = 'lease-2'
            }
            if (outcome === 'new attempt') current.attempts = 2
            if (outcome === 'different receipt') current.metadata.providerCompletionReceipt = { stale: false }
            if (outcome === 'different media') current.resultUrl = '/current-video.mp4'
          })
        },
      })
      await runner.tick()
      expect(persistenceCalls).toBe(1)
      expect(onVideoCompleted).toHaveBeenCalledTimes(outcome === 'accepted' ? 1 : 0)
      runner.stop()
    },
  )
})
