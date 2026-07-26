import type {
  Asset,
  GenerationTask,
  LedgerEntry,
  MediaKind,
  NovelBoundary,
  NovelChapter,
  NovelChapterSummary,
  NovelDocument,
  NovelSummaryQueue,
  NovelSummaryQueueItem,
  NovelStoryBible,
  Plan,
  Project,
  Role,
  Shot,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, open as openFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashPassword } from '../core/auth/password.js'
import { normalizeGenerationTaskLifecycle } from '../core/jobs/taskLease.js'

export type StoredUser = {
  id: string
  email: string
  name: string
  passwordHash: string
  tenantId: string
  roles: Role[]
  plan: Plan
  credits: number
}

export type StoredMedia = {
  id: string
  projectId: string
  tenantId: string
  kind: MediaKind
  name: string
  contentType: string
  size: number
  storageKey: string
  createdAt: string
}

export type StoredNovelDocument = NovelDocument & {
  clientRequestId?: string
}

export type StoredNovelChapter = NovelChapter & {
  content: string
}

export type StoredNovelChapterSummary = NovelChapterSummary
export type StoredNovelSummaryQueue = NovelSummaryQueue & {
  clientRequestId?: string
}
export type StoredNovelSummaryQueueItem = NovelSummaryQueueItem
export type StoredNovelBoundary = NovelBoundary
export type StoredNovelStoryBible = NovelStoryBible

export type AppState = {
  users: StoredUser[]
  projects: Project[]
  assets: Asset[]
  shots: Shot[]
  tasks: GenerationTask[]
  ledger: LedgerEntry[]
  media: StoredMedia[]
  novelDocuments: StoredNovelDocument[]
  novelChapters: StoredNovelChapter[]
  novelChapterSummaries: StoredNovelChapterSummary[]
  novelSummaryQueues: StoredNovelSummaryQueue[]
  novelSummaryQueueItems: StoredNovelSummaryQueueItem[]
  novelBoundaries: StoredNovelBoundary[]
  novelStoryBibles: StoredNovelStoryBible[]
}

export type BootstrapUsers = {
  creatorName?: string
  creatorEmail: string
  creatorPassword: string
  adminName?: string
  adminEmail: string
  adminPassword: string
}

const developmentBootstrapUsers: BootstrapUsers = {
  creatorName: '林夏',
  creatorEmail: 'creator@seqora.local',
  creatorPassword: 'Creator123!',
  adminName: '平台管理员',
  adminEmail: 'admin@seqora.local',
  adminPassword: 'Admin123!',
}

export class AppStore {
  private state!: AppState
  private writeQueue = Promise.resolve()
  private readonly lockPath: string | null

  constructor(
    private readonly filePath: string | null,
    private readonly bootstrapUsers: BootstrapUsers = developmentBootstrapUsers,
    private readonly bootstrapDemoWorkspace = true,
  ) {
    this.lockPath = filePath ? `${filePath}.lock` : null
  }

  async initialize(): Promise<void> {
    if (this.filePath) {
      try {
        this.state = removeLegacyDemoCharacters(
          normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppState>),
        )
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw error
      }
    }

    this.state = removeLegacyDemoCharacters(createSeedState(this.bootstrapUsers, this.bootstrapDemoWorkspace))
    await this.persist()
  }

  read<T>(reader: (state: Readonly<AppState>) => T): T {
    this.reloadFromDiskSync()
    return structuredClone(reader(this.state))
  }

  async mutate<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runWrite(mutator)
  }

  async transaction<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runWrite(mutator)
  }

  private async runWrite<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    let result!: T
    const operation = this.writeQueue.then(async () => {
      await this.withWriteLock(async () => {
        await this.reloadFromDisk()
        const snapshot = structuredClone(this.state)
        try {
          result = await mutator(this.state)
          await this.persist()
        } catch (error) {
          this.state = snapshot
          throw error
        }
      })
    })
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
    return structuredClone(result)
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
      await renameWithRetry(temporary, this.filePath)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  private async reloadFromDisk(): Promise<void> {
    if (!this.filePath) return
    try {
      this.state = removeLegacyDemoCharacters(
        normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppState>),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private reloadFromDiskSync(): void {
    if (!this.filePath || !existsSync(this.filePath)) return
    this.state = removeLegacyDemoCharacters(
      normalizeState(JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppState>),
    )
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.lockPath) return operation()
    const handle = await acquireFileLock(this.lockPath)
    try {
      return await operation()
    } finally {
      await handle.close().catch(() => {})
      await rm(this.lockPath, { force: true }).catch(() => {})
    }
  }
}

async function acquireFileLock(lockPath: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const handle = await openFile(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }))
      return handle
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await removeStaleLock(lockPath)
      await new Promise((resolve) => setTimeout(resolve, Math.min(25 + attempt * 5, 250)))
    }
  }
  throw new Error(`Timed out waiting for app store lock: ${lockPath}`)
}

