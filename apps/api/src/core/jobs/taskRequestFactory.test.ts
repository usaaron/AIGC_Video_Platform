import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import { videoRequestFor } from './taskRequestFactory.js'

const MEDIA_ID = '22222222-2222-4222-8222-222222222222'

describe('taskRequestFactory', () => {
  it('maps advanced video metadata into provider-neutral requests', () => {
    const task: GenerationTask = {
      id: 'task-video-advanced',
      clientRequestId: 'client-video-advanced',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      kind: 'video',
      label: '高级视频操作',
      prompt: '保持人物一致，替换背景并同步口型',
      negativePrompt: '不要闪烁',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      metadata: {
        videoMode: 'lip-sync',
        duration: 8,
        aspectRatio: '9:16',
        resolution: '1080p',
        images: ['https://assets.example/shot.jpg', '/demo/local.jpg'],
        sourceVideoUrl: `/api/v1/media/${MEDIA_ID}`,
        sourceImageUrls: ['https://assets.example/source.jpg', '/demo/local-source.jpg'],
        firstFrameUrl: 'https://assets.example/first.jpg',
        lastFrameUrl: 'https://assets.example/last.jpg',
        maskUrl: 'https://assets.example/mask.png',
        backgroundReferenceUrl: 'https://assets.example/background.jpg',
        lightingPreset: 'soft-window',
        upscaleFactor: 4,
        lipSyncAudioUrl: 'https://assets.example/voice.wav',
        extendSeconds: 12,
        templateId: 'cinematic-dialogue',
        agentPlanId: 'agent-plan-1',
        generateAudio: true,
      },
      status: 'queued',
      progress: 0,
      estimatedCredits: 18,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      resultUrl: null,
      outputs: [],
      error: null,
    }

    expect(videoRequestFor(task)).toMatchObject({
      taskId: 'task-video-advanced',
      mode: 'lip-sync',
      prompt: '保持人物一致，替换背景并同步口型',
      negativePrompt: '不要闪烁',
      seconds: 8,
      ratio: '9:16',
      resolution: '1080p',
      images: ['https://assets.example/shot.jpg'],
      sourceVideoUrl: `/api/v1/media/${MEDIA_ID}`,
      sourceImageUrls: ['https://assets.example/source.jpg'],
      firstFrameUrl: 'https://assets.example/first.jpg',
      lastFrameUrl: 'https://assets.example/last.jpg',
      maskUrl: 'https://assets.example/mask.png',
      backgroundReferenceUrl: 'https://assets.example/background.jpg',
      lightingPreset: 'soft-window',
      upscaleFactor: 4,
      lipSyncAudioUrl: 'https://assets.example/voice.wav',
      extendSeconds: 12,
      templateId: 'cinematic-dialogue',
      agentPlanId: 'agent-plan-1',
      generateAudio: true,
    })
  })

  it('falls back to text-to-video when the mode is unknown', () => {
    expect(
      videoRequestFor({
        id: 'task-video-basic',
        clientRequestId: 'client-video-basic',
        projectId: 'project-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        kind: 'video',
        label: '基础视频',
        prompt: '雨夜站台',
        negativePrompt: '',
        provider: 'seedance',
        model: null,
        metadata: { videoMode: 'unknown-mode' },
        status: 'queued',
        progress: 0,
        estimatedCredits: 18,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
        resultUrl: null,
        outputs: [],
        error: null,
      }).mode,
    ).toBe('text-to-video')
  })
})
