import { describe, expect, it } from 'vitest'
import {
  IMAGE2_CREDITS_PER_IMAGE,
  IMAGE2_ASPECT_RATIOS,
  IMAGE2_IMAGE_SIZE_OPTIONS,
  IMAGE2_MAX_INPUT_IMAGES,
  IMAGE2_MAX_IMAGES,
  IMAGE2_MAX_REFERENCE_IMAGES,
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
      references: [],
      assist: {
        promptOptimization: false,
        referenceVision: false,
      },
    })
  })

  it('accepts a strict redo source task id', () => {
    expect(
      createImage2BatchSchema.parse({
        projectId: 'project-image2',
        prompt: 'Ignored by strict redo',
        sourceTaskId: 'task-1',
      }).sourceTaskId,
    ).toBe('task-1')
  })

  it('rejects provider credentials and client-side billing fields', () => {
    const parsed = createImage2BatchSchema.safeParse({
      projectId: 'project-image2',
      prompt: 'A quiet production still',
      provider: 'img2',
      apiBase: 'https://provider.example.com',
      apiKey: 'browser-key',
      estimatedCredits: 0,
      apiModel: 'gpt-5.4',
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: expect.arrayContaining(['provider', 'apiBase', 'apiKey', 'estimatedCredits', 'apiModel']),
    })
  })

  it('accepts only service-owned assist toggles', () => {
    expect(
      createImage2BatchSchema.parse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        assist: {
          promptOptimization: true,
          referenceVision: true,
        },
      }).assist,
    ).toEqual({
      promptOptimization: true,
      referenceVision: true,
    })

    expect(
      createImage2BatchSchema.safeParse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        assist: {
          promptOptimization: true,
          referenceVision: true,
          model: 'gpt-5.4',
          apiKey: 'browser-key',
        },
      }).success,
    ).toBe(false)
  })

  it('caps batch size and input images', () => {
    expect(IMAGE2_MAX_IMAGES).toBe(20)
    expect(IMAGE2_MAX_REFERENCE_IMAGES).toBe(4)
    expect(IMAGE2_MAX_INPUT_IMAGES).toBe(5)
    expect(IMAGE2_MAX_REFERENCES).toBe(5)
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
        references: Array.from({ length: IMAGE2_MAX_REFERENCES + 1 }, (_, index) => ({
          mediaId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          role: 'style',
          referenceNumber: index + 1,
        })),
      }).success,
    ).toBe(false)
  })

  it('normalizes structured and legacy reference inputs', () => {
    expect(
      createImage2BatchSchema.parse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        references: [
          {
            mediaId: '00000000-0000-4000-8000-000000000001',
            role: 'subject',
            referenceNumber: 5,
          },
          {
            mediaId: '00000000-0000-4000-8000-000000000002',
            role: 'clothing',
          },
        ],
      }).references,
    ).toEqual([
      {
        mediaId: '00000000-0000-4000-8000-000000000001',
        role: 'subject',
        referenceNumber: 5,
      },
      {
        mediaId: '00000000-0000-4000-8000-000000000002',
        role: 'clothing',
        referenceNumber: 2,
      },
    ])

    expect(
      createImage2BatchSchema.parse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        referenceMediaIds: [
          '00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000004',
        ],
      }).references,
    ).toEqual([
      {
        mediaId: '00000000-0000-4000-8000-000000000003',
        role: 'subject',
        referenceNumber: 1,
      },
      {
        mediaId: '00000000-0000-4000-8000-000000000004',
        role: 'style',
        referenceNumber: 2,
      },
    ])
  })

  it('rejects duplicate subject images and image numbers', () => {
    expect(
      createImage2BatchSchema.safeParse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        references: [
          {
            mediaId: '00000000-0000-4000-8000-000000000001',
            role: 'subject',
            referenceNumber: 1,
          },
          {
            mediaId: '00000000-0000-4000-8000-000000000002',
            role: 'subject',
            referenceNumber: 2,
          },
        ],
      }).success,
    ).toBe(false)

    expect(
      createImage2BatchSchema.safeParse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        references: [
          {
            mediaId: '00000000-0000-4000-8000-000000000003',
            role: 'style',
            referenceNumber: 1,
          },
          {
            mediaId: '00000000-0000-4000-8000-000000000004',
            role: 'color',
            referenceNumber: 1,
          },
        ],
      }).success,
    ).toBe(false)

    expect(
      createImage2BatchSchema.safeParse({
        projectId: 'project-image2',
        prompt: 'A quiet production still',
        references: Array.from({ length: IMAGE2_MAX_INPUT_IMAGES }, (_, index) => ({
          mediaId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
          role: 'style',
          referenceNumber: index + 1,
        })),
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
            label: '生图大师',
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
      providerName: '生图大师',
      model: IMAGE2_MODEL_ID,
      creditsPerImage: IMAGE2_CREDITS_PER_IMAGE,
    })
  })
})
