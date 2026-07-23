import type { GenerationTask } from '@seqora/contracts'
import {
  compileQualityRules,
  compileStoryboardVideoPrompt,
  normalizedVideoDuration,
  QUALITY_RULE_VERSION,
  VIDEO_PROMPT_VERSION,
} from '@seqora/prompting'
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageReference,
} from '../generation/imageProvider.js'
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoProviderName,
} from '../generation/videoProvider.js'
import type { AppStore } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'

export interface TaskDispatcher {
  dispatch(task: GenerationTask): Promise<void>
}

type GenerationTaskRunnerOptions = {
  videoProvider?: VideoGenerationProvider | null
  videoProviderName?: VideoProviderName
  imageProvider?: ImageGenerationProvider | null
  objectStorage?: ObjectStorage | null
  providerPollIntervalMs?: number
  onVideoCompleted?: (task: GenerationTask) => Promise<void>
}

type GeneratedOutputDescriptor = {
  view: GenerationTask['outputs'][number]['view']
  storageKey: string
  contentType: string
  size: number
}

export class GenerationTaskRunner implements TaskDispatcher {
  private timer: NodeJS.Timeout | null = null
  private tickPromise: Promise<void> | null = null
  private readonly videoProvider: VideoGenerationProvider | null
  private readonly videoProviderName: VideoProviderName
  private readonly imageProvider: ImageGenerationProvider | null
  private readonly objectStorage: ObjectStorage | null
  private readonly providerPollIntervalMs: number
  private readonly onVideoCompleted: ((task: GenerationTask) => Promise<void>) | null

  constructor(
    private readonly store: AppStore,
    options: GenerationTaskRunnerOptions = {},
  ) {
    this.videoProvider = options.videoProvider ?? null
    this.videoProviderName = options.videoProviderName ?? 'stringx-seedance'
    this.imageProvider = options.imageProvider ?? null
    this.objectStorage = options.objectStorage ?? null
    this.providerPollIntervalMs = options.providerPollIntervalMs ?? 5_000
    this.onVideoCompleted = options.onVideoCompleted ?? null
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 900)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async dispatch(_task: GenerationTask): Promise<void> {
    void this.tick().catch(() => {})
  }

  async tick(): Promise<void> {
    if (this.tickPromise) return this.tickPromise

    const tickPromise = this.runTick()
    this.tickPromise = tickPromise

    try {
      await tickPromise
    } finally {
      if (this.tickPromise === tickPromise) this.tickPromise = null
    }
  }

  private async runTick(): Promise<void> {
    await this.recoverStatusParseFailures()
    await this.refundFailedTasks()
    const hasActiveTasks = this.store.read((state) =>
      state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
    )
    if (!hasActiveTasks) return

    const remoteTasks = await this.store.mutate((state) => {
      const now = new Date().toISOString()
      const selectedRemoteTasks: Array<{ task: GenerationTask; providerName: string }> = []

      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            isRemoteProviderName(task.metadata.providerName) &&
            task.metadata.providerState === 'submitting' &&
            !task.metadata.providerTaskId,
        )
        .forEach((task) => {
          task.status = 'failed'
          task.progress = 100
          task.error = '第三方生成提交过程被中断，请重新生成此任务'
          task.updatedAt = now
        })

      for (const user of state.users) {
        const userTasks = state.tasks.filter((task) => task.userId === user.id)
        userTasks
          .filter((task) => task.status === 'queued' && dependencyState(task, userTasks) === 'failed')
          .forEach((task) => {
            task.status = 'failed'
            task.progress = 100
            task.error = continuityDependencyMissingFrame(task, userTasks)
              ? '上一镜头尾帧提取失败，当前连续镜头未提交；请重新生成上一镜头'
              : '前置生成任务失败或不存在，当前任务未提交'
            task.updatedAt = now
          })
        const running = userTasks.filter(
          (task) => task.status === 'running' && task.provider !== 'local-compose',
        )
        const available = Math.max(0, (user.plan === 'member' ? 3 : 1) - running.length)
        userTasks
          .filter((task) => task.status === 'queued' && dependencyState(task, userTasks) === 'ready')
          .slice(0, available)
          .forEach((task) => {
            const providerName = this.remoteProviderName(task)
            task.status = 'running'
            task.progress = providerName ? 1 : 8
            task.updatedAt = now
            if (providerName) {
              task.metadata = {
                ...task.metadata,
                providerName,
                providerState: 'submitting',
              }
              selectedRemoteTasks.push({ task, providerName })
            }
          })
      }

      return selectedRemoteTasks
    })

