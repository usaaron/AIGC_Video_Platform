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
  ScriptEpisode,
  Shot,
} from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, open as openFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashPassword } from '../core/auth/password.js'
import { defaultAssetAttributes, normalizeState, removeLegacyDemoCharacters } from './storeNormalization.js'

export { defaultAssetAttributes } from './storeNormalization.js'

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
  scriptEpisodes: ScriptEpisode[]
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

export type RuntimeCacheSlice = 'account' | 'projectWorkspace' | 'generationTasks' | 'aiJobs' | 'library'

type FileSignature = {
  mtimeMs: number
  size: number
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
  private mutationQueue = Promise.resolve()
  private readonly lockPath: string | null
  private readonly databaseBackedRuntime: boolean
  private fileSignature: FileSignature | null = null
  private accountRuntimeCache: Pick<AppState, 'users' | 'ledger'> | null = null
  private accountPersistenceBackup: Pick<AppState, 'users' | 'ledger'> | null = null
  private projectWorkspaceRuntimeCache: Pick<
    AppState,
    'projects' | 'scriptEpisodes' | 'assets' | 'shots'
  > | null = null
  private projectWorkspacePersistenceBackup: Pick<
    AppState,
    'projects' | 'scriptEpisodes' | 'assets' | 'shots'
  > | null = null
  private generationTaskRuntimeCache: Pick<AppState, 'tasks'> | null = null
  private generationTaskPersistenceBackup: Pick<AppState, 'tasks'> | null = null
  private aiJobRuntimeCache: Pick<AppState, 'aiJobs'> | null = null
  private aiJobPersistenceBackup: Pick<AppState, 'aiJobs'> | null = null
  private libraryRuntimeCache: Pick<AppState, 'assetLibraryItems' | 'assetLibraryItemVersions'> | null = null
  private libraryPersistenceBackup: Pick<AppState, 'assetLibraryItems' | 'assetLibraryItemVersions'> | null =
    null

  constructor(
    private readonly filePath: string | null,
    private readonly bootstrapUsers: BootstrapUsers = developmentBootstrapUsers,
    private readonly bootstrapDemoWorkspace = true,
    private readonly bootstrapOnMissingFile = true,
    private readonly normalizeLegacyRoleAliases = true,
    databaseBackedRuntime = false,
  ) {
    this.lockPath = filePath ? `${filePath}.lock` : null
    this.databaseBackedRuntime = databaseBackedRuntime
  }

  async initialize(): Promise<void> {
    if (this.filePath) {
      try {
        this.state = removeLegacyDemoCharacters(
          normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppState>, {
            normalizeLegacyRoleAliases: this.normalizeLegacyRoleAliases,
          }),
        )
        this.fileSignature = await this.readFileSignature()
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

  readGenerationTaskRuntimeCache<T>(reader: (state: Readonly<AppState>) => T): T {
    if (!this.generationTaskRuntimeCache) return this.read(reader)
    this.applyGenerationTaskRuntimeCache()
    return structuredClone(reader(this.state))
  }

  async mutate<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runWrite(mutator)
  }

  async transaction<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runWrite(mutator)
  }

  replaceAccountRuntimeCache(input: Pick<AppState, 'users' | 'ledger'>): void {
    if (!this.databaseBackedRuntime && !this.accountPersistenceBackup) {
      this.accountPersistenceBackup = structuredClone({
        users: this.state.users,
        ledger: this.state.ledger,
      })
    }
    this.accountRuntimeCache = this.databaseBackedRuntime ? input : structuredClone(input)
    this.applyAccountRuntimeCache()
  }

  async replaceAccountRuntimeCacheAsync(input: Pick<AppState, 'users' | 'ledger'>): Promise<void> {
    await this.enqueueMutation(async () => {
      this.replaceAccountRuntimeCache(input)
    })
  }

  mutateAccountRuntimeCache<T>(mutator: (state: AppState) => T): T {
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
    if (!this.databaseBackedRuntime && !this.accountPersistenceBackup) {
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

  async mutateAccountRuntimeCacheAsync<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runRuntimeWrite(mutator, ['account'])
  }

  async mutateRuntimeCachesAsync<T>(
    mutator: (state: AppState) => T | Promise<T>,
    slices: RuntimeCacheSlice[],
  ): Promise<T> {
    return this.runRuntimeWrite(mutator, slices)
  }

  replaceProjectWorkspaceRuntimeCache(
    input: Pick<AppState, 'projects' | 'scriptEpisodes' | 'assets' | 'shots'>,
  ): void {
    if (!this.databaseBackedRuntime && !this.projectWorkspacePersistenceBackup) {
      this.projectWorkspacePersistenceBackup = structuredClone({
        projects: this.state.projects,
        scriptEpisodes: this.state.scriptEpisodes,
        assets: this.state.assets,
        shots: this.state.shots,
      })
    }
    this.projectWorkspaceRuntimeCache = this.databaseBackedRuntime ? input : structuredClone(input)
    this.applyProjectWorkspaceRuntimeCache()
  }

  async replaceProjectWorkspaceRuntimeCacheAsync(
    input: Pick<AppState, 'projects' | 'scriptEpisodes' | 'assets' | 'shots'>,
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      this.replaceProjectWorkspaceRuntimeCache(input)
    })
  }

  replaceGenerationTaskRuntimeCache(tasks: GenerationTask[]): void {
    if (!this.databaseBackedRuntime && !this.generationTaskPersistenceBackup) {
      this.generationTaskPersistenceBackup = structuredClone({ tasks: this.state.tasks })
    }
    this.generationTaskRuntimeCache = {
      tasks: this.databaseBackedRuntime ? tasks : structuredClone(tasks),
    }
    this.applyGenerationTaskRuntimeCache()
  }

  async replaceGenerationTaskRuntimeCacheAsync(tasks: GenerationTask[]): Promise<void> {
    await this.enqueueMutation(async () => {
      this.replaceGenerationTaskRuntimeCache(tasks)
    })
  }

  replaceAiJobRuntimeCache(aiJobs: AiJob[]): void {
    if (!this.databaseBackedRuntime && !this.aiJobPersistenceBackup) {
      this.aiJobPersistenceBackup = structuredClone({ aiJobs: this.state.aiJobs })
    }
    this.aiJobRuntimeCache = {
      aiJobs: this.databaseBackedRuntime ? aiJobs : structuredClone(aiJobs),
    }
    this.applyAiJobRuntimeCache()
  }

  async replaceAiJobRuntimeCacheAsync(aiJobs: AiJob[]): Promise<void> {
    await this.enqueueMutation(async () => {
      this.replaceAiJobRuntimeCache(aiJobs)
    })
  }

  replaceLibraryRuntimeCache(input: Pick<AppState, 'assetLibraryItems' | 'assetLibraryItemVersions'>): void {
    if (!this.databaseBackedRuntime && !this.libraryPersistenceBackup) {
      this.libraryPersistenceBackup = structuredClone({
        assetLibraryItems: this.state.assetLibraryItems,
        assetLibraryItemVersions: this.state.assetLibraryItemVersions,
      })
    }
    this.libraryRuntimeCache = this.databaseBackedRuntime ? input : structuredClone(input)
    this.applyLibraryRuntimeCache()
  }

  async replaceLibraryRuntimeCacheAsync(
    input: Pick<AppState, 'assetLibraryItems' | 'assetLibraryItemVersions'>,
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      this.replaceLibraryRuntimeCache(input)
    })
  }

  mutateLibraryRuntimeCache<T>(mutator: (state: AppState) => T): T {
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
    if (!this.databaseBackedRuntime && !this.libraryPersistenceBackup) {
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

  async mutateLibraryRuntimeCacheAsync<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runRuntimeWrite(mutator, ['library'])
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

  async mutateProjectWorkspaceRuntimeCacheAsync<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runRuntimeWrite(mutator, ['projectWorkspace'])
  }

  mutateGenerationTaskRuntimeCache<T>(mutator: (state: AppState) => T): T {
    this.applyGenerationTaskRuntimeCache()
    const result = mutator(this.state)
    this.captureGenerationTaskRuntimeCache()
    return structuredClone(result)
  }

  async mutateGenerationTaskRuntimeCacheAsync<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runRuntimeWrite(mutator, ['generationTasks'])
  }

  mutateAiJobRuntimeCache<T>(mutator: (state: AppState) => T): T {
    this.applyAiJobRuntimeCache()
    const result = mutator(this.state)
    this.captureAiJobRuntimeCache()
    return structuredClone(result)
  }

  async mutateAiJobRuntimeCacheAsync<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.runRuntimeWrite(mutator, ['aiJobs'])
  }

  private async runWrite<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.enqueueMutation(async () => this.runPersistentWrite(mutator))
  }

  private async runRuntimeWrite<T>(
    mutator: (state: AppState) => T | Promise<T>,
    slices: RuntimeCacheSlice[],
  ): Promise<T> {
    return this.enqueueMutation(async () => {
      if (!this.hasRuntimeCache(slices)) return this.runPersistentWrite(mutator)

      this.applyRuntimeCaches()
      const snapshot = this.databaseBackedRuntime ? null : structuredClone(this.state)
      try {
        const result = await mutator(this.state)
        this.captureRuntimeCaches(slices)
        return result
      } catch (error) {
        if (snapshot) {
          this.state = snapshot
          this.captureRuntimeCaches(['account', 'projectWorkspace', 'generationTasks', 'aiJobs', 'library'])
        }
        throw error
      }
    })
  }

  private async runPersistentWrite<T>(mutator: (state: AppState) => T | Promise<T>): Promise<T> {
    return this.withWriteLock(async () => {
      await this.reloadFromDisk()
      this.applyRuntimeCaches()
      const snapshot = this.databaseBackedRuntime ? null : structuredClone(this.state)
      try {
        const result = await mutator(this.state)
        this.captureRuntimeCaches(['account', 'projectWorkspace', 'generationTasks', 'aiJobs', 'library'])
        await this.persist()
        return result
      } catch (error) {
        if (snapshot) {
          this.state = snapshot
          this.captureRuntimeCaches(['account', 'projectWorkspace', 'generationTasks', 'aiJobs', 'library'])
        }
        throw error
      }
    })
  }

  private enqueueMutation<T>(operation: () => T | Promise<T>): Promise<T> {
    const queuedOperation = this.mutationQueue.then(operation)
    this.mutationQueue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation.then((result) => structuredClone(result))
  }

  private hasRuntimeCache(slices: RuntimeCacheSlice[]): boolean {
    return slices.some((slice) => {
      if (slice === 'account') return this.accountRuntimeCache !== null
      if (slice === 'projectWorkspace') return this.projectWorkspaceRuntimeCache !== null
      if (slice === 'generationTasks') return this.generationTaskRuntimeCache !== null
      if (slice === 'aiJobs') return this.aiJobRuntimeCache !== null
      return this.libraryRuntimeCache !== null
    })
  }

  private applyRuntimeCaches(): void {
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
  }

  private captureRuntimeCaches(slices: RuntimeCacheSlice[]): void {
    for (const slice of slices) {
      if (slice === 'account') this.captureAccountRuntimeCache()
      else if (slice === 'projectWorkspace') this.captureProjectWorkspaceRuntimeCache()
      else if (slice === 'generationTasks') this.captureGenerationTaskRuntimeCache()
      else if (slice === 'aiJobs') this.captureAiJobRuntimeCache()
      else this.captureLibraryRuntimeCache()
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(this.stateForPersistence(), null, 2)}\n`, 'utf8')
      await renameWithRetry(temporary, this.filePath)
      this.fileSignature = await this.readFileSignature()
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  private async reloadFromDisk(): Promise<void> {
    if (!this.filePath) return
    const signature = await this.readFileSignature()
    if (!signature || sameFileSignature(signature, this.fileSignature)) return
    try {
      this.state = removeLegacyDemoCharacters(
        normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppState>, {
          normalizeLegacyRoleAliases: this.normalizeLegacyRoleAliases,
        }),
      )
      this.fileSignature = signature
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
    const signature = this.readFileSignatureSync()
    if (!signature || sameFileSignature(signature, this.fileSignature)) return
    this.state = removeLegacyDemoCharacters(
      normalizeState(JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppState>, {
        normalizeLegacyRoleAliases: this.normalizeLegacyRoleAliases,
      }),
    )
    this.fileSignature = signature
    this.applyAccountRuntimeCache()
    this.applyProjectWorkspaceRuntimeCache()
    this.applyGenerationTaskRuntimeCache()
    this.applyAiJobRuntimeCache()
    this.applyLibraryRuntimeCache()
  }

  private async readFileSignature(): Promise<FileSignature | null> {
    if (!this.filePath) return null
    const file = await stat(this.filePath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    return file ? { mtimeMs: file.mtimeMs, size: file.size } : null
  }

  private readFileSignatureSync(): FileSignature | null {
    if (!this.filePath) return null
    try {
      const file = statSync(this.filePath)
      return { mtimeMs: file.mtimeMs, size: file.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private applyAccountRuntimeCache(): void {
    if (!this.accountRuntimeCache) return
    this.state.users = this.accountRuntimeCache.users
    this.state.ledger = this.accountRuntimeCache.ledger
  }

  private applyProjectWorkspaceRuntimeCache(): void {
    if (!this.projectWorkspaceRuntimeCache) return
    this.state.projects = this.projectWorkspaceRuntimeCache.projects
    this.state.scriptEpisodes = this.projectWorkspaceRuntimeCache.scriptEpisodes
    this.state.assets = this.projectWorkspaceRuntimeCache.assets
    this.state.shots = this.projectWorkspaceRuntimeCache.shots
  }

  private applyGenerationTaskRuntimeCache(): void {
    if (!this.generationTaskRuntimeCache) return
    this.state.tasks = this.generationTaskRuntimeCache.tasks
  }

  private applyAiJobRuntimeCache(): void {
    if (!this.aiJobRuntimeCache) return
    this.state.aiJobs = this.aiJobRuntimeCache.aiJobs
  }

  private applyLibraryRuntimeCache(): void {
    if (!this.libraryRuntimeCache) return
    this.state.assetLibraryItems = this.libraryRuntimeCache.assetLibraryItems
    this.state.assetLibraryItemVersions = this.libraryRuntimeCache.assetLibraryItemVersions
  }

  private captureAccountRuntimeCache(): void {
    if (!this.accountRuntimeCache) return
    this.accountRuntimeCache = {
      users: this.state.users,
      ledger: this.state.ledger,
    }
  }

  private captureProjectWorkspaceRuntimeCache(): void {
    if (!this.projectWorkspaceRuntimeCache) return
    this.projectWorkspaceRuntimeCache = {
      projects: this.state.projects,
      scriptEpisodes: this.state.scriptEpisodes,
      assets: this.state.assets,
      shots: this.state.shots,
    }
  }

  private captureGenerationTaskRuntimeCache(): void {
    if (!this.generationTaskRuntimeCache) return
    this.generationTaskRuntimeCache = { tasks: this.state.tasks }
  }

  private captureAiJobRuntimeCache(): void {
    if (!this.aiJobRuntimeCache) return
    this.aiJobRuntimeCache = { aiJobs: this.state.aiJobs }
  }

  private captureLibraryRuntimeCache(): void {
    if (!this.libraryRuntimeCache) return
    this.libraryRuntimeCache = {
      assetLibraryItems: this.state.assetLibraryItems,
      assetLibraryItemVersions: this.state.assetLibraryItemVersions,
    }
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
      persisted.scriptEpisodes = structuredClone(this.projectWorkspacePersistenceBackup.scriptEpisodes)
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
      persisted.assetLibraryItemVersions = structuredClone(
        this.libraryPersistenceBackup.assetLibraryItemVersions,
      )
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
    scriptEpisodes: demoWorkspace
      ? [
          {
            id: `legacy-${projectId}`,
            projectId,
            tenantId,
            episodeNumber: 1,
            title: '第 1 集',
            content: DEFAULT_SCRIPT,
            draftContent: '',
            status: 'saved',
            summary: DEFAULT_SCRIPT.replace(/\s+/g, ' ').slice(0, 500),
            continuityState: {},
            revision: 1,
            lastEditedBy: memberId,
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
    scriptEpisodes: [],
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
    scriptEpisodeId: `legacy-${projectId}`,
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

function sameFileSignature(left: FileSignature, right: FileSignature | null): boolean {
  return Boolean(right && left.mtimeMs === right.mtimeMs && left.size === right.size)
}

const DEFAULT_SCRIPT = `雨夜，临港市旧火车站。

林夏撑着一把透明雨伞，站在停运多年的三号站台。她收到一封没有署名的信，约她午夜来取回父亲留下的胶片。

钟声响起，周野从候车室的阴影里走出。他把一只旧铁盒放到长椅上，却提醒林夏：胶片记录的并不是过去，而是明天。

远处传来列车进站声。空无一物的铁轨上，灯光穿透雨幕。林夏打开铁盒，看见胶片第一格正是此刻的自己。`
