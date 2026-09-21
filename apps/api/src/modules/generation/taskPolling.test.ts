import { describe, expect, it, vi } from 'vitest'
import type { Principal } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import {
  listPollingTasks,
  listPollingTasksFromStore,
  readPollingVersion,
  readPollingVersionFromStore,
} from './taskPolling.js'

const memberPrincipal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

const videoRecoveryMetadata = {
  providerName: 'dora-router',
  providerSubmittedAt: '2026-09-21T00:00:00.000Z',
  providerProgressIsEstimated: true,
  providerFailureSource: 'status_poll',
  providerFailureCode: 'STATUS_POLL_UNAVAILABLE',
  providerPollErrors: 4,
  providerPollRetryNotBefore: '2026-09-21T00:01:00.000Z',
  providerReconciliationReason: 'poll_error',
  providerReconciliationStatus: 'pending',
  providerReconciliationHistoryOnly: false,
  creditsRefundedAt: '2026-09-21T00:30:00.000Z',
}

const internalVideoMetadata = {
  providerTaskId: 'private-remote-task',
  providerReconciliationClaimToken: 'private-claim-token',
  providerPollLastError: 'internal provider error',
  providerResultUrl: 'https://example.invalid/video?signature=private',
}

describe('generation task polling projection', () => {
  it('keeps only queue-facing metadata in the local projection', async () => {
    const store = new AppStore(null)
    await store.initialize()
    await store.mutate((state) => {
      state.tasks.unshift({
        id: 'polling-task',
        clientRequestId: 'polling-request',
        projectId: 'project-midnight-film',
        tenantId: memberPrincipal.tenantId,
        userId: memberPrincipal.userId,
        kind: 'text',
        label: '剧本生成',
        prompt: '完整提示词',
        negativePrompt: '',
        provider: 'text',
        model: 'deepseek-v4-flash',
        tier: null,
        metadata: {
          ...videoRecoveryMetadata,
          ...internalVideoMetadata,
          generationStage: 'script-generate',
          shotId: 'shot-1',
          textPreview: '预览内容',
          textResult: { script: '完整结果' },
          sourcePromptSnapshot: '不应进入轮询摘要',
        },
        status: 'running',
        progress: 40,
        estimatedCredits: 2,
        attempts: 1,
        maxAttempts: 3,
        leaseOwnerId: null,
        leaseToken: null,
        leaseAcquiredAt: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
        resultUrl: null,
        outputs: [{ id: 'output-1', url: '/full-output', mediaType: 'image', view: 'single' }],
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    })

    const tasks = listPollingTasksFromStore(store, 'project-midnight-film', memberPrincipal)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'polling-task',
      status: 'running',
      progress: 40,
      metadata: { generationStage: 'script-generate', shotId: 'shot-1', textPreview: '预览内容' },
    })
    expect(tasks[0]?.metadata).not.toHaveProperty('textResult')
    expect(tasks[0]?.metadata).not.toHaveProperty('sourcePromptSnapshot')
    expect(tasks[0]?.metadata).toMatchObject(videoRecoveryMetadata)
    for (const key of Object.keys(internalVideoMetadata)) {
      expect(tasks[0]?.metadata).not.toHaveProperty(key)
    }
    expect(tasks[0]).not.toHaveProperty('outputs')
  })

  it('uses a narrow database projection and tenant-scoped filters', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'db-polling-task',
          client_request_id: 'db-polling-request',
          project_id: 'project-midnight-film',
          kind: 'video',
          label: '镜头 01',
          provider: 'seedance',
          model: 'seedance-2.0',
          metadata: { providerState: 'running', ...videoRecoveryMetadata, ...internalVideoMetadata },
          status: 'running',
          progress: '55',
          estimated_credits: '18',
          result_url: null,
          error: null,
          created_at: new Date('2026-08-01T00:00:00.000Z'),
          updated_at: new Date('2026-08-01T00:00:01.000Z'),
        },
      ],
    }))

    const tasks = await listPollingTasks({ query }, 'project-midnight-film', memberPrincipal)

    expect(tasks[0]).toMatchObject({ id: 'db-polling-task', progress: 55, estimatedCredits: 18 })
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("jsonb_typeof(metadata->'queueHiddenAt') IS DISTINCT FROM 'string'"),
      ['project-midnight-film', memberPrincipal.tenantId, false, memberPrincipal.userId],
    )
    expect(query.mock.calls[0]?.[0]).not.toContain('negative_prompt')
    expect(query.mock.calls[0]?.[0]).toContain('jsonb_strip_nulls(jsonb_build_object(')
    expect(query.mock.calls[0]?.[0]).not.toMatch(/^\s*metadata,\s*$/m)
    expect(tasks[0]?.metadata).toMatchObject(videoRecoveryMetadata)
    for (const key of Object.keys(videoRecoveryMetadata)) {
      expect(query.mock.calls[0]?.[0]).toContain(`'${key}', metadata->'${key}'`)
    }
    for (const key of Object.keys(internalVideoMetadata)) {
      expect(query.mock.calls[0]?.[0]).not.toContain(`metadata->'${key}'`)
      expect(tasks[0]?.metadata).not.toHaveProperty(key)
    }
  })

  it('builds a stable version from queue-facing state only', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const first = readPollingVersionFromStore(store, 'project-midnight-film', memberPrincipal)
    const second = readPollingVersionFromStore(store, 'project-midnight-film', memberPrincipal)

    expect(first).toBe(second)
  })

  it('reads the version aggregate without selecting prompts or outputs', async () => {
    const query = vi.fn(async () => ({
      rows: [{ task_count: 3, latest_updated_at: new Date('2026-08-01T00:00:01.000Z'), signature: '42' }],
    }))

    await expect(readPollingVersion({ query }, 'project-midnight-film', memberPrincipal)).resolves.toBe(
      '3:2026-08-01T00:00:01.000Z:42',
    )
    expect(query.mock.calls[0]?.[0]).not.toContain('outputs')
    expect(query.mock.calls[0]?.[0]).not.toContain('prompt')
  })
})
