import type { AgentRun, GenerationTask, Principal } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import { AgentRunner } from './runner.js'

const principal: Principal = { userId: 'user-member', tenantId: 'tenant-seqora-demo', roles: ['member'] }

describe('AgentRunner', () => {
  it('advances a completed script stage without creating another task', async () => {
    const run = runFixture()
    run.stages[0]!.taskIds = ['script-task']
    const saved: AgentRun[] = []
    const repository = {
      claimNext: vi.fn(async () => structuredClone(run)),
      principalFor: vi.fn(async () => principal),
      saveClaimed: vi.fn(async (value: AgentRun) => {
        saved.push(structuredClone(value))
        return value
      }),
    }
    const projects = { workspace: vi.fn(async () => workspaceFixture('完整剧本正文')) }
    const generations = {
      listProjectTasks: vi.fn(async () => [taskFixture({ id: 'script-task', status: 'completed' })]),
      createTask: vi.fn(),
    }

    const runner = new AgentRunner(repository as never, projects as never, generations as never)
    await runner.tick()

    expect(generations.createTask).not.toHaveBeenCalled()
    expect(saved[0]).toMatchObject({ status: 'running', currentStage: 'asset-analysis' })
    expect(saved[0]!.stages[0]).toMatchObject({ status: 'completed', output: { scriptLength: 6 } })
  })

  it('waits for a running upstream task before pausing the run', async () => {
    const run = runFixture()
    run.status = 'pausing'
    run.pauseRequested = true
    run.stages[0]!.taskIds = ['script-task']
    const repository = {
      claimNext: vi.fn(async () => structuredClone(run)),
      principalFor: vi.fn(async () => principal),
      saveClaimed: vi.fn(async (value: AgentRun) => value),
    }
    const generations = {
      listProjectTasks: vi.fn(async () => [taskFixture({ id: 'script-task', status: 'running' })]),
      pauseTask: vi.fn(),
    }
    const runner = new AgentRunner(repository as never, {} as never, generations as never)
    await runner.tick()

    expect(repository.saveClaimed).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pausing', pauseRequested: true }),
      expect.any(String),
    )
    expect(generations.pauseTask).not.toHaveBeenCalled()
  })
})

function runFixture(): AgentRun {
  const now = new Date().toISOString()
  const keys = [
    'script',
    'asset-analysis',
    'asset-generation',
    'identity-baseline',
    'storyboard',
    'video-generation',
    'film-compose',
    'delivery',
  ] as const
  return {
    id: 'f886fb7d-ec0b-47f7-8dd4-cb54fdc6a30c',
    clientRequestId: 'confirmed-run',
    tenantId: principal.tenantId,
    userId: principal.userId,
    projectId: 'agent-project',
    originalPrompt: '完整要求',
    status: 'running',
    pauseRequested: false,
    currentStage: 'script',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    completedAt: null,
    deliveries: [],
    plan: {
      contentType: 'web-series',
      durationSeconds: 60,
      episodeDurationSeconds: 60,
      episodeCount: 1,
      aspectRatio: '9:16',
      visualStyle: 'cinematic-cg',
      storyBrief: '女孩发现时间循环。',
      projectName: '时间循环',
      missingFields: [],
      estimate: {
        scriptCredits: 4,
        assetCredits: 20,
        videoCredits: 270,
        totalCredits: 294,
        estimatedShots: 15,
        estimatedAssets: 4,
        estimatedEpisodes: 1,
        minMinutes: 30,
        maxMinutes: 90,
      },
    },
    stages: keys.map((key) => ({
      key,
      status: 'pending',
      taskIds: [],
      attempt: 0,
      output: {},
      error: null,
      startedAt: null,
      completedAt: null,
    })),
  }
}

function taskFixture(input: { id: string; status: GenerationTask['status'] }): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: input.id,
    clientRequestId: input.id,
    projectId: 'agent-project',
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: 'text',
    label: 'Script',
    prompt: '',
    negativePrompt: '',
    provider: 'text',
    model: 'glm-5.2',
    metadata: { agentAttempt: 0 },
    status: input.status,
    progress: input.status === 'completed' ? 100 : 50,
    estimatedCredits: 3,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}

function workspaceFixture(script: string) {
  const now = new Date().toISOString()
  return {
    project: {
      id: 'agent-project',
      tenantId: principal.tenantId,
      ownerId: principal.userId,
      name: '时间循环',
      contentType: 'short-drama',
      visualStyle: 'cinematic-cg',
      episodeDurationSeconds: 60,
      aspectRatio: '9:16',
      status: 'producing',
      synopsis: '',
      script,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    assets: [],
    shots: [],
  }
}
