import { describe, expect, it } from 'vitest'
import {
  ADVANCED_VIDEO_MODES,
  advancedVideoMetadataForShot,
  advancedVideoModeById,
  advancedVideoPromptForShot,
  agentFilmPlanForProject,
} from './advancedVideoTools'

const MEDIA_ID = '22222222-2222-4222-8222-222222222222'

describe('advanced video tools', () => {
  it('lists the requested advanced video modes', () => {
    expect(ADVANCED_VIDEO_MODES.map((mode) => mode.id)).toEqual([
      'video-to-video',
      'first-last-frame',
      'extend',
      'inpaint',
      'replace-background',
      'relight',
      'upscale',
      'lip-sync',
    ])
    expect(advancedVideoModeById('missing').id).toBe('video-to-video')
  })

  it('builds metadata for first-last-frame and controlled media references', () => {
    const metadata = advancedVideoMetadataForShot(
      {
        id: 'shot-1',
        title: '推门进入',
        imageUrl: `/api/v1/media/${MEDIA_ID}`,
      },
      'first-last-frame',
      {
        lastFrameUrl: 'https://assets.example/last.jpg',
        sourceImageUrls: 'https://assets.example/style.jpg',
        templateId: 'cinematic-dialogue',
      },
    )

    expect(metadata).toMatchObject({
      videoMode: 'first-last-frame',
      templateId: 'cinematic-dialogue',
      firstFrameUrl: `/api/v1/media/${MEDIA_ID}`,
      lastFrameUrl: 'https://assets.example/last.jpg',
      sourceImageUrls: ['https://assets.example/style.jpg'],
      images: [
        `/api/v1/media/${MEDIA_ID}`,
        'https://assets.example/last.jpg',
        'https://assets.example/style.jpg',
      ],
    })
  })

  it('applies marketplace prompt copy and creates an agent full-film plan', () => {
    expect(
      advancedVideoPromptForShot({ title: '林夏回头', prompt: '林夏在站台回头' }, 'lip-sync', {
        templateId: 'avatar-speech',
      }),
    ).toContain('虚拟人口播')

    const plan = agentFilmPlanForProject(
      { id: 'project-1' },
      [
        { id: 'shot-1', title: '开场', prompt: '雨夜站台' },
        { id: 'shot-2', title: '对白', prompt: '人物对话' },
      ],
      [{ id: 'audio-1', kind: 'audio', imageUrl: 'https://assets.example/voice.wav' }],
      'agent-avatar-explainer',
    )

    expect(plan).toMatchObject({
      id: 'agent-agent-avatar-explainer-project-1',
      estimatedCredits: 48,
      items: [
        { modeId: 'lip-sync', options: { templateId: 'avatar-speech' } },
        { modeId: 'lip-sync', options: { templateId: 'avatar-speech' } },
      ],
    })
    expect(plan.items[0].options.lipSyncAudioUrl).toBe('https://assets.example/voice.wav')
  })
})
