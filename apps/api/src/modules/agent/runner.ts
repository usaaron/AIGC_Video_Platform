import {
  AGENT_CREDIT_COSTS,
  DEFAULT_SCRIPT_DIRECTION,
  DEFAULT_SCRIPT_MODEL,
  type AgentRun,
  type AgentRunStage,
  type Asset,
  type CreateGenerationTask,
  type GenerationTask,
  type Principal,
  type Shot,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type { GenerationService } from '../generation/service.js'
import type { ProjectService } from '../projects/service.js'
import type { AgentRunRepository } from './repository.js'
import { assetReferenceUrl, selectAgentShotReferences } from './referenceSelector.js'

const TERMINAL_FAILURES = new Set<GenerationTask['status']>(['failed', 'cancelled'])

export class AgentRunner {
  private readonly ownerId = `agent-runner-${process.pid}-${randomUUID()}`
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(
    private readonly repository: AgentRunRepository,
    private readonly projectServiceProvider: ProjectService | (() => ProjectService | null),
    private readonly generationServiceProvider: GenerationService | (() => GenerationService | null),
  ) {}

  start(intervalMs = 5_000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await this.tickOnce()
    } finally {
      this.ticking = false
    }
  }

  private async tickOnce(): Promise<void> {
    const run = await this.repository.claimNext(this.ownerId)
    if (!run) return
    try {
      await this.advance(run)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stage = currentStage(run)
      if (stage) {
        stage.status = 'failed'
        stage.error = message.slice(0, 2_000)
      }
      run.status = 'failed'
      run.lastError = message.slice(0, 2_000)
      run.updatedAt = new Date().toISOString()
    }
    await this.repository.saveClaimed(run, this.ownerId)
  }

  private async advance(run: AgentRun): Promise<void> {
    if (!run.projectId) throw new Error('Agent run is missing its project')
    const principal = await this.repository.principalFor(run)
    if (run.pauseRequested) {
      await this.applyPause(run, principal)
      return
    }
    if (run.status === 'pausing') run.status = 'running'
    const stage = currentStage(run)
    if (!stage) return
    if (stage.status === 'paused') await this.resumeStageTasks(run, stage, principal)
    markStarted(stage)

    switch (stage.key) {
      case 'script':
        await this.advanceScript(run, stage, principal)
        break
      case 'asset-analysis':
        await this.advanceAssetAnalysis(run, stage, principal)
        break
      case 'asset-generation':
        await this.advanceAssetGeneration(run, stage, principal)
        break
      case 'identity-baseline':
        await this.advanceIdentityBaseline(run, stage, principal)
        break
      case 'storyboard':
        await this.advanceStoryboard(run, stage, principal)
        break
      case 'video-generation':
        await this.advanceVideos(run, stage, principal)
        break
      case 'film-compose':
        await this.advanceFilmCompose(run, stage, principal)
        break
      case 'delivery':
        await this.advanceDelivery(run, stage, principal)
        break
    }
    run.updatedAt = new Date().toISOString()
  }

  private async advanceScript(run: AgentRun, stage: AgentRunStage, principal: Principal): Promise<void> {
    const tasks = currentAttemptTasks(await this.stageTasks(run, stage, principal), stage)
    const completed = latestCompleted(tasks)
    if (completed) {
      const workspace = await this.projects().workspace(run.projectId!, principal)
      if (!workspace.project.script.trim()) throw new Error('剧本任务已完成，但项目没有写入剧本文本')
      stage.output = { scriptLength: workspace.project.script.length }
      completeStage(run, stage)
      return
    }
    assertNoTerminalFailure(tasks)
    if (tasks.some(isActive)) {
      stage.status = 'waiting'
      return
    }
    const task = await this.generations().createTask(
      {
        clientRequestId: requestId(run, stage, 'script'),
        projectId: run.projectId!,
        kind: 'text',
        label: `${run.plan.projectName} · Agent 智能生成剧本`,
        provider: 'text',
        model: DEFAULT_SCRIPT_MODEL,
        estimatedCredits: AGENT_CREDIT_COSTS.script,
        metadata: {
          generationStage: 'script-generate',
          agentRunId: run.id,
          agentStage: stage.key,
          agentAttempt: stage.attempt,
          scriptOperation: 'generate',
          billingMode: 'prepaid',
          draft: run.plan.storyBrief,
          direction: { ...DEFAULT_SCRIPT_DIRECTION, style: run.plan.visualStyle },
          mode: 'quick',
          segment: {
            goal: `生成总时长约 ${run.plan.durationSeconds} 秒、共 ${run.plan.episodeCount} 集的可制作剧本`,
            targetMinutes: Math.max(1, Math.ceil(run.plan.durationSeconds! / 60)),
            targetSeconds: Math.min(900, run.plan.durationSeconds!),
          },
          productionMode: run.plan.contentType === 'web-series' ? 'web-series' : 'short-video',
          episodeMinutes: Math.max(1, Math.ceil(run.plan.durationSeconds! / 60)),
          // Script generation covers the complete run; storyboard assignment later
          // uses the per-episode duration stored in the project.
          episodeDurationSeconds: run.plan.durationSeconds,
          revisionNote: `总时长 ${run.plan.durationSeconds} 秒，共 ${run.plan.episodeCount} 集。必须按集、场次输出可直接拆分镜的中文剧本，严格覆盖用户故事要求。`,
        },
      },
      principal,
    )
    stage.taskIds.push(task.id)
    stage.status = 'waiting'
  }

  private async advanceAssetAnalysis(
    run: AgentRun,
    stage: AgentRunStage,
    principal: Principal,
  ): Promise<void> {
    const tasks = currentAttemptTasks(await this.stageTasks(run, stage, principal), stage)
    const completed = latestCompleted(tasks)
    if (!completed) {
      assertNoTerminalFailure(tasks)
      if (tasks.some(isActive)) {
        stage.status = 'waiting'
        return
      }
      const workspace = await this.projects().workspace(run.projectId!, principal)
      const task = await this.generations().createTask(
        {
          clientRequestId: requestId(run, stage, 'analysis'),
          projectId: run.projectId!,
          kind: 'text',
          label: `${run.plan.projectName} · Agent 资产分析`,
          provider: 'text',
          model: DEFAULT_SCRIPT_MODEL,
          estimatedCredits: AGENT_CREDIT_COSTS.assetAnalysis,
          metadata: {
            generationStage: 'script-asset-suggestions',
            agentRunId: run.id,
            agentStage: stage.key,
            agentAttempt: stage.attempt,
            scriptOperation: 'suggest-assets',
            billingMode: 'prepaid',
            script: workspace.project.script,
            direction: { ...DEFAULT_SCRIPT_DIRECTION, style: run.plan.visualStyle },
          },
        },
        principal,
      )
      stage.taskIds.push(task.id)
      stage.status = 'waiting'
      return
    }

    const result = completed.metadata.textResult as { assets?: unknown[] } | undefined
    if (!Array.isArray(result?.assets)) throw new Error('资产分析任务没有返回可写入的资产建议')
    const workspace = await this.projects().workspace(run.projectId!, principal)
    const createdIds: string[] = []
    for (const raw of result.assets.slice(0, run.plan.estimate!.estimatedAssets)) {
      const suggestion = raw as Record<string, unknown>
      const name = typeof suggestion.name === 'string' ? suggestion.name : ''
      const kind = typeof suggestion.kind === 'string' ? suggestion.kind : ''
      if (!name || !kind) continue
      const existing = workspace.assets.find((asset) => asset.kind === kind && asset.name === name)
      if (existing) {
        createdIds.push(existing.id)
        continue
      }
      const asset = await this.projects().createAsset(
        run.projectId!,
        {
          kind: kind as Asset['kind'],
          sourceMode: 'generate',
          name,
          description: String(suggestion.description ?? ''),
          prompt: String(suggestion.prompt ?? ''),
          negativePrompt: String(suggestion.negativePrompt ?? ''),
          attributes: suggestion.attributes as Asset['attributes'],
          promptMode: 'standard',
          customPromptMode: 'append',
          customPrompt: '',
          references: [],
          imageUrl: null,
        },
        principal,
      )
      createdIds.push(asset.id)
      workspace.assets.push(asset)
    }
    stage.output = { assetIds: createdIds }
    completeStage(run, stage)
  }

  private async advanceAssetGeneration(
    run: AgentRun,
    stage: AgentRunStage,
    principal: Principal,
  ): Promise<void> {
    const workspace = await this.projects().workspace(run.projectId!, principal)
    const required = workspace.assets.filter((asset) => asset.kind !== 'audio')
    const tasks = await this.stageTasks(run, stage, principal)
    for (const asset of required) {
      const assetTasks = tasks.filter((task) => task.metadata.assetId === asset.id)
      if (latestCompleted(assetTasks)) continue
      const attemptTasks = currentAttemptTasks(assetTasks, stage)
      assertNoTerminalFailure(attemptTasks)
      if (attemptTasks.some(isActive)) continue
      const isCharacter = asset.attributes.type === 'character'
      const task = await this.generations().createTask(
        {
          clientRequestId: requestId(run, stage, asset.id),
          projectId: run.projectId!,
          kind: 'image',
          label: `${asset.name} · ${isCharacter ? '面部大头照' : '资产图'}`,
          prompt: isCharacter ? characterFacePrompt(asset) : asset.prompt,
          negativePrompt: asset.negativePrompt,
          provider: 'img2',
          model: 'img2-default',
          estimatedCredits: isCharacter ? AGENT_CREDIT_COSTS.characterFace : AGENT_CREDIT_COSTS.assetImage,
          metadata: {
            agentRunId: run.id,
            agentStage: stage.key,
            agentAttempt: stage.attempt,
            assetId: asset.id,
            assetKind: asset.kind,
            generationStage: isCharacter ? 'face' : 'asset',
            aspectRatio: isCharacter ? '1:1' : run.plan.aspectRatio,
            sourceMode: 'generate',
            references: asset.references,
            attributes: asset.attributes,
          },
        },
        principal,
      )
      stage.taskIds.push(task.id)
    }

    const refreshed = await this.stageTasks(run, stage, principal)
    const incomplete = required.filter(
      (asset) => !latestCompleted(refreshed.filter((task) => task.metadata.assetId === asset.id)),
    )
    if (incomplete.length) {
      stage.status = 'waiting'
      return
    }
    for (const asset of required) {
      if (asset.attributes.type !== 'character') continue
      const task = latestCompleted(refreshed.filter((item) => item.metadata.assetId === asset.id))!
      const url = task.resultUrl
      if (!url) throw new Error(`${asset.name} 的面部任务完成但没有图片输出`)
      await this.projects().updateAsset(
        run.projectId!,
        asset.id,
        {
          imageUrl: url,
          attributes: {
            ...asset.attributes,
            faceStatus: 'approved',
            faceReference: { id: task.id, url, name: `${asset.name}-face.png` },
          },
        },
        principal,
      )
    }
    stage.output = { generatedAssets: required.length }
    completeStage(run, stage)
  }

  private async advanceIdentityBaseline(
    run: AgentRun,
    stage: AgentRunStage,
    principal: Principal,
  ): Promise<void> {
    if (run.plan.visualStyle !== 'photorealistic') {
      stage.status = 'skipped'
      stage.completedAt = new Date().toISOString()
      moveNext(run, stage)
      return
    }
    const workspace = await this.projects().workspace(run.projectId!, principal)
    const characters = workspace.assets.filter(
      (asset) => asset.attributes.type === 'character' && asset.attributes.subjectType === 'human',
    )
    const tasks = await this.stageTasks(run, stage, principal)
    for (const asset of characters) {
      if (asset.attributes.type !== 'character' || asset.attributes.trustedPortrait?.status === 'active')
        continue
      const assetTasks = tasks.filter((task) => task.metadata.assetId === asset.id)
      if (latestCompleted(assetTasks)) continue
      const attemptTasks = currentAttemptTasks(assetTasks, stage)
      assertNoTerminalFailure(attemptTasks)
      if (attemptTasks.some(isActive)) continue
      const task = await this.generations().createTask(
        {
          clientRequestId: requestId(run, stage, asset.id),
          projectId: run.projectId!,
          kind: 'text',
          label: `${asset.name} · 创建 AI 人像资源`,
          provider: 'asset-library',
          estimatedCredits: AGENT_CREDIT_COSTS.trustedPortrait,
          metadata: {
            agentRunId: run.id,
            agentStage: stage.key,
            agentAttempt: stage.attempt,
            generationStage: 'trusted-portrait',
            trustedAssetOperation: 'register-virtual',
            assetId: asset.id,
          },
        },
        principal,
      )
      stage.taskIds.push(task.id)
    }
    const refreshed = await this.stageTasks(run, stage, principal)
    if (
      characters.some(
        (asset) => !latestCompleted(refreshed.filter((task) => task.metadata.assetId === asset.id)),
      )
    ) {
      stage.status = 'waiting'
      return
    }
    stage.output = { registeredCharacters: characters.length }
    completeStage(run, stage)
  }

  private async advanceStoryboard(run: AgentRun, stage: AgentRunStage, principal: Principal): Promise<void> {
    const workspace = await this.projects().workspace(run.projectId!, principal)
    if (!workspace.shots.length) {
      const shots = await this.projects().generateShots(
        run.projectId!,
        {
          maxShots: run.plan.estimate!.estimatedShots,
          mode: 'beat',
          episodeDurationSeconds: run.plan.episodeDurationSeconds!,
        },
        principal,
      )
      if (!shots?.length) throw new Error('智能分镜没有生成任何镜头')
      stage.output = { shotIds: shots.map((shot) => shot.id), shotCount: shots.length }
    } else {
      stage.output = { shotIds: workspace.shots.map((shot) => shot.id), shotCount: workspace.shots.length }
    }
    completeStage(run, stage)
  }

  private async advanceVideos(run: AgentRun, stage: AgentRunStage, principal: Principal): Promise<void> {
    const workspace = await this.projects().workspace(run.projectId!, principal)
    const shots = [...workspace.shots].sort((left, right) => left.order - right.order)
    if (!shots.length) throw new Error('项目没有可生成的视频分镜')
    const tasks = await this.stageTasks(run, stage, principal)

    for (const episode of new Set(shots.map((shot) => shot.episodeNumber))) {
      const episodeShots = shots.filter((shot) => shot.episodeNumber === episode)
      for (let index = 0; index < episodeShots.length; index += 1) {
        const shot = episodeShots[index]!
        const shotTasks = tasks.filter((task) => task.metadata.shotId === shot.id)
        if (latestCompleted(shotTasks)) continue
        const attemptTasks = currentAttemptTasks(shotTasks, stage)
        assertNoTerminalFailure(attemptTasks)
        if (attemptTasks.some(isActive)) continue
        const previousShot = index > 0 ? episodeShots[index - 1] : null
        const previousTask = previousShot
          ? latestCompleted(tasks.filter((task) => task.metadata.shotId === previousShot.id))
          : null
        if (previousShot && !previousTask) break
        const references = selectAgentShotReferences(workspace.assets, shot)
        const urls = references.map(assetReferenceUrl).filter((value): value is string => Boolean(value))
        const task = await this.generations().createTask(
          videoTaskInput(run, stage, shot, references, urls, previousTask),
          principal,
        )
        stage.taskIds.push(task.id)
        tasks.push(task)
        break
      }
    }

    const refreshed = await this.stageTasks(run, stage, principal)
    const allCompleted = shots.every((shot) =>
      latestCompleted(refreshed.filter((task) => task.metadata.shotId === shot.id)),
    )
    if (!allCompleted) {
      stage.status = 'waiting'
      return
    }
    stage.output = { videoCount: shots.length }
    completeStage(run, stage)
  }

  private async advanceFilmCompose(run: AgentRun, stage: AgentRunStage, principal: Principal): Promise<void> {
    const workspace = await this.projects().workspace(run.projectId!, principal)
    const episodes = [...new Set(workspace.shots.map((shot) => shot.episodeNumber))].sort((a, b) => a - b)
    const tasks = await this.stageTasks(run, stage, principal)
    for (const episode of episodes) {
      const episodeTasks = tasks.filter((task) => Number(task.metadata.episodeNumber) === episode)
      if (latestCompleted(episodeTasks) || episodeTasks.some(isActive)) continue
      const task = await this.generations().createFilmPreview(
        run.projectId!,
        principal,
        'full',
        stage.attempt > 0,
        episode,
      )
      if (!stage.taskIds.includes(task.id)) stage.taskIds.push(task.id)
    }
    const refreshed = await this.stageTasks(run, stage, principal)
    const unresolvedFailure = episodes
      .map((episode) => refreshed.filter((task) => Number(task.metadata.episodeNumber) === episode))
      .find((episodeTasks) => !latestCompleted(episodeTasks) && !episodeTasks.some(isActive))
      ?.find((task) => TERMINAL_FAILURES.has(task.status))
    if (unresolvedFailure) throw new Error(unresolvedFailure.error || `${unresolvedFailure.label}合成失败`)
    if (
      episodes.some(
        (episode) =>
          !latestCompleted(refreshed.filter((task) => Number(task.metadata.episodeNumber) === episode)),
      )
    ) {
      stage.status = 'waiting'
      return
    }
    stage.output = { episodeCount: episodes.length }
    completeStage(run, stage)
  }

  private async advanceDelivery(run: AgentRun, stage: AgentRunStage, principal: Principal): Promise<void> {
    const composeStage = run.stages.find((item) => item.key === 'film-compose')!
    const tasks = await this.stageTasks(run, composeStage, principal)
    const workspace = await this.projects().workspace(run.projectId!, principal)
    run.deliveries = tasks
      .filter((task) => task.status === 'completed' && task.resultUrl)
      .map((task) => {
        const episodeNumber = Number(task.metadata.episodeNumber) || 1
        return {
          episodeNumber,
          taskId: task.id,
          title: `${workspace.project.name} · 第 ${episodeNumber} 集`,
          durationSeconds: Number(task.metadata.duration) || run.plan.episodeDurationSeconds!,
          url: task.resultUrl!,
          completedAt: task.updatedAt,
        }
      })
      .sort((left, right) => left.episodeNumber - right.episodeNumber)
    if (!run.deliveries.length) throw new Error('成片任务已结束，但没有可交付的视频')
    stage.output = { deliveries: run.deliveries.length }
    stage.status = 'completed'
    stage.completedAt = new Date().toISOString()
    run.status = 'completed'
    run.currentStage = null
    run.completedAt = stage.completedAt
    run.lastError = null
  }

  private async stageTasks(
    run: AgentRun,
    stage: AgentRunStage,
    principal: Principal,
  ): Promise<GenerationTask[]> {
    if (!run.projectId || !stage.taskIds.length) return []
    const all = await this.generations().listProjectTasks(run.projectId, principal)
    return all.filter((task) => stage.taskIds.includes(task.id))
  }

  private async applyPause(run: AgentRun, principal: Principal): Promise<void> {
    const stage = currentStage(run)
    if (!stage) return
    const tasks = await this.stageTasks(run, stage, principal)
    for (const task of tasks.filter((item) => item.status === 'queued')) {
      await this.generations()
        .pauseTask(task.id, principal)
        .catch(() => {})
    }
    if (tasks.some((task) => task.status === 'running')) {
      run.status = 'pausing'
      run.updatedAt = new Date().toISOString()
      return
    }
    stage.status = 'paused'
    run.status = 'paused'
    run.updatedAt = new Date().toISOString()
  }

  private async resumeStageTasks(run: AgentRun, stage: AgentRunStage, principal: Principal): Promise<void> {
    const tasks = await this.stageTasks(run, stage, principal)
    for (const task of tasks.filter((item) => item.status === 'paused')) {
      await this.generations().resumeTask(task.id, principal)
    }
    stage.status = 'waiting'
  }

  private projects(): ProjectService {
    const service =
      typeof this.projectServiceProvider === 'function'
        ? this.projectServiceProvider()
        : this.projectServiceProvider
    if (!service) throw new Error('Agent project service is not ready')
    return service
  }

  private generations(): GenerationService {
    const service =
      typeof this.generationServiceProvider === 'function'
        ? this.generationServiceProvider()
        : this.generationServiceProvider
    if (!service) throw new Error('Agent generation service is not ready')
    return service
  }
}

