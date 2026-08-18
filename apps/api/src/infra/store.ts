import { assetLibraryItemRecordSchema, assetLibraryItemVersionRecordSchema } from '@seqora/contracts'
import type {
  AiJob,
  Asset,
  AssetLibraryItemRecord,
  AssetLibraryItemVersionRecord,
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
import { mkdir, open as openFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashPassword } from '../core/auth/password.js'
import { normalizeAiJobLifecycle } from '../core/jobs/aiJobLease.js'
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
  passwordResetRequired: boolean
  emailVerified: boolean
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
  aiJobs: AiJob[]
  ledger: LedgerEntry[]
  media: StoredMedia[]
  assetLibraryItems: AssetLibraryItemRecord[]
  assetLibraryItemVersions: AssetLibraryItemVersionRecord[]
  novelDocuments: StoredNovelDocument[]
  novelChapters: StoredNovelChapter[]
  novelChapterSummaries: StoredNovelChapterSummary[]
  novelSummaryQueues: StoredNovelSummaryQueue[]
  novelSummaryQueueItems: StoredNovelSummaryQueueItem[]
  novelBoundaries: StoredNovelBoundary[]
  novelStoryBibles: StoredNovelStoryBible[]
}

export type BootstrapUsers = {
  memberName?: string
  memberEmail: string
  memberPassword: string
  ownerName?: string
  ownerEmail: string
  ownerPassword: string
  superAdminName?: string
  superAdminEmail: string
  superAdminPassword: string
  adminName?: string
  adminEmail: string
  adminPassword: string
}

const developmentBootstrapUsers: BootstrapUsers = {
  memberName: '默认 C 端用户',
  memberEmail: 'member@seqora.local',
  memberPassword: 'MemberPassword123!',
  ownerName: '平台所有者',
  ownerEmail: 'owner@seqora.local',
  ownerPassword: 'OwnerPassword123!',
  superAdminName: '超级管理员',
  superAdminEmail: 'superadmin@seqora.local',
  superAdminPassword: 'SuperAdmin123!',
  adminName: '平台管理员',
  adminEmail: 'admin@seqora.local',
  adminPassword: 'Admin123!',
}

export class AppStore {
  private state!: AppState
  private writeQueue = Promise.resolve()
  private readonly lockPath: string | null
  private accountRuntimeCache: Pick<AppState, 'users' | 'ledger'> | null = null
  private accountPersistenceBackup: Pick<AppState, 'users' | 'ledger'> | null = null
  private projectWorkspaceRuntimeCache: Pick<AppState, 'projects' | 'assets' | 'shots'> | null = null
  private projectWorkspacePersistenceBackup: Pick<AppState, 'projects' | 'assets' | 'shots'> | null = null
  private generationTaskRuntimeCache: Pick<AppState, 'tasks'> | null = null
  private generationTaskPersistenceBackup: Pick<AppState, 'tasks'> | null = null
  private aiJobRuntimeCache: Pick<AppState, 'aiJobs'> | null = null
  private aiJobPersistenceBackup: Pick<AppState, 'aiJobs'> | null = null
  private libraryRuntimeCache: Pick<AppState, 'assetLibraryItems' | 'assetLibraryItemVersions'> | null = null
  private libraryPersistenceBackup: Pick<AppState, 'assetLibraryItems' | 'assetLibraryItemVersions'> | null = null

  constructor(
    private readonly filePath: string | null,
    private readonly bootstrapUsers: BootstrapUsers = developmentBootstrapUsers,
    private readonly bootstrapDemoWorkspace = true,
    private readonly bootstrapOnMissingFile = true,
    private readonly normalizeLegacyRoleAliases = true,
  ) {
    this.lockPath = filePath ? `${filePath}.lock` : null
  }

  async initialize(): Promise<void> {
    if (this.filePath) {
      try {
        this.state = removeLegacyDemoCharacters(
          normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppState>, {
            normalizeLegacyRoleAliases: this.normalizeLegacyRoleAliases,
          }),
        )
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw error
      }
    }

