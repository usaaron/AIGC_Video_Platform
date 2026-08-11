import type { CreateGenerationTask, GenerationTask, Principal } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { FilmPreviewDispatcher } from '../../core/film/filmPreviewComposer.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'

const principal: Principal = {
  userId: 'user-member',
  tenantId: 'tenant-seqora-demo',
  roles: ['member'],
}

describe('GenerationService task creation', () => {
  it('uses charged repository creation and does not reserve credits separately', async () => {
    const input: CreateGenerationTask = {
      clientRequestId: 'service-atomic-create',
      projectId: 'project-midnight-film',
      kind: 'image',
      label: 'Service atomic task',
      provider: 'local',
      estimatedCredits: 6,
    }
    const task = generationTask(input)
    const repository = {
      canCreate: vi.fn(() => true),
      blockedPortraitNames: vi.fn(() => []),
      stringXPortraitNames: vi.fn(() => []),
      createWithCharge: vi.fn(async () => task),
    } as unknown as GenerationTaskRepository
    const dispatcher = {
      dispatch: vi.fn(async () => undefined),
    } as unknown as TaskDispatcher
    const service = new GenerationService(repository, dispatcher)

    await expect(service.createTask(input, principal, 'trace-service-create')).resolves.toMatchObject({
      id: task.id,
    })

    expect(repository.createWithCharge).toHaveBeenCalledWith(input, principal, {
      traceId: 'trace-service-create',
    })
    expect(dispatcher.dispatch).toHaveBeenCalledWith(task, { traceId: 'trace-service-create' })
  })

  it('captures the current storyboard prompt instead of trusting a stale client prompt', async () => {
    const input: CreateGenerationTask = {
      clientRequestId: 'snapshot-current-shot',
      projectId: 'project-midnight-film',
      kind: 'video',
      label: '镜头 01',
      prompt: 'stale compiled client prompt',
      provider: 'seedance',
      estimatedCredits: 18,
      metadata: { shotId: 'shot-1', continuityMode: 'independent', referenceAssetIds: [] },
    }
    const currentPrompt = [
      '场次：S02｜时长：5秒｜场景：废弃戏楼屋顶。',
      '0-2秒：侠客摘下斗笠。',
      '2-5秒：雷霆人抬起左臂挡开斗笠。',
    ].join('\n')
    const repository = {
      canCreate: vi.fn(() => true),
      storyboardVideoContext: vi.fn(() => ({
        project: {
          id: input.projectId,
          aspectRatio: '16:9',
          contentType: 'short-drama',
          visualStyle: 'cinematic-cg',
          version: 3,
        },
        shot: {
          id: 'shot-1',
          order: 1,
          title: '斗笠试探',
          framing: '低机位',
          duration: 5,
          prompt: currentPrompt,
          negativePrompt: '',
          continuityMode: 'independent',
          continuityNote: '',
          episodeNumber: 1,
          episodeBreakBefore: false,
          updatedAt: '2026-08-08T02:00:00.000Z',
        },
        shots: [],
        assets: [],
      })),
      blockedPortraitNames: vi.fn(() => []),
      stringXPortraitNames: vi.fn(() => []),
      createWithCharge: vi.fn(async (prepared: CreateGenerationTask) => generationTask(prepared)),
    } as unknown as GenerationTaskRepository
    const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as TaskDispatcher
    const service = new GenerationService(repository, dispatcher)

    const task = await service.createTask(input, principal)

    expect(task.prompt).toContain('斗笠试探')
    expect(task.prompt).toContain('场景：废弃戏楼屋顶')
    expect(task.prompt).toContain('0-2秒：侠客摘下斗笠。')
    expect(task.prompt).toContain('2-5秒：雷霆人抬起左臂挡开斗笠。')
    expect(task.prompt).not.toContain('stale compiled client prompt')
    expect(task.metadata).toMatchObject({
      sourcePromptSnapshot: currentPrompt,
      sourceShotUpdatedAt: '2026-08-08T02:00:00.000Z',
      sourceProjectVersion: 3,
    })
    expect(task.metadata.sourcePromptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(task.metadata.compiledPromptHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('GenerationService film preview idempotency', () => {
  it('reuses a failed automatic preview for the same source videos', async () => {
    const failed = previewTask('failed')
    const { service, repository, composer } = filmPreviewService([failed])

    await expect(service.createFilmPreview('project-midnight-film', principal)).resolves.toBe(failed)
    expect(repository.create).not.toHaveBeenCalled()
    expect(composer.start).not.toHaveBeenCalled()
  })

  it('never duplicates an active preview even when the user requests a retry', async () => {
    const running = previewTask('running')
    const { service, repository, composer } = filmPreviewService([running])

    await expect(service.createFilmPreview('project-midnight-film', principal, 'full', true)).resolves.toBe(
      running,
    )
    expect(repository.create).not.toHaveBeenCalled()
    expect(composer.start).not.toHaveBeenCalled()
  })

  it('allows an explicit user retry after a failed preview', async () => {
    const failed = previewTask('failed')
    const replacement = previewTask('queued')
    replacement.id = 'preview-retry'
    const { service, repository, composer } = filmPreviewService([failed], replacement)

    await expect(service.createFilmPreview('project-midnight-film', principal, 'full', true)).resolves.toBe(
      replacement,
    )
    expect(repository.create).toHaveBeenCalledOnce()
    expect(composer.start).toHaveBeenCalledWith(replacement)
  })
})

function generationTask(input: CreateGenerationTask): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: 'task-service-atomic-create',
    clientRequestId: input.clientRequestId,
    projectId: input.projectId,
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: input.kind,
    label: input.label,
    prompt: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    provider: input.provider,
    model: input.model ?? null,
    metadata: input.metadata ?? {},
    status: 'queued',
    progress: 0,
    estimatedCredits: input.estimatedCredits,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
  }
}

function previewTask(status: GenerationTask['status']): GenerationTask {
  const task = generationTask({
    clientRequestId: `preview-${status}`,
    projectId: 'project-midnight-film',
    kind: 'video',
    label: '完整预览',
    provider: 'local-compose',
    estimatedCredits: 0,
    metadata: {
      generationStage: 'film-preview',
      previewMode: 'full',
      sourceVideoTaskIds: ['video-1'],
    },
  })
  task.id = `preview-${status}`
  task.status = status
  return task
}

function filmPreviewService(existing: GenerationTask[], replacement = previewTask('queued')) {
  const sourceTask = generationTask({
    clientRequestId: 'video-1',
    projectId: 'project-midnight-film',
    kind: 'video',
    label: '镜头 1',
    provider: 'seedance',
    estimatedCredits: 18,
    metadata: { shotId: 'shot-1', providerTaskId: 'provider-video-1' },
  })
  sourceTask.id = 'video-1'
  sourceTask.status = 'completed'
  const repository = {
    canCreate: vi.fn(() => true),
    filmPreviewPlan: vi.fn(() => ({
      project: { id: 'project-midnight-film', name: '测试项目', aspectRatio: '9:16', version: 1 },
      shots: [{ id: 'shot-1', title: '镜头 1', duration: 4, episodeNumber: 1 }],
      sources: [{ shot: { id: 'shot-1', title: '镜头 1', duration: 4, episodeNumber: 1 }, task: sourceTask }],
    })),
    listByProject: vi.fn(async () => existing),
    create: vi.fn(async () => replacement),
  } as unknown as GenerationTaskRepository
  const dispatcher = { dispatch: vi.fn(async () => undefined) } as unknown as TaskDispatcher
  const composer = {
    recoverInterrupted: vi.fn(async () => undefined),
    start: vi.fn(async (task: GenerationTask) => task),
  } as unknown as FilmPreviewDispatcher
  return {
    service: new GenerationService(repository, dispatcher, null, 'stringx-seedance', null, composer),
    repository: repository as unknown as {
      create: ReturnType<typeof vi.fn>
    },
    composer: composer as unknown as {
      start: ReturnType<typeof vi.fn>
    },
  }
}