function videoTaskInput(
  run: AgentRun,
  stage: AgentRunStage,
  shot: Shot,
  references: Asset[],
  urls: string[],
  previousTask: GenerationTask | null,
): CreateGenerationTask {
  const continuityMode = previousTask ? 'continue' : 'independent'
  return {
    clientRequestId: requestId(run, stage, shot.id),
    projectId: run.projectId!,
    kind: 'video',
    label: `镜头 ${String(shot.order).padStart(2, '0')} · ${shot.title}`,
    prompt: shot.prompt,
    negativePrompt: shot.negativePrompt,
    provider: 'seedance',
    model: 'doubao-seedance-2-0-260128',
    estimatedCredits: AGENT_CREDIT_COSTS.videoShot,
    maxAttempts: 3,
    metadata: {
      agentRunId: run.id,
      agentStage: stage.key,
      agentAttempt: stage.attempt,
      shotId: shot.id,
      duration: shot.duration,
      requestedDuration: shot.duration,
      aspectRatio: run.plan.aspectRatio,
      resolution: '720p',
      generateAudio: true,
      watermark: false,
      returnLastFrame: true,
      continuityMode,
      ...(previousTask ? { continuitySourceTaskId: previousTask.id } : {}),
      images: urls,
      videoInputMode: previousTask ? 'continuity-and-assets' : references.length ? 'assets' : 'text',
      referenceAssetIds: references.map((asset) => asset.id),
    },
  }
}

