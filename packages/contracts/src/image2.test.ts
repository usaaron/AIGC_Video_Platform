import { describe, expect, it } from 'vitest'
import {
  IMAGE2_CREDITS_PER_IMAGE,
  IMAGE2_ASPECT_RATIOS,
  IMAGE2_IMAGE_SIZE_OPTIONS,
  IMAGE2_MAX_IMAGES,
  IMAGE2_MAX_REFERENCES,
  IMAGE2_MODEL_ID,
  IMAGE2_PROVIDER_DISPLAY_NAME,
  createImage2BatchSchema,
  image2BatchSchema,
} from './image2.js'

describe('image2 contracts', () => {
  it('accepts the public batch request shape and applies safe defaults', () => {
    expect(
      createImage2BatchSchema.parse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
      }),
    ).toEqual({
      projectId: 'project-image2',
      prompt: 'A quiet production still',
      aspectRatio: 'auto',
      quality: 'low',
      imageCount: 1,
      referenceMediaIds: [],
    })
  })

  it('rejects provider credentials and client-side billing fields', () => {
    const parsed = createImage2BatchSchema.safeParse({
      projectId: 'project-image2',
      prompt: 'A quiet production still',
      provider: 'img2',
      apiBase: 'https://provider.example.com',
      apiKey: 'browser-key',
      estimatedCredits: 0,
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: expect.arrayContaining(['provider', 'apiBase', 'apiKey', 'estimatedCredits']),
    })
  })

  it('caps batch size and references', () => {
    expect(IMAGE2_MAX_IMAGES).toBe(20)
    expect(
      createImage2BatchSchema.safeParse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        imageCount: IMAGE2_MAX_IMAGES + 1,
      }).success,
    ).toBe(false)
    expect(
      createImage2BatchSchema.safeParse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        referenceMediaIds: Array.from(
          { length: IMAGE2_MAX_REFERENCES + 1 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ),
      }).success,
    ).toBe(false)
  })

  it('accepts the image2 studio image sizes and legacy ratio aliases', () => {
    for (const aspectRatio of IMAGE2_ASPECT_RATIOS) {
      expect(
        createImage2BatchSchema.safeParse({
          projectId: 'project-image2',
          prompt: 'A quiet production still',
          aspectRatio,
        }).success,
      ).toBe(true)
    }
    expect(IMAGE2_IMAGE_SIZE_OPTIONS).toEqual(
      expect.arrayContaining(['auto', '1024x1024', '1536x864', '2160x3840']),
    )
  })

  it('describes the service-owned provider and pricing in responses', () => {
    const now = new Date().toISOString()
    expect(
      image2BatchSchema.parse({
        batchId: 'image2-request-1',
        providerName: IMAGE2_PROVIDER_DISPLAY_NAME,
        model: IMAGE2_MODEL_ID,
        creditsPerImage: IMAGE2_CREDITS_PER_IMAGE,
        estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
        tasks: [
          {
            id: 'task-1',
            clientRequestId: 'image2-request-1-1',
            projectId: 'project-image2',
            tenantId: 'tenant-1',
            userId: 'user-1',
            kind: 'image',
            label: '序幕 image2',
            prompt: 'A quiet production still',
            negativePrompt: '',
            provider: 'img2',
            model: IMAGE2_MODEL_ID,
            tier: null,
            metadata: {},
            status: 'queued',
            progress: 0,
            estimatedCredits: IMAGE2_CREDITS_PER_IMAGE,
            attempts: 0,
            maxAttempts: 3,
            leaseOwnerId: null,
            leaseToken: null,
            leaseAcquiredAt: null,
            leaseHeartbeatAt: null,
            leaseExpiresAt: null,
            resultUrl: null,
            outputs: [],
            error: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    ).toMatchObject({
      providerName: '序幕 image2',
      model: IMAGE2_MODEL_ID,
      creditsPerImage: IMAGE2_CREDITS_PER_IMAGE,
    })
  })
})