    this.state = this.bootstrapOnMissingFile
      ? removeLegacyDemoCharacters(createSeedState(this.bootstrapUsers, this.bootstrapDemoWorkspace))
      : createEmptyState()
    await this.persist()
  }

  read<T>(reader: (state: Readonly<AppState>) => T): T {
    this.reloadFromDiskSync()
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
    return structuredClone(reader(this.state))
  }

  async mutate<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runWrite(mutator)
  }

  async transaction<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runWrite(mutator)
  }

  replaceAccountRuntimeCache(input: Pick<AppState, 'users' | 'ledger'>): void {
    if (!this.accountPersistenceBackup) {
      this.accountPersistenceBackup = structuredClone({
        users: this.state.users,
        ledger: this.state.ledger,
      })
    }
    this.accountRuntimeCache = structuredClone(input)
    this.applyAccountRuntimeCache()
  }

  mutateAccountRuntimeCache<T>(mutator: (state: AppState) => T): T {
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
    if (!this.accountPersistenceBackup) {
      this.accountPersistenceBackup = structuredClone({
        users: this.state.users,
        ledger: this.state.ledger,
      })
    }
    if (!this.accountRuntimeCache) {
      this.accountRuntimeCache = structuredClone({
        users: this.state.users,
        ledger: this.state.ledger,
      })
    }
    const result = mutator(this.state)
    this.captureAccountRuntimeCache()
    return structuredClone(result)
  }

  replaceProjectWorkspaceRuntimeCache(input: Pick<AppState, 'projects' | 'assets' | 'shots'>): void {
    if (!this.projectWorkspacePersistenceBackup) {
      this.projectWorkspacePersistenceBackup = structuredClone({
        projects: this.state.projects,
        assets: this.state.assets,
        shots: this.state.shots,
      })
    }
    this.projectWorkspaceRuntimeCache = structuredClone(input)
    this.applyProjectWorkspaceRuntimeCache()
  }

  replaceGenerationTaskRuntimeCache(tasks: GenerationTask[]): void {
    if (!this.generationTaskPersistenceBackup) {
      this.generationTaskPersistenceBackup = structuredClone({ tasks: this.state.tasks })
    }
    this.generationTaskRuntimeCache = structuredClone({ tasks })
    this.applyGenerationTaskRuntimeCache()
  }

  replaceAiJobRuntimeCache(aiJobs: AiJob[]): void {
    if (!this.aiJobPersistenceBackup) {
      this.aiJobPersistenceBackup = structuredClone({ aiJobs: this.state.aiJobs })
    }
    this.aiJobRuntimeCache = structuredClone({ aiJobs })
    this.applyAiJobRuntimeCache()
  }

  replaceLibraryRuntimeCache(input: Pick<AppState, 'assetLibraryItems' | 'assetLibraryItemVersions'>): void {
    if (!this.libraryPersistenceBackup) {
      this.libraryPersistenceBackup = structuredClone({
        assetLibraryItems: this.state.assetLibraryItems,
        assetLibraryItemVersions: this.state.assetLibraryItemVersions,
      })
    }
    this.libraryRuntimeCache = structuredClone(input)
    this.applyLibraryRuntimeCache()
  }

  mutateLibraryRuntimeCache<T>(mutator: (state: AppState) => T): T {
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
    if (!this.libraryPersistenceBackup) {
      this.libraryPersistenceBackup = structuredClone({
        assetLibraryItems: this.state.assetLibraryItems,
        assetLibraryItemVersions: this.state.assetLibraryItemVersions,
      })
    }
    if (!this.libraryRuntimeCache) {
      this.libraryRuntimeCache = structuredClone({
        assetLibraryItems: this.state.assetLibraryItems,
        assetLibraryItemVersions: this.state.assetLibraryItemVersions,
      })
    }
    const result = mutator(this.state)
    this.captureLibraryRuntimeCache()
    return structuredClone(result)
  }

  mutateProjectWorkspaceRuntimeCache<T>(mutator: (state: AppState) => T): T {
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
    const result = mutator(this.state)
    this.captureProjectWorkspaceRuntimeCache()
    this.captureGenerationTaskRuntimeCache()
    this.captureAiJobRuntimeCache()
    return structuredClone(result)
  }

  private async runWrite<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    let result!: T
    const operation = this.writeQueue.then(async () => {
      await this.withWriteLock(async () => {
        await this.reloadFromDisk()
        this.applyAccountRuntimeCache()
        this.applyProjectWorkspaceRuntimeCache()
        this.applyGenerationTaskRuntimeCache()
        this.applyAiJobRuntimeCache()
        this.applyLibraryRuntimeCache()
        const snapshot = structuredClone(this.state)
        try {
          result = await mutator(this.state)
          this.captureAccountRuntimeCache()
          this.captureProjectWorkspaceRuntimeCache()
          this.captureGenerationTaskRuntimeCache()
          this.captureAiJobRuntimeCache()
          this.captureLibraryRuntimeCache()
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
      await writeFile(temporary, `${JSON.stringify(this.stateForPersistence(), null, 2)}\n`, 'utf8')
      await renameWithRetry(temporary, this.filePath)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  private async reloadFromDisk(): Promise<void> {
    if (!this.filePath) return
    try {
      this.state = removeLegacyDemoCharacters(
        normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppState>, {
          normalizeLegacyRoleAliases: this.normalizeLegacyRoleAliases,
        }),
      )
      this.applyAccountRuntimeCache()
      this.applyProjectWorkspaceRuntimeCache()
      this.applyGenerationTaskRuntimeCache()
      this.applyAiJobRuntimeCache()
      this.applyLibraryRuntimeCache()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private reloadFromDiskSync(): void {
    if (!this.filePath || !existsSync(this.filePath)) return
    this.state = removeLegacyDemoCharacters(
      normalizeState(JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppState>, {
        normalizeLegacyRoleAliases: this.normalizeLegacyRoleAliases,
      }),
    )
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
  }

  private applyAccountRuntimeCache(): void {
    if (!this.accountRuntimeCache) return
    this.state.users = structuredClone(this.accountRuntimeCache.users)
    this.state.ledger = structuredClone(this.accountRuntimeCache.ledger)
  }

  private applyProjectWorkspaceRuntimeCache(): void {
    if (!this.projectWorkspaceRuntimeCache) return
    this.state.projects = structuredClone(this.projectWorkspaceRuntimeCache.projects)
    this.state.assets = structuredClone(this.projectWorkspaceRuntimeCache.assets)
    this.state.shots = structuredClone(this.projectWorkspaceRuntimeCache.shots)
  }

  private applyGenerationTaskRuntimeCache(): void {
    if (!this.generationTaskRuntimeCache) return
    this.state.tasks = structuredClone(this.generationTaskRuntimeCache.tasks)
  }

  private applyAiJobRuntimeCache(): void {
    if (!this.aiJobRuntimeCache) return
    this.state.aiJobs = structuredClone(this.aiJobRuntimeCache.aiJobs)
  }

  private applyLibraryRuntimeCache(): void {
    if (!this.libraryRuntimeCache) return
    this.state.assetLibraryItems = structuredClone(this.libraryRuntimeCache.assetLibraryItems)
    this.state.assetLibraryItemVersions = structuredClone(this.libraryRuntimeCache.assetLibraryItemVersions)
  }

  private captureAccountRuntimeCache(): void {
    if (!this.accountRuntimeCache) return
    this.accountRuntimeCache = structuredClone({
      users: this.state.users,
      ledger: this.state.ledger,
    })
  }

  private captureProjectWorkspaceRuntimeCache(): void {
    if (!this.projectWorkspaceRuntimeCache) return
    this.projectWorkspaceRuntimeCache = structuredClone({
      projects: this.state.projects,
      assets: this.state.assets,
      shots: this.state.shots,
    })
  }

  private captureGenerationTaskRuntimeCache(): void {
    if (!this.generationTaskRuntimeCache) return
    this.generationTaskRuntimeCache = structuredClone({ tasks: this.state.tasks })
  }

  private captureAiJobRuntimeCache(): void {
    if (!this.aiJobRuntimeCache) return
    this.aiJobRuntimeCache = structuredClone({ aiJobs: this.state.aiJobs })
  }

  private captureLibraryRuntimeCache(): void {
    if (!this.libraryRuntimeCache) return
    this.libraryRuntimeCache = structuredClone({
      assetLibraryItems: this.state.assetLibraryItems,
      assetLibraryItemVersions: this.state.assetLibraryItemVersions,
    })
  }

  private stateForPersistence(): AppState {
    if (
      !this.accountPersistenceBackup &&
      !this.projectWorkspacePersistenceBackup &&
      !this.generationTaskPersistenceBackup &&
      !this.aiJobPersistenceBackup &&
      !this.libraryPersistenceBackup
    )
      return this.state
    const persisted = {
      ...this.state,
    }
    if (this.accountPersistenceBackup) {
      persisted.users = structuredClone(this.accountPersistenceBackup.users)
      persisted.ledger = structuredClone(this.accountPersistenceBackup.ledger)
    }
    if (this.projectWorkspacePersistenceBackup) {
      persisted.projects = structuredClone(this.projectWorkspacePersistenceBackup.projects)
      persisted.assets = structuredClone(this.projectWorkspacePersistenceBackup.assets)
      persisted.shots = structuredClone(this.projectWorkspacePersistenceBackup.shots)
    }
    if (this.generationTaskPersistenceBackup) {
      persisted.tasks = structuredClone(this.generationTaskPersistenceBackup.tasks)
    }
    if (this.aiJobPersistenceBackup) {
      persisted.aiJobs = structuredClone(this.aiJobPersistenceBackup.aiJobs)
    }
    if (this.libraryPersistenceBackup) {
      persisted.assetLibraryItems = structuredClone(this.libraryPersistenceBackup.assetLibraryItems)
      persisted.assetLibraryItemVersions = structuredClone(this.libraryPersistenceBackup.assetLibraryItemVersions)
    }
    return persisted
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
  const modifiedAt = Number.isFinite(createdAt)
    ? createdAt
    : ((await stat(lockPath).catch(() => null))?.mtimeMs ?? Number.NaN)
  if (Number.isFinite(modifiedAt) && Date.now() - modifiedAt > 120_000) {
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
  const memberId = 'user-member'
  const ownerId = 'user-owner'
  const superAdminId = 'user-super-admin'
  const projectId = 'project-midnight-film'

  return {
    users: [
      {
        id: memberId,
        email: bootstrapUsers.memberEmail.toLowerCase(),
        name: bootstrapUsers.memberName ?? '默认 C 端用户',
        passwordHash: hashPassword(bootstrapUsers.memberPassword),
        tenantId,
        roles: ['member'],
        plan: 'free',
        credits: 286,
        passwordResetRequired: false,
        emailVerified: true,
      },
      {
        id: ownerId,
        email: bootstrapUsers.ownerEmail.toLowerCase(),
        name: bootstrapUsers.ownerName ?? '平台所有者',
        passwordHash: hashPassword(bootstrapUsers.ownerPassword),
        tenantId,
        roles: ['owner'],
        plan: 'member',
        credits: 1_000,
        passwordResetRequired: false,
        emailVerified: true,
      },
      {
        id: superAdminId,
        email: bootstrapUsers.superAdminEmail.toLowerCase(),
        name: bootstrapUsers.superAdminName ?? '超级管理员',
        passwordHash: hashPassword(bootstrapUsers.superAdminPassword),
        tenantId,
        roles: ['super_admin'],
        plan: 'member',
        credits: 1_000,
        passwordResetRequired: false,
        emailVerified: true,
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
        passwordResetRequired: false,
        emailVerified: true,
      },
    ],
    projects: demoWorkspace
      ? [
          {
            id: projectId,
            tenantId,
            ownerId: memberId,
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
    aiJobs: [],
    media: [],
    assetLibraryItems: [],
    assetLibraryItemVersions: [],
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
        userId: memberId,
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

function createEmptyState(): AppState {
  return {
    users: [],
    projects: [],
    assets: [],
    shots: [],
    tasks: [],
    aiJobs: [],
    ledger: [],
    media: [],
    assetLibraryItems: [],
    assetLibraryItemVersions: [],
    novelDocuments: [],
    novelChapters: [],
    novelChapterSummaries: [],
    novelSummaryQueues: [],
    novelSummaryQueueItems: [],
    novelBoundaries: [],
    novelStoryBibles: [],
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
      ethnicity: 'unspecified',
      skinTone: 'unspecified',
      eyeColor: 'unspecified',
      hairColor: 'unspecified',
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
      appearanceVariants: [],
      activeAppearanceVariantId: null,
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
      characterAssetId: null,
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
    episodeBreakBefore: false,
    episodeNumber: 1,
    episodeTitle: '主故事',
    episodeKind: 'standard' as const,
    createdAt: now,
    updatedAt: now,
  }))
}

function normalizeState(
  input: Partial<AppState>,
  options: { normalizeLegacyRoleAliases?: boolean } = {},
): AppState {
  const users = (input.users ?? []).map((user) => ({
    ...user,
    roles: normalizeStoredRoles(
      (user as { roles?: readonly unknown[] }).roles ?? [],
      options.normalizeLegacyRoleAliases ?? true,
    ),
  }))
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
    users,
    projects: input.projects ?? [],
    assets,
    shots: (input.shots ?? []).map((shot) => ({
      ...shot,
      negativePrompt: shot.negativePrompt ?? '',
      continuityMode: shot.continuityMode ?? 'independent',
      continuityNote: shot.continuityNote ?? '',
      episodeBreakBefore: shot.episodeBreakBefore ?? false,
      episodeNumber: shot.episodeNumber ?? 1,
      episodeTitle: shot.episodeTitle ?? '主故事',
      episodeKind: shot.episodeKind ?? 'standard',
    })),
    tasks: tasks.map((task) => normalizeGenerationTaskLifecycle(task)),
    aiJobs: (input.aiJobs ?? []).map((job) => normalizeAiJobLifecycle(job)),
    ledger: input.ledger ?? [],
    media: input.media ?? [],
    assetLibraryItems: normalizeAssetLibraryItems(input.assetLibraryItems ?? []),
    assetLibraryItemVersions: normalizeAssetLibraryItemVersions(input.assetLibraryItemVersions ?? []),
    novelDocuments: input.novelDocuments ?? [],
    novelChapters: input.novelChapters ?? [],
    novelChapterSummaries: input.novelChapterSummaries ?? [],
    novelSummaryQueues: input.novelSummaryQueues ?? [],
    novelSummaryQueueItems: input.novelSummaryQueueItems ?? [],
    novelBoundaries: input.novelBoundaries ?? [],
    novelStoryBibles: input.novelStoryBibles ?? [],
  }
}

function normalizeAssetLibraryItems(items: readonly unknown[]): AssetLibraryItemRecord[] {
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Partial<AssetLibraryItemRecord>
    const parsed = assetLibraryItemRecordSchema.safeParse({
      ...record,
      description: typeof record.description === 'string' ? record.description : '',
      sourceProjectId: nullableString(record.sourceProjectId),
      sourceProjectName: nullableString(record.sourceProjectName),
      sourceAssetId: nullableString(record.sourceAssetId),
      sourceTaskId: nullableString(record.sourceTaskId),
      sourceMediaId: nullableString(record.sourceMediaId),
      sourceSnapshot:
        record.sourceSnapshot && typeof record.sourceSnapshot === 'object' && !Array.isArray(record.sourceSnapshot)
          ? record.sourceSnapshot
          : {},
      contentHash: typeof record.contentHash === 'string' && record.contentHash ? record.contentHash : `legacy:${record.id}`,
      previewStorageKey: nullableString(record.previewStorageKey),
      sizeBytes: Number(record.sizeBytes),
      duplicateOfItemId: nullableString(record.duplicateOfItemId),
      currentVersion: Number(record.currentVersion ?? 1),
      tags: Array.isArray(record.tags) ? record.tags : [],
      restoredAt: nullableString(record.restoredAt),
      deletedAt: nullableString(record.deletedAt),
    })
    return parsed.success ? [parsed.data] : []
  })
}

function normalizeAssetLibraryItemVersions(items: readonly unknown[]): AssetLibraryItemVersionRecord[] {
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Partial<AssetLibraryItemVersionRecord>
    const itemId = typeof record.itemId === 'string' && record.itemId ? record.itemId : ''
    const version = Number(record.version ?? 1)
    const parsed = assetLibraryItemVersionRecordSchema.safeParse({
      ...record,
      id: typeof record.id === 'string' && record.id ? record.id : `${itemId}:v${version}`,
      itemId,
      version,
      sourceSnapshot:
        record.sourceSnapshot && typeof record.sourceSnapshot === 'object' && !Array.isArray(record.sourceSnapshot)
          ? record.sourceSnapshot
          : {},
      contentHash: typeof record.contentHash === 'string' && record.contentHash ? record.contentHash : `legacy:${itemId}`,
      sizeBytes: Number(record.sizeBytes),
      createdBy: typeof record.createdBy === 'string' && record.createdBy ? record.createdBy : record.ownerUserId,
    })
    return parsed.success ? [parsed.data] : []
  })
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function normalizeStoredRoles(roles: readonly unknown[], normalizeLegacyRoleAliases: boolean): Role[] {
  const allowed = new Set([
    'member',
    'admin',
    'organization_admin',
    'organization_member',
    'super_admin',
    'owner',
  ])
  const normalized = roles.flatMap((role) =>
    normalizeLegacyRoleAliases && String(role) === 'creator' ? ['member'] : [String(role)],
  )
  return [...new Set(normalized.filter((role) => allowed.has(role)))].map((role) => role as Role)
}

const DEFAULT_SCRIPT = `雨夜，临港市旧火车站。

林夏撑着一把透明雨伞，站在停运多年的三号站台。她收到一封没有署名的信，约她午夜来取回父亲留下的胶片。

钟声响起，周野从候车室的阴影里走出。他把一只旧铁盒放到长椅上，却提醒林夏：胶片记录的并不是过去，而是明天。

远处传来列车进站声。空无一物的铁轨上，灯光穿透雨幕。林夏打开铁盒，看见胶片第一格正是此刻的自己。`