async function removeStaleLock(lockPath: string): Promise<void> {
  const raw = await readFile(lockPath, 'utf8').catch(() => '')
  let createdAt = Number.NaN
  try {
    createdAt = Number(JSON.parse(raw || '{}').createdAt)
  } catch {
    createdAt = Number.NaN
  }
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 120_000) {
    await rm(lockPath, { force: true }).catch(() => {})
  }
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    }
  }
}

function createSeedState(bootstrapUsers: BootstrapUsers, demoWorkspace: boolean): AppState {
  const now = new Date().toISOString()
  const tenantId = 'tenant-seqora-demo'
  const creatorId = 'user-creator'
  const projectId = 'project-midnight-film'

  return {
    users: [
      {
        id: creatorId,
        email: bootstrapUsers.creatorEmail.toLowerCase(),
        name: bootstrapUsers.creatorName ?? '创作者',
        passwordHash: hashPassword(bootstrapUsers.creatorPassword),
        tenantId,
        roles: ['creator'],
        plan: 'free',
        credits: 286,
      },
      {
        id: 'user-admin',
        email: bootstrapUsers.adminEmail.toLowerCase(),
        name: bootstrapUsers.adminName ?? '平台管理员',
        passwordHash: hashPassword(bootstrapUsers.adminPassword),
        tenantId,
        roles: ['admin'],
        plan: 'member',
        credits: 1_000,
      },
    ],
    projects: demoWorkspace
      ? [
          {
            id: projectId,
            tenantId,
            ownerId: creatorId,
            name: '午夜胶片',
            contentType: 'short-drama',
            aspectRatio: '9:16',
            status: 'producing',
            synopsis: '雨夜，一卷能预见明天的胶片，正等待被打开。',
            script: DEFAULT_SCRIPT,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    assets: demoWorkspace ? seedAssets(projectId, tenantId, now) : [],
    shots: demoWorkspace ? seedShots(projectId, tenantId, now) : [],
    tasks: [],
    media: [],
    novelDocuments: [],
    novelChapters: [],
    novelChapterSummaries: [],
    novelSummaryQueues: [],
    novelSummaryQueueItems: [],
    novelBoundaries: [],
    novelStoryBibles: [],
    ledger: [
      {
        id: 'ledger-initial',
        userId: creatorId,
        tenantId,
        amount: 286,
        balance: 286,
        type: 'grant',
        description: '新用户体验积分',
        createdAt: now,
      },
    ],
  }
}

function seedAssets(projectId: string, tenantId: string, now: string): Asset[] {
  return [
    [
      'asset-station',
      'scene',
      '三号站台',
      '主场景',
      '废弃海边火车站，雨夜，湿润铁轨，远处暖色信号灯，宽银幕电影构图',
      '/demo/station.jpg',
    ],
    [
      'asset-room',
      'scene',
      '旧候车室',
      '室内',
      '老式候车室，木质长椅，昏暗壁灯，窗外大雨，悬疑电影氛围',
      '/demo/room.jpg',
    ],
    ['asset-rain', 'audio', '雨夜站台', '环境音 · 48秒', '密集雨声，远处列车低鸣，偶尔金属震动', null],
    ['asset-train', 'audio', '幽灵列车', '环境音 · 22秒', '由远及近的老式列车进站声，低频压迫感', null],
  ].map(([id, rawKind, name, description, prompt, imageUrl]) => {
    const kind = rawKind as Asset['kind']
    return {
      id: id as string,
      projectId,
      tenantId,
      kind,
      sourceMode: 'generate' as const,
      name: name as string,
      description: description as string,
      prompt: prompt as string,
      promptMode: 'standard' as const,
      customPromptMode: 'append' as const,
      customPrompt: '',
      negativePrompt: '',
      references: [],
      attributes: defaultAssetAttributes(kind),
      imageUrl: imageUrl as string | null,
      status: 'confirmed' as const,
      createdAt: now,
      updatedAt: now,
    }
  })
}

function removeLegacyDemoCharacters(state: AppState): AppState {
  const legacyIds = new Set(['asset-lin', 'asset-zhou'])
  return {
    ...state,
    assets: state.assets.filter((asset) => !legacyIds.has(asset.id)),
  }
}

export function defaultAssetAttributes(kind: Asset['kind']): Asset['attributes'] {
  if (kind === 'character') {
    return {
      type: 'character',
      subjectType: 'human',
      gender: 'female',
      ageGroup: 'young',
      exactAge: null,
      species: '',
      anthropomorphic: false,
      visualStyle: 'cinematic-cg',
      framing: 'full',
      bodyType: 'balanced',
      background: 'solid',
      faceStatus: 'pending',
      bodyStatus: 'pending',
      faceReference: null,
      bodyReference: null,
      portraitSource: 'ai-virtual',
      trustedPortrait: null,
      legStretch: false,
      turnaround: false,
      turnaroundLayout: 'sheet',
    }
  }
  if (kind === 'scene') {
    return {
      type: 'scene',
      space: 'exterior',
      sceneType: 'street',
      era: 'modern',
      time: 'night',
      weather: 'clear',
      mood: 'mystery',
      camera: 'wide',
      visualStyle: 'cinematic-cg',
      emptyScene: true,
      activitySpace: true,
    }
  }
  if (kind === 'prop') {
    return {
      type: 'prop',
      category: 'daily',
      material: 'mixed',
      condition: 'used',
      view: 'front',
      background: 'solid',
      visualStyle: 'cinematic-cg',
    }
  }
  if (kind === 'costume') {
    return {
      type: 'costume',
      audience: 'unisex',
      category: 'daily',
      season: 'all-season',
      design: 'minimal',
      presentation: 'flat',
      visualStyle: 'cinematic-cg',
      turnaround: false,
    }
  }
  return {
    type: 'audio',
    audioType: 'ambience',
    gender: 'unspecified',
    ageGroup: 'young',
    emotion: 'neutral',
    tone: 'warm',
    speed: 'normal',
    language: 'mandarin',
    duration: 15,
    loop: false,
  }
}

function seedShots(projectId: string, tenantId: string, now: string): Shot[] {
  return [
    ['shot-1', 1, '雨夜空镜', '大全景', 4, '临港市雨夜，镜头缓慢推向废弃火车站，冷色调', '/demo/rain.jpg'],
    ['shot-2', 2, '林夏抵达', '中近景', 5, '林夏撑透明雨伞走入站台，侧逆光，雨滴清晰', null],
    ['shot-3', 3, '等待', '广角', 4, '空旷站台，人物位于画面右侧，信号灯闪烁', '/demo/station.jpg'],
    ['shot-4', 4, '周野出现', '特写', 4, '周野从阴影走出，把旧铁盒放在长椅上', null],
    ['shot-5', 5, '打开铁盒', '俯拍', 5, '双手打开生锈铁盒，里面是一卷旧胶片，暖光', '/demo/room.jpg'],
  ].map(([id, order, title, framing, duration, prompt, imageUrl]) => ({
    id: id as string,
    projectId,
    tenantId,
    order: order as number,
    title: title as string,
    framing: framing as string,
    duration: duration as number,
    prompt: prompt as string,
    negativePrompt: '',
    imageUrl: imageUrl as string | null,
    continuityMode: 'independent' as const,
    continuityNote: '',
    createdAt: now,
    updatedAt: now,
  }))
}

function normalizeState(input: Partial<AppState>): AppState {
  const assets = (input.assets ?? []).map((stored) => {
    const legacy = stored as Omit<Partial<Asset>, 'kind'> & {
      id: string
      projectId: string
      tenantId: string
      kind: Asset['kind'] | 'sound'
      name: string
      description: string
      prompt: string
      imageUrl: string | null
      status: Asset['status']
      createdAt: string
      updatedAt: string
    }
    const kind: Asset['kind'] = legacy.kind === 'sound' ? 'audio' : legacy.kind
    return {
      ...legacy,
      kind,
      sourceMode: legacy.sourceMode ?? 'generate',
      promptMode: legacy.promptMode ?? 'standard',
      customPromptMode: legacy.customPromptMode ?? 'append',
      customPrompt: legacy.customPrompt ?? '',
      negativePrompt: legacy.negativePrompt ?? '',
      references: legacy.references ?? [],
      attributes:
        legacy.attributes?.type === kind
          ? { ...defaultAssetAttributes(kind), ...legacy.attributes }
          : defaultAssetAttributes(kind),
    } as Asset
  })
  const tasks = (input.tasks ?? []).map((task) => ({
    ...task,
    prompt: task.prompt ?? '',
    negativePrompt: task.negativePrompt ?? '',
    provider: task.provider ?? 'local',
    model: task.model ?? null,
    metadata: task.metadata ?? {},
    outputs: task.outputs ?? [],
  }))
  return {
    users: input.users ?? [],
    projects: input.projects ?? [],
    assets,
    shots: (input.shots ?? []).map((shot) => ({
      ...shot,
      negativePrompt: shot.negativePrompt ?? '',
      continuityMode: shot.continuityMode ?? 'independent',
      continuityNote: shot.continuityNote ?? '',
    })),
    tasks: tasks.map((task) => normalizeGenerationTaskLifecycle(task)),
    ledger: input.ledger ?? [],
    media: input.media ?? [],
    novelDocuments: input.novelDocuments ?? [],
    novelChapters: input.novelChapters ?? [],
    novelChapterSummaries: input.novelChapterSummaries ?? [],
    novelSummaryQueues: input.novelSummaryQueues ?? [],
    novelSummaryQueueItems: input.novelSummaryQueueItems ?? [],
    novelBoundaries: input.novelBoundaries ?? [],
    novelStoryBibles: input.novelStoryBibles ?? [],
  }
}

const DEFAULT_SCRIPT = `雨夜，临港市旧火车站。

林夏撑着一把透明雨伞，站在停运多年的三号站台。她收到一封没有署名的信，约她午夜来取回父亲留下的胶片。

钟声响起，周野从候车室的阴影里走出。他把一只旧铁盒放到长椅上，却提醒林夏：胶片记录的并不是过去，而是明天。

远处传来列车进站声。空无一物的铁轨上，灯光穿透雨幕。林夏打开铁盒，看见胶片第一格正是此刻的自己。`