function characterFacePrompt(asset: Asset): string {
  return [
    asset.name,
    asset.description,
    asset.prompt,
    '人物面部大头照，头部和肩部完整入镜，正面平视镜头，自然中性表情，五官清晰可调整',
    '均匀平光，纯净背景，画面比例1:1，不出现手部、前爪、全身、文字、水印和饰边',
  ]
    .filter(Boolean)
    .join('，')
}

function currentStage(run: AgentRun): AgentRunStage | null {
  return run.currentStage ? (run.stages.find((stage) => stage.key === run.currentStage) ?? null) : null
}

function markStarted(stage: AgentRunStage): void {
  if (!stage.startedAt) stage.startedAt = new Date().toISOString()
  if (stage.status === 'pending') stage.status = 'running'
}

function completeStage(run: AgentRun, stage: AgentRunStage): void {
  stage.status = 'completed'
  stage.error = null
  stage.completedAt = new Date().toISOString()
  moveNext(run, stage)
}

function moveNext(run: AgentRun, stage: AgentRunStage): void {
  const index = run.stages.findIndex((item) => item.key === stage.key)
  const next = run.stages[index + 1]
  run.currentStage = next?.key ?? null
  run.status = next ? 'running' : 'completed'
  run.lastError = null
}

function latestCompleted(tasks: GenerationTask[]): GenerationTask | null {
  return (
    [...tasks]
      .filter((task) => task.status === 'completed')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  )
}

function assertNoTerminalFailure(tasks: GenerationTask[]): void {
  const failed = tasks.find((task) => TERMINAL_FAILURES.has(task.status))
  if (failed) throw new Error(failed.error || `${failed.label}生成失败`)
}

function currentAttemptTasks(tasks: GenerationTask[], stage: AgentRunStage): GenerationTask[] {
  return tasks.filter((task) => Number(task.metadata.agentAttempt ?? 0) === stage.attempt)
}

function isActive(task: GenerationTask): boolean {
  return ['queued', 'paused', 'running'].includes(task.status)
}

function requestId(run: AgentRun, stage: AgentRunStage, item: string): string {
  return `agent-${run.id.slice(0, 8)}-${stage.key}-${stage.attempt}-${item}`.slice(0, 128)
}
