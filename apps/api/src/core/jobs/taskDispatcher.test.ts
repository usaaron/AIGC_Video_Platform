import type { GenerationTask } from '@seqora/contracts'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { VideoGenerationProvider } from '../generation/videoProvider.js'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

describe('GenerationTaskRunner Seedance integration', () => {
  it('submits and completes configured video tasks through the remote provider', async () => {
    const provider: VideoGenerationProvider = {
      submit: vi.fn(async () => ({ providerTaskId: 'remote-task-1', status: 'queued', progress: 0 })),
      getStatus: vi.fn(async () => ({ status: 'completed', progress: 100, error: null })),
      getContent: vi.fn(async () => ({
        stream: Readable.from([]),
        contentType: 'video/mp4',
        contentLength: null,
      })),
    }
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const task: GenerationTask = {
      id: 'local-video-task',
      clientRequestId: 'client-video-task',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      userId: 'user-creator',
      kind: 'video',
      label: '镜头 01',
      prompt: '列车穿过雨幕，镜头平稳跟随',
      negativePrompt: '',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        duration: 5,
        aspectRatio: '9:16',
        resolution: '720p',
        images: ['https://assets.example/shot.jpg', '/demo/local.jpg'],
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 18,
      createdAt: now,
      updatedAt: now,
      resultUrl: null,
      outputs: [],
      error: null,
    }
    await store.mutate((state) => state.tasks.unshift(task))

    const runner = new GenerationTaskRunner(store, provider, 0)
    await runner.dispatch(task)

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: task.prompt,
        seconds: 5,
        ratio: '9:16',
        images: ['https://assets.example/shot.jpg'],
      }),
    )
    expect(provider.getStatus).toHaveBeenCalledWith('remote-task-1')
    expect(await store.read((state) => state.tasks.find((item) => item.id === task.id))).toMatchObject({
      status: 'completed',
      progress: 100,
      resultUrl: '/api/v1/generation/tasks/local-video-task/content',
      metadata: { providerTaskId: 'remote-task-1', providerState: 'completed' },
      outputs: [
        {
          id: 'local-video-task-video',
          url: '/api/v1/generation/tasks/local-video-task/content',
          mediaType: 'video',
        },
      ],
    })
  })
})
