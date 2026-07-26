import { describe, expect, it } from 'vitest'
import { createGenerationTaskSchema, generationTaskSchema } from './generation.js'

describe('generation contracts', () => {
  it('accepts retry caps on create requests and runtime lease fields on tasks', () => {
    expect(
      createGenerationTaskSchema.parse({
        clientRequestId: 'client-1',
        projectId: 'project-1',
        kind: 'video',
        label: '镜头 01',
        estimatedCredits: 18,
        maxAttempts: 2,
      }),
    ).toMatchObject({ maxAttempts: 2 })

    const now = new Date().toISOString()
    expect(
      generationTaskSchema.parse({
        id: 'task-1',
        clientRequestId: 'client-1',
        projectId: 'project-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        kind: 'video',
        label: '镜头 01',
        prompt: '',
        negativePrompt: '',
        provider: 'seedance',
        model: null,
        metadata: {},
        status: 'running',
        progress: 10,
        estimatedCredits: 18,
        createdAt: now,
        updatedAt: now,
        attempts: 1,
        maxAttempts: 2,
        leaseOwnerId: 'runner-1',
        leaseToken: 'lease-token-1',
        leaseAcquiredAt: now,
        leaseHeartbeatAt: now,
        leaseExpiresAt: now,
        resultUrl: null,
        outputs: [],
        error: null,
      }),
    ).toMatchObject({
      attempts: 1,
      maxAttempts: 2,
      leaseOwnerId: 'runner-1',
      leaseToken: 'lease-token-1',
    })
  })
})
