import { describe, expect, it } from 'vitest'
import {
  generationTaskStatusSchema,
  videoGenerationMetadataSchema,
  videoGenerationModeSchema,
} from './generation.js'

describe('generation contracts', () => {
  it('supports advanced video generation modes', () => {
    expect(videoGenerationModeSchema.options).toEqual([
      'text-to-video',
      'video-to-video',
      'first-last-frame',
      'extend',
      'inpaint',
      'replace-background',
      'relight',
      'upscale',
      'lip-sync',
    ])
  })

  it('includes paused in generation task statuses', () => {
    expect(generationTaskStatusSchema.options).toContain('paused')
  })

  it('parses provider-neutral advanced video metadata', () => {
    expect(
      videoGenerationMetadataSchema.parse({
        videoMode: 'replace-background',
        sourceVideoUrl: '/api/v1/media/22222222-2222-4222-8222-222222222222',
        backgroundReferenceUrl: 'https://assets.example/background.jpg',
        lightingPreset: 'matched-environment',
        templateId: 'scene-remix',
      }),
    ).toMatchObject({
      videoMode: 'replace-background',
      templateId: 'scene-remix',
    })
  })
})