    await this.refundFailedTasks()
    await Promise.all(
      remoteTasks.map(async (remote) => {
        if (isVideoProviderName(remote.providerName)) await this.submitRemoteVideo(remote.task)
        if (remote.providerName === 'tokenadvent-img2') await this.generateRemoteImage(remote.task)
      }),
    )

    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'running' &&
            task.provider !== 'local-compose' &&
            !isRemoteProviderName(task.metadata.providerName),
        )
        .forEach((task) => {
          task.progress = Math.min(100, task.progress + 12)
          task.updatedAt = now
          if (task.progress >= 100) {
            task.status = 'completed'
            task.outputs = outputsFor(task)
            task.resultUrl = task.outputs[0]?.url ?? null
          }
        })
    })

    await this.pollRemoteVideos()
  }

  private async recoverStatusParseFailures(): Promise<void> {
    await this.store.mutate((state) => {
      const now = new Date().toISOString()
      state.tasks
        .filter(
          (task) =>
            task.status === 'failed' &&
            task.metadata.providerName === this.videoProviderName &&
            typeof task.metadata.providerTaskId === 'string' &&
            typeof task.metadata.queueHiddenAt !== 'string' &&
            task.error?.includes('"invalid_value"') &&
            task.error.includes('"status"'),
        )
        .forEach((task) => {
          task.status = 'running'
          task.progress = 50
          task.error = null
          task.updatedAt = now
          task.metadata = {
            ...task.metadata,
            providerState: 'running',
            providerPolledAt: 0,
            providerPollErrors: 0,
            statusParseRecoveredAt: now,
          }
        })
    })
  }

  private remoteProviderName(task: GenerationTask): string | null {
    if (this.videoProvider && task.kind === 'video' && task.provider === 'seedance') {
      return this.videoProviderName
    }
    if (this.imageProvider && this.objectStorage && task.kind === 'image' && task.provider === 'img2') {
      return 'tokenadvent-img2'
    }
    return null
  }

  private async submitRemoteVideo(task: GenerationTask): Promise<void> {
    try {
      const preparedTask = await this.prepareStoryboardVideoTask(task)
      const submission = await this.videoProvider!.submit(
        videoRequestFor(preparedTask, await this.resolveVideoImages(preparedTask)),
      )
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (!stored || stored.status !== 'running') return
        stored.progress = Math.max(1, submission.progress)
        stored.metadata = {
          ...stored.metadata,
          providerState: submission.status,
          providerTaskId: submission.providerTaskId,
          providerPolledAt: Date.now(),
          providerPollErrors: 0,
        }
        stored.updatedAt = new Date().toISOString()
      })
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  private prepareStoryboardVideoTask(task: GenerationTask): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored) return task
      const shotId = typeof stored.metadata.shotId === 'string' ? stored.metadata.shotId : null
      const project = state.projects.find(
        (item) => item.id === stored.projectId && item.tenantId === stored.tenantId,
      )
      const shot = state.shots.find(
        (item) =>
          item.id === shotId && item.projectId === stored.projectId && item.tenantId === stored.tenantId,
      )
      if (!project || !shot) return stored

      const assets = state.assets.filter(
        (asset) => asset.projectId === stored.projectId && asset.tenantId === stored.tenantId,
      )
      const shots = state.shots
        .filter((item) => item.projectId === stored.projectId && item.tenantId === stored.tenantId)
        .sort((left, right) => left.order - right.order)
      const referenceAssetIds = Array.isArray(stored.metadata.referenceAssetIds)
        ? stored.metadata.referenceAssetIds.filter((id): id is string => typeof id === 'string')
        : []
      const referenceAssets = referenceAssetIds
        .map((id) => assets.find((asset) => asset.id === id))
        .filter((asset): asset is (typeof assets)[number] => Boolean(asset))
      const blockedPortraits = referenceAssets.filter((asset) => {
        if (asset.attributes.type !== 'character' || asset.attributes.subjectType !== 'human') return false
        const needsTrustedPortrait =
          asset.attributes.portraitSource === 'authorized-real' ||
          asset.attributes.visualStyle === 'photorealistic'
        return needsTrustedPortrait && asset.attributes.trustedPortrait?.status !== 'active'
      })
      if (blockedPortraits.length) {
        throw new Error(
          `以下仿真人物尚未完成方舟资源入库或真人授权：${blockedPortraits.map((asset) => asset.name).join('、')}`,
        )
      }
      const trustedAliases = new Map<string, string>()
      for (const asset of referenceAssets) {
        if (asset.attributes.type !== 'character') continue
        const portrait = asset.attributes.trustedPortrait
        if (portrait?.status !== 'active') continue
        const uri = `asset://${portrait.assetId}`
        for (const value of [
          asset.imageUrl,
          asset.attributes.faceReference?.url,
          asset.attributes.bodyReference?.url,
        ]) {
          if (value) trustedAliases.set(value, uri)
        }
      }
      const compiledPrompt = compileStoryboardVideoPrompt({
        project,
        shot,
        shots,
        assets,
        references: referenceAssetIds.map((id) => ({ id })),
        continuityMode: stored.metadata.continuityMode === 'continue' ? 'continue' : 'independent',
      })
      const visualStyles = referenceAssets
        .map((asset) => ('visualStyle' in asset.attributes ? asset.attributes.visualStyle : null))
        .filter((style): style is NonNullable<typeof style> => typeof style === 'string')
      const scene = referenceAssets.find((asset) => asset.kind === 'scene')
      const userNegativePrompt = stringValue(stored.metadata.userNegativePrompt, stored.negativePrompt)
      const quality = compileQualityRules({
        mediaKind: 'video',
        assetKind: 'storyboard',
        contentType: project.contentType,
        visualStyles,
        emptyScene:
          scene?.attributes.type === 'scene' && scene.attributes.emptyScene
            ? !referenceAssets.some((asset) => asset.kind === 'character')
            : false,
        ...(scene?.attributes.type === 'scene' ? { weather: scene.attributes.weather } : {}),
        sourcePrompt: shot.prompt,
        customNegativePrompt: userNegativePrompt,
      })

      stored.prompt = compiledPrompt
      stored.negativePrompt = quality.negativePrompt
      stored.metadata = {
        ...stored.metadata,
        ...(Array.isArray(stored.metadata.images)
          ? {
              images: stored.metadata.images.map((value) =>
                typeof value === 'string' ? (trustedAliases.get(value) ?? value) : value,
              ),
            }
          : {}),
        duration: normalizedVideoDuration(stored.metadata.duration ?? shot.duration),
        requestedDuration: stored.metadata.requestedDuration ?? shot.duration,
        compiledPrompt,
        videoPromptVersion: VIDEO_PROMPT_VERSION,
        qualityRuleVersion: QUALITY_RULE_VERSION,
        qualityPresetIds: quality.presetIds,
        compiledNegativePrompt: quality.negativePrompt,
        userNegativePrompt,
        sourceProjectVersion: project.version,
      }
      stored.updatedAt = new Date().toISOString()
      return stored
    })
  }

  private async resolveVideoImages(task: GenerationTask): Promise<VideoGenerationRequest['images']> {
    const images: VideoGenerationRequest['images'] = []
    const continuitySourceTaskId = stringValue(task.metadata.continuitySourceTaskId, '')
    const storyboardImageUrl = stringValue(task.metadata.storyboardImageUrl, '')
    if (continuitySourceTaskId) {
      if (!this.objectStorage) throw new Error('连续镜头需要对象存储读取上一镜头尾帧')
      const sourceTask = this.store.read(
        (state) =>
          state.tasks.find(
            (item) =>
              item.id === continuitySourceTaskId &&
              item.projectId === task.projectId &&
              item.tenantId === task.tenantId &&
              item.status === 'completed',
          ) ?? null,
      )
      const lastFrame = generatedDescriptors(sourceTask ?? undefined).find(
        (item) => item.view === 'last-frame',
      )
      if (!lastFrame) throw new Error('上一镜头没有可用尾帧，请重新生成上一镜头后再继续')
      const content = await this.objectStorage.get(lastFrame.storageKey)
      images.push({
        url: `data:${lastFrame.contentType};base64,${content.toString('base64')}`,
        role: 'first_frame',
      })
    }

    if (!Array.isArray(task.metadata.images)) return images
    for (const value of task.metadata.images.slice(0, Math.max(0, 9 - images.length))) {
      if (typeof value !== 'string') continue
      if (/^asset:\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
        images.push({ url: value, role: 'reference_image' })
        continue
      }
      if (/^https?:\/\//.test(value)) {
        images.push({ url: value, role: 'reference_image' })
        continue
      }
      if (!this.objectStorage) continue
      const stored = this.findStoredReference(task, value)
      if (!stored) continue
      const content = await this.objectStorage.get(stored.storageKey)
      images.push({
        url: `data:${stored.contentType};base64,${content.toString('base64')}`,
        role: continuitySourceTaskId && value === storyboardImageUrl ? 'last_frame' : 'reference_image',
      })
    }
    return images
  }

  private async generateRemoteImage(task: GenerationTask): Promise<void> {
    try {
      const preparedTask = await this.prepareImageTask(task)
      const references = await this.resolveImageReferences(preparedTask)
      const outputs = await this.imageProvider!.generate(imageRequestFor(preparedTask, references))
      const descriptors: GeneratedOutputDescriptor[] = []
      for (const output of outputs) {
        const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-${output.view}.png`
        await this.objectStorage!.put(storageKey, output.content, output.contentType)
        descriptors.push({
          view: output.view,
          storageKey,
          contentType: output.contentType,
          size: output.content.length,
        })
      }
      await this.completeRemoteImage(task.id, descriptors)
    } catch (error) {
      await this.failTask(task.id, messageFor(error))
    }
  }

  private prepareImageTask(task: GenerationTask): Promise<GenerationTask> {
    return this.store.mutate((state) => {
      const stored = state.tasks.find((item) => item.id === task.id)
      if (!stored) return task
      const project = state.projects.find(
        (item) => item.id === stored.projectId && item.tenantId === stored.tenantId,
      )
      const attributes = objectValue(stored.metadata.attributes)
      const assetKind = imageAssetKind(stored)
      const userNegativePrompt = stringValue(stored.metadata.userNegativePrompt, stored.negativePrompt)
      const quality = compileQualityRules({
        mediaKind: 'image',
        assetKind,
        visualStyles: typeof attributes.visualStyle === 'string' ? [attributes.visualStyle] : [],
        emptyScene: attributes.emptyScene === true,
        sourcePrompt: stored.prompt,
        customNegativePrompt: userNegativePrompt,
        ...(project ? { contentType: project.contentType } : {}),
        ...(typeof attributes.weather === 'string' ? { weather: attributes.weather } : {}),
      })
      stored.negativePrompt = quality.negativePrompt
      stored.metadata = {
        ...stored.metadata,
        qualityRuleVersion: QUALITY_RULE_VERSION,
        qualityPresetIds: quality.presetIds,
        compiledNegativePrompt: quality.negativePrompt,
        userNegativePrompt,
      }
      stored.updatedAt = new Date().toISOString()
      return stored
    })
  }

  private async resolveImageReferences(task: GenerationTask): Promise<ImageReference[]> {
    if (!this.objectStorage || !Array.isArray(task.metadata.references)) return []
    const references: ImageReference[] = []
    for (const raw of task.metadata.references.slice(0, 3)) {
      if (!raw || typeof raw !== 'object') continue
      const reference = raw as { url?: unknown; name?: unknown }
      if (typeof reference.url !== 'string') continue
      const stored = this.findStoredReference(task, reference.url)
      if (!stored) continue
      references.push({
        name: typeof reference.name === 'string' ? reference.name : `reference-${references.length + 1}.png`,
        contentType: stored.contentType,
        content: await this.objectStorage.get(stored.storageKey),
      })
    }
    return references
  }

  private findStoredReference(
    task: GenerationTask,
    url: string,
  ): { storageKey: string; contentType: string } | null {
    const mediaId = /^\/api\/v1\/media\/([^/]+)$/.exec(url)?.[1]
    if (mediaId) {
      return this.store.read((state) => {
        const media = state.media.find(
          (item) =>
            item.id === mediaId && item.projectId === task.projectId && item.tenantId === task.tenantId,
        )
        return media ? { storageKey: media.storageKey, contentType: media.contentType } : null
      })
    }

    const generated = /^\/api\/v1\/generation\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(url)
    if (!generated) return null
    return this.store.read((state) => {
      const sourceTask = state.tasks.find(
        (item) =>
          item.id === generated[1] && item.projectId === task.projectId && item.tenantId === task.tenantId,
      )
      const descriptor = generatedDescriptors(sourceTask).find((item) => item.view === generated[2])
      return descriptor ? { storageKey: descriptor.storageKey, contentType: descriptor.contentType } : null
    })
  }

  private async completeRemoteImage(taskId: string, descriptors: GeneratedOutputDescriptor[]): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running') return
      task.status = 'completed'
      task.progress = 100
      task.error = null
      task.metadata = { ...task.metadata, providerState: 'completed', generatedOutputs: descriptors }
      task.outputs = descriptors.map((descriptor) => ({
        id: `${task.id}-${descriptor.view}`,
        url: `/api/v1/generation/tasks/${task.id}/outputs/${descriptor.view}`,
        mediaType: 'image',
        view: descriptor.view,
      }))
      task.resultUrl = task.outputs[0]?.url ?? null
      task.updatedAt = new Date().toISOString()

      const assetId = typeof task.metadata.assetId === 'string' ? task.metadata.assetId : null
      const shotId = typeof task.metadata.shotId === 'string' ? task.metadata.shotId : null
      const asset = state.assets.find((item) => item.id === assetId && item.projectId === task.projectId)
      const shot = state.shots.find((item) => item.id === shotId && item.projectId === task.projectId)
      if (asset && task.resultUrl) {
        asset.imageUrl = task.resultUrl
        asset.updatedAt = task.updatedAt
      }
      if (shot && task.resultUrl) {
        shot.imageUrl = task.resultUrl
        shot.updatedAt = task.updatedAt
      }
    })
  }

  private async pollRemoteVideos(): Promise<void> {
    if (!this.videoProvider) return
    const now = Date.now()
    const tasks = this.store.read((state) =>
      state.tasks.filter(
        (task) =>
          task.status === 'running' &&
          task.metadata.providerName === this.videoProviderName &&
          typeof task.metadata.providerTaskId === 'string' &&
          now - numberValue(task.metadata.providerPolledAt, 0) >= this.providerPollIntervalMs,
      ),
    )

    for (const task of tasks) {
      const providerTaskId = String(task.metadata.providerTaskId)
      await this.store.mutate((state) => {
        const stored = state.tasks.find((item) => item.id === task.id)
        if (stored) stored.metadata = { ...stored.metadata, providerPolledAt: now }
      })
      try {
        const status = await this.videoProvider.getStatus(providerTaskId)
        let lastFrameDescriptor: GeneratedOutputDescriptor | null = null
        let lastFrameError: string | null = null
        const hasLastFrame = generatedDescriptors(task).some((item) => item.view === 'last-frame')
        if (
          status.status === 'completed' &&
          !hasLastFrame &&
          this.videoProvider.getLastFrameContent &&
          this.objectStorage
        ) {
          try {
            lastFrameDescriptor = await this.persistVideoLastFrame(task, providerTaskId)
          } catch (error) {
            lastFrameError = messageFor(error)
          }
        }
        await this.store.mutate((state) => {
          const stored = state.tasks.find((item) => item.id === task.id)
          if (!stored || stored.status !== 'running') return
          stored.status = status.status
          stored.progress = status.progress
          stored.error = status.error
          stored.metadata = {
            ...stored.metadata,
            providerState: status.status,
            providerPollErrors: 0,
            ...(lastFrameDescriptor
              ? {
                  generatedOutputs: [
                    ...generatedDescriptors(stored).filter((item) => item.view !== 'last-frame'),
                    lastFrameDescriptor,
                  ],
                  lastFrameStorageKey: lastFrameDescriptor.storageKey,
                  lastFrameContentType: lastFrameDescriptor.contentType,
                }
              : {}),
            ...(lastFrameError ? { lastFrameError } : {}),
          }
          stored.updatedAt = new Date().toISOString()
          if (status.status === 'completed') {
            const url = `/api/v1/generation/tasks/${stored.id}/content`
            stored.outputs = [
              { id: `${stored.id}-video`, url, mediaType: 'video', view: 'single' },
              ...(lastFrameDescriptor
                ? [
                    {
                      id: `${stored.id}-last-frame`,
                      url: `/api/v1/generation/tasks/${stored.id}/outputs/last-frame`,
                      mediaType: 'image' as const,
                      view: 'last-frame' as const,
                    },
                  ]
                : []),
            ]
            stored.resultUrl = url
          }
        })
        if (status.status === 'completed' && this.onVideoCompleted) {
          const completedTask = this.store.read(
            (state) => state.tasks.find((item) => item.id === task.id) ?? null,
          )
          if (completedTask) await this.onVideoCompleted(completedTask).catch(() => {})
        }
      } catch (error) {
        const attempts = numberValue(task.metadata.providerPollErrors, 0) + 1
        if (attempts >= 3) {
          await this.failTask(task.id, messageFor(error))
        } else {
          await this.store.mutate((state) => {
            const stored = state.tasks.find((item) => item.id === task.id)
            if (stored) stored.metadata = { ...stored.metadata, providerPollErrors: attempts }
          })
        }
      }
    }
  }

  private async persistVideoLastFrame(
    task: GenerationTask,
    providerTaskId: string,
  ): Promise<GeneratedOutputDescriptor> {
    const content = await this.videoProvider!.getLastFrameContent!(providerTaskId)
    const buffer = await readableToBuffer(content.stream)
    const storageKey = `${task.tenantId}/${task.projectId}/generated/${task.id}-last-frame.jpg`
    await this.objectStorage!.put(storageKey, buffer, content.contentType)
    return { view: 'last-frame', storageKey, contentType: content.contentType, size: buffer.length }
  }

  private async failTask(taskId: string, error: string): Promise<void> {
    await this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return
      const now = new Date().toISOString()
      task.status = 'failed'
      task.progress = 100
      task.error = error.slice(0, 1_000)
      task.updatedAt = now
    })
    await this.refundFailedTasks()
  }

  private async refundFailedTasks(): Promise<void> {
    const hasRefundableTask = this.store.read((state) =>
      state.tasks.some(
        (task) =>
          task.status === 'failed' &&
          task.estimatedCredits > 0 &&
          state.ledger.some((entry) => entry.id === `generation-${task.clientRequestId}`) &&
          !state.ledger.some((entry) => entry.id === `refund-${task.id}`),
      ),
    )
    if (!hasRefundableTask) return
    await this.store.mutate((state) => {
      for (const task of state.tasks.filter((item) => item.status === 'failed')) {
        const refundId = `refund-${task.id}`
        const hasDebit = state.ledger.some((entry) => entry.id === `generation-${task.clientRequestId}`)
        if (!hasDebit || state.ledger.some((entry) => entry.id === refundId) || task.estimatedCredits <= 0) {
          continue
        }
        const user = state.users.find((item) => item.id === task.userId && item.tenantId === task.tenantId)
        if (!user) continue
        const now = new Date().toISOString()
        user.credits += task.estimatedCredits
        state.ledger.unshift({
          id: refundId,
          userId: user.id,
          tenantId: user.tenantId,
          amount: task.estimatedCredits,
          balance: user.credits,
          type: 'adjustment',
          description: `${task.label} · 失败退款`,
          createdAt: now,
        })
        task.metadata = { ...task.metadata, creditsRefundedAt: now }
      }
    })
  }
}

function imageRequestFor(task: GenerationTask, references: ImageReference[]): ImageGenerationRequest {
  const outputs: ImageGenerationRequest['outputs'] =
    task.metadata.turnaround === true ? ['front', 'side', 'back'] : ['single']
  return {
    taskId: task.id,
    assetId: stringValue(task.metadata.assetId, ''),
    aspectRatio: stringValue(task.metadata.aspectRatio, '1:1'),
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    references,
    outputs,
  }
}

function videoRequestFor(
  task: GenerationTask,
  images: VideoGenerationRequest['images'],
): VideoGenerationRequest {
  const seed = optionalInteger(task.metadata.seed)
  const watermark = optionalBoolean(task.metadata.watermark)
  const cameraFixed = optionalBoolean(task.metadata.cameraFixed)
  return {
    taskId: task.id,
    model: task.model,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    seconds: boundedInteger(task.metadata.duration, 5, 4, 15),
    ratio: stringValue(task.metadata.aspectRatio, '16:9'),
    resolution: videoResolution(task.metadata.resolution),
    images,
    generateAudio: task.metadata.generateAudio === true,
    returnLastFrame: task.metadata.returnLastFrame !== false,
    ...(seed === null ? {} : { seed }),
    ...(watermark === null ? {} : { watermark }),
    ...(cameraFixed === null ? {} : { cameraFixed }),
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function imageAssetKind(task: GenerationTask): 'character' | 'scene' | 'prop' | 'costume' | 'storyboard' {
  const assetKind = task.metadata.assetKind
  if (assetKind === 'character' || assetKind === 'scene' || assetKind === 'prop' || assetKind === 'costume') {
    return assetKind
  }
  return 'storyboard'
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = numberValue(value, fallback)
  return Math.min(max, Math.max(min, Math.round(number)))
}

function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function videoResolution(value: unknown): string {
  return value === '480p' || value === '720p' || value === '1080p' || value === '4k' ? value : '720p'
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '第三方生成请求失败'
}

function isRemoteProviderName(value: unknown): boolean {
  return isVideoProviderName(value) || value === 'tokenadvent-img2'
}

function isVideoProviderName(value: unknown): boolean {
  return value === 'stringx-seedance' || value === 'volc-ark-seedance' || value === 'aideos-seedance'
}

function dependencyState(task: GenerationTask, userTasks: GenerationTask[]): 'ready' | 'waiting' | 'failed' {
  const dependencyIds = Array.isArray(task.metadata.dependsOnTaskIds)
    ? task.metadata.dependsOnTaskIds.filter((value): value is string => typeof value === 'string')
    : typeof task.metadata.dependsOnTaskId === 'string'
      ? [task.metadata.dependsOnTaskId]
      : []
  if (!dependencyIds.length) return 'ready'

  let waiting = false
  for (const dependencyId of dependencyIds) {
    const dependency = userTasks.find(
      (item) =>
        item.id === dependencyId && item.projectId === task.projectId && item.tenantId === task.tenantId,
    )
    if (
      !dependency ||
      dependency.status === 'failed' ||
      dependency.status === 'cancelled' ||
      typeof dependency.metadata.queueHiddenAt === 'string'
    ) {
      return 'failed'
    }
    if (continuityDependencyMissingFrame(task, userTasks)) return 'failed'
    if (dependency.status !== 'completed') waiting = true
  }
  return waiting ? 'waiting' : 'ready'
}

function continuityDependencyMissingFrame(task: GenerationTask, userTasks: GenerationTask[]): boolean {
  const sourceTaskId = task.metadata.continuitySourceTaskId
  if (typeof sourceTaskId !== 'string') return false
  const source = userTasks.find(
    (item) =>
      item.id === sourceTaskId && item.projectId === task.projectId && item.tenantId === task.tenantId,
  )
  return Boolean(
    source?.status === 'completed' &&
    !generatedDescriptors(source).some((item) => item.view === 'last-frame'),
  )
}

async function readableToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function generatedDescriptors(task: GenerationTask | undefined): GeneratedOutputDescriptor[] {
  if (!task || !Array.isArray(task.metadata.generatedOutputs)) return []
  return task.metadata.generatedOutputs.filter((item): item is GeneratedOutputDescriptor => {
    if (!item || typeof item !== 'object') return false
    const descriptor = item as Partial<GeneratedOutputDescriptor>
    return (
      typeof descriptor.view === 'string' &&
      typeof descriptor.storageKey === 'string' &&
      typeof descriptor.contentType === 'string' &&
      typeof descriptor.size === 'number'
    )
  })
}

function outputsFor(task: GenerationTask): GenerationTask['outputs'] {
  if (task.kind === 'image' || task.kind === 'video') {
    const images = ['/demo/station.jpg', '/demo/rain.jpg', '/demo/room.jpg']
    const start = Math.abs(hash(task.id)) % images.length
    const mediaType: 'image' | 'video' = task.kind
    const views =
      task.metadata.turnaround === true ? (['front', 'side', 'back'] as const) : (['single'] as const)
    return views.map((view, index) => ({
      id: `${task.id}-${view}`,
      url: images[(start + index) % images.length] ?? images[0]!,
      mediaType,
      view,
    }))
  }
  return []
}

function hash(value: string): number {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) | 0, 0)
}
