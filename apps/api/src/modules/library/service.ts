import type {
  Asset,
  AssetLibraryDedupeResult,
  AssetLibraryDuplicatesResponse,
  AssetLibraryImportResult,
  AssetLibraryItemRecord,
  AssetLibraryItemVersionListResponse,
  AssetLibraryItemVersionRecord,
  AssetLibraryItemVersionView,
  AssetLibraryItemView,
  AssetLibraryListResponse,
  AssetLibraryStatsResponse,
  CreateAssetLibraryItem,
  CreateAssetLibraryItemVersion,
  GenerationTask,
  ImportAssetLibraryItem,
  ListAssetLibraryItemsQuery,
  MediaKind,
  Principal,
  SaveProjectAssetToLibrary,
  UpdateAssetLibraryItem,
} from '@seqora/contracts'
import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../../core/errors.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { StoredMedia } from '../../infra/store.js'
import type { GenerationTaskRepository } from '../generation/repository.js'
import type { MediaRepository } from '../media/repository.js'
import type { ProjectRepository } from '../projects/repository.js'
import type { AssetLibraryRepository } from './repository.js'
import { createStoredZip } from './zip.js'

type LibraryContent = {
  item: AssetLibraryItemRecord
  content: Buffer
  contentType: string
  fileName: string
}

type StoredContentSource = {
  kind: AssetLibraryItemRecord['kind']
  title?: string | undefined
  description?: string | undefined
  tags?: string[] | undefined
  sourceProjectId: string | null
  sourceProjectName: string | null
  sourceAssetId: string | null
  sourceTaskId: string | null
  sourceMediaId: string | null
  sourceSnapshot: Record<string, unknown>
  content: Buffer
  contentType: string
}

type StoredContentLocation = {
  storageKey: string
  previewStorageKey: string | null
  contentHash: string
  duplicateOfItemId: string | null
  shouldStoreContent: boolean
}

export class AssetLibraryService {
  constructor(
    private readonly repository: AssetLibraryRepository,
    private readonly projects: ProjectRepository,
    private readonly mediaRepository: MediaRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly generationTasks: GenerationTaskRepository | null = null,
  ) {}

  async list(
    query: ListAssetLibraryItemsQuery,
    principal: Principal,
  ): Promise<AssetLibraryListResponse> {
    const result = await this.repository.list(query, principal)
    return {
      ...result,
      items: result.items.map((item) => this.toView(item)),
    }
  }

  async get(itemId: string, principal: Principal): Promise<AssetLibraryItemView> {
    const item = await this.repository.find(itemId, principal)
    if (!item) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    return this.toView(item)
  }

  async create(input: CreateAssetLibraryItem, principal: Principal): Promise<AssetLibraryItemView> {
    const source = await this.resolveContentSource(input, principal)
    if (!source.title) throw new AppError(400, 'LIBRARY_TITLE_REQUIRED', 'Asset title is required')
    return this.createStoredItem(
      {
        ...source,
        title: source.title,
        description: source.description ?? '',
        tags: source.tags ?? [],
      },
      principal,
    )
  }

  async update(
    itemId: string,
    input: UpdateAssetLibraryItem,
    principal: Principal,
  ): Promise<AssetLibraryItemView> {
    const updated = await this.repository.update(itemId, input, principal)
    if (!updated) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    return this.toView(updated)
  }

  async delete(itemId: string, principal: Principal): Promise<void> {
    const deleted = await this.repository.delete(itemId, principal)
    if (!deleted) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
  }

  async restore(itemId: string, principal: Principal): Promise<AssetLibraryItemView> {
    const restored = await this.repository.restore(itemId, principal)
    if (!restored) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    return this.toView(restored)
  }

  async permanentDelete(itemId: string, principal: Principal): Promise<void> {
    const deleted = await this.repository.permanentDelete(itemId, principal)
    if (!deleted) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
  }

  async saveProjectAsset(
    projectId: string,
    assetId: string,
    input: SaveProjectAssetToLibrary,
    principal: Principal,
  ): Promise<AssetLibraryItemView> {
    const workspace = await this.ownedWorkspace(projectId, principal)
    const asset = workspace.assets.find((item) => item.id === assetId)
    if (!asset) throw new AppError(404, 'SOURCE_ASSET_NOT_FOUND', 'Project asset not found')

    const media = await this.mediaForAsset(asset, principal)
    const sourceSnapshot = mergeSnapshot(input.sourceSnapshot, {
      sourceType: 'project-asset',
      project: projectSnapshot(workspace.project),
      asset: assetSnapshot(asset),
      ...(media ? { media: mediaSnapshot(media) } : {}),
    })
    if (media) {
      const content = await this.objectStorage.get(media.storageKey)
      return this.createStoredItem(
        {
          kind: input.kind ?? asset.kind,
          title: input.title,
          description: input.description,
          tags: normalizeTags(input.tags),
          sourceProjectId: workspace.project.id,
          sourceProjectName: workspace.project.name,
          sourceAssetId: asset.id,
          sourceTaskId: null,
          sourceMediaId: media.id,
          sourceSnapshot,
          content,
          contentType: media.contentType,
        },
        principal,
      )
    }

    const content = Buffer.from(
      JSON.stringify({ project: projectSnapshot(workspace.project), asset: assetSnapshot(asset) }, null, 2),
      'utf8',
    )
    return this.createStoredItem(
      {
        kind: input.kind ?? asset.kind,
        title: input.title,
        description: input.description,
        tags: normalizeTags(input.tags),
        sourceProjectId: workspace.project.id,
        sourceProjectName: workspace.project.name,
        sourceAssetId: asset.id,
        sourceTaskId: null,
        sourceMediaId: null,
        sourceSnapshot,
        content,
        contentType: 'application/json',
      },
      principal,
    )
  }

  async addVersion(
    itemId: string,
    input: CreateAssetLibraryItemVersion,
    principal: Principal,
  ): Promise<AssetLibraryItemVersionListResponse> {
    const item = await this.repository.find(itemId, principal)
    if (!item) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    const source = await this.resolveContentSource(input, principal)
    if (source.kind !== item.kind) {
      throw new AppError(400, 'LIBRARY_VERSION_KIND_MISMATCH', 'New version kind must match the asset kind')
    }
    const nextVersion = item.currentVersion + 1
    const now = new Date().toISOString()
    const versionStorageId = `${item.id}-v${nextVersion}-${randomUUID()}`
    const location = await this.contentLocation(source, principal, item.id, versionStorageId)
    if (location.shouldStoreContent) {
      await this.objectStorage.put(location.storageKey, source.content, source.contentType)
    }
    const version: AssetLibraryItemVersionRecord = {
      id: randomUUID(),
      itemId: item.id,
      tenantId: principal.tenantId,
      ownerUserId: principal.userId,
      version: nextVersion,
      sourceSnapshot: source.sourceSnapshot,
      storageKey: location.storageKey,
      contentHash: location.contentHash,
      contentType: source.contentType,
      sizeBytes: source.content.length,
      createdAt: now,
      createdBy: principal.userId,
    }
    const updated = await this.repository.addVersion(
      item.id,
      version,
      {
        ...(source.title !== undefined ? { title: source.title } : {}),
        ...(source.description !== undefined ? { description: source.description } : {}),
        ...(source.tags !== undefined ? { tags: source.tags } : {}),
        sourceSnapshot: source.sourceSnapshot,
        storageKey: location.storageKey,
        previewStorageKey: location.previewStorageKey,
        contentHash: location.contentHash,
        contentType: source.contentType,
        sizeBytes: source.content.length,
        duplicateOfItemId: location.duplicateOfItemId,
        updatedAt: now,
      },
      principal,
    )
    if (!updated) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    return {
      item: this.toView(updated),
      versions: (await this.repository.listVersions(item.id, principal)).map((record) =>
        this.toVersionView(record),
      ),
    }
  }

  async listVersions(itemId: string, principal: Principal): Promise<AssetLibraryItemVersionListResponse> {
    const item = await this.repository.find(itemId, principal, { includeDeleted: true })
    if (!item) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    return {
      item: this.toView(item),
      versions: (await this.repository.listVersions(itemId, principal)).map((version) =>
        this.toVersionView(version),
      ),
    }
  }

  async stats(principal: Principal): Promise<AssetLibraryStatsResponse> {
    return this.repository.stats(principal)
  }

  async duplicates(principal: Principal): Promise<AssetLibraryDuplicatesResponse> {
    return {
      groups: (await this.repository.duplicates(principal)).map((group) => ({
        ...group,
        items: group.items.map((item) => this.toView(item)),
      })),
    }
  }

  async dedupe(principal: Principal): Promise<AssetLibraryDedupeResult> {
    const result = await this.repository.dedupe(principal)
    return {
      updatedItems: result.updatedItems,
      groups: result.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => this.toView(item)),
      })),
    }
  }

  async importToProject(
    projectId: string,
    input: ImportAssetLibraryItem,
    principal: Principal,
  ): Promise<AssetLibraryImportResult> {
    const workspace = await this.ownedWorkspace(projectId, principal)
    const item = await this.repository.find(input.itemId, principal)
    if (!item) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    const target = input.target === 'auto' ? defaultImportTarget(item) : input.target
    const content = await this.objectStorage.get(item.storageKey)

    if (target === 'script') {
      if (item.kind !== 'script') {
        throw new AppError(400, 'LIBRARY_IMPORT_TARGET_MISMATCH', 'Only script assets can import as text')
      }
      return {
        item: this.toView(item),
        imported: {
          type: 'script',
          content: content.toString('utf8'),
        },
      }
    }

    if (item.kind !== 'image' && item.kind !== 'audio') {
      throw new AppError(400, 'LIBRARY_IMPORT_UNSUPPORTED', 'Only image, script and audio import are supported')
    }
    const mediaKind: MediaKind = item.kind
    const storageKey = projectMediaStorageKey(principal.tenantId, workspace.project.id, item.title, item.contentType)
    await this.objectStorage.put(storageKey, content, item.contentType)
    const media = await this.mediaRepository.create(
      workspace.project.id,
      mediaKind,
      safeFileName(item.title, item.contentType),
      item.contentType,
      content.length,
      storageKey,
      principal,
    )
    return {
      item: this.toView(item),
      imported: {
        type: 'media',
        media,
      },
    }
  }

  async readContent(itemId: string, principal: Principal, preview = false): Promise<LibraryContent> {
    const item = await this.repository.find(itemId, principal)
    if (!item) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    const storageKey = preview ? (item.previewStorageKey ?? item.storageKey) : item.storageKey
    return {
      item,
      content: await this.objectStorage.get(storageKey),
      contentType: item.contentType,
      fileName: safeFileName(item.title, item.contentType),
    }
  }

  async readVersionContent(
    itemId: string,
    versionNumber: number,
    principal: Principal,
  ): Promise<LibraryContent> {
    const [item, version] = await Promise.all([
      this.repository.find(itemId, principal, { includeDeleted: true }),
      this.repository.findVersion(itemId, versionNumber, principal),
    ])
    if (!item || !version) throw new AppError(404, 'LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
    return {
      item,
      content: await this.objectStorage.get(version.storageKey),
      contentType: version.contentType,
      fileName: `${safeBaseName(item.title) || 'asset'}-v${version.version}${extensionForContentType(
        version.contentType,
      )}`,
    }
  }

  async readPackage(itemId: string, principal: Principal): Promise<LibraryContent> {
    const item = await this.repository.find(itemId, principal)
    if (!item) throw new AppError(404, 'LIBRARY_ITEM_NOT_FOUND', 'Library item not found')
    const content = await this.objectStorage.get(item.storageKey)
    const assetFileName = `files/${safeFileName(item.title, item.contentType)}`
    const manifest = Buffer.from(JSON.stringify(packageManifest(item, assetFileName), null, 2), 'utf8')
    return {
      item,
      content: createStoredZip([
        { name: 'manifest.json', content: manifest, modifiedAt: new Date(item.updatedAt) },
        { name: assetFileName, content, modifiedAt: new Date(item.updatedAt) },
      ]),
      contentType: 'application/zip',
      fileName: `${safeBaseName(item.title) || 'asset'}-seqora-package.zip`,
    }
  }

  private async createStoredItem(
    source: StoredContentSource & { title: string; description: string; tags: string[] },
    principal: Principal,
  ): Promise<AssetLibraryItemView> {
    const now = new Date().toISOString()
    const id = randomUUID()
    const location = await this.contentLocation(source, principal, null, id)
    if (location.shouldStoreContent) {
      await this.objectStorage.put(location.storageKey, source.content, source.contentType)
    }
    const record: AssetLibraryItemRecord = {
      id,
      tenantId: principal.tenantId,
      ownerUserId: principal.userId,
      kind: source.kind,
      title: source.title,
      description: source.description,
      sourceProjectId: source.sourceProjectId,
      sourceProjectName: source.sourceProjectName,
      sourceAssetId: source.sourceAssetId,
      sourceTaskId: source.sourceTaskId,
      sourceMediaId: source.sourceMediaId,
      sourceSnapshot: source.sourceSnapshot,
      storageKey: location.storageKey,
      previewStorageKey: location.previewStorageKey,
      contentHash: location.contentHash,
      contentType: source.contentType,
      sizeBytes: source.content.length,
      duplicateOfItemId: location.duplicateOfItemId,
      currentVersion: 1,
      tags: source.tags,
      createdAt: now,
      updatedAt: now,
      restoredAt: null,
      deletedAt: null,
    }
    const version: AssetLibraryItemVersionRecord = {
      id: randomUUID(),
      itemId: id,
      tenantId: principal.tenantId,
      ownerUserId: principal.userId,
      version: 1,
      sourceSnapshot: source.sourceSnapshot,
      storageKey: location.storageKey,
      contentHash: location.contentHash,
      contentType: source.contentType,
      sizeBytes: source.content.length,
      createdAt: now,
      createdBy: principal.userId,
    }
    return this.toView(await this.repository.create(record, version))
  }

  private async contentLocation(
    source: Pick<StoredContentSource, 'kind' | 'title' | 'content' | 'contentType'>,
    principal: Principal,
    currentItemId: string | null = null,
    storageId: string = randomUUID(),
  ): Promise<StoredContentLocation> {
    const contentHash = contentHashFor(source.content)
    const duplicate = await this.repository.findDuplicate(source.kind, contentHash, principal)
    if (duplicate) {
      return {
        storageKey: duplicate.storageKey,
        previewStorageKey: duplicate.previewStorageKey ?? duplicate.storageKey,
        contentHash,
        duplicateOfItemId:
          duplicate.id === currentItemId ? null : (duplicate.duplicateOfItemId ?? duplicate.id),
        shouldStoreContent: false,
      }
    }
    return {
      storageKey: libraryStorageKey(
        principal.tenantId,
        principal.userId,
        storageId,
        source.title ?? 'asset',
        source.contentType,
      ),
      previewStorageKey: null,
      contentHash,
      duplicateOfItemId: null,
      shouldStoreContent: true,
    }
  }

  private async resolveContentSource(
    input: CreateAssetLibraryItem | CreateAssetLibraryItemVersion,
    principal: Principal,
  ): Promise<StoredContentSource> {
    const workspace = await this.ownedWorkspace(input.projectId, principal)
    const title = 'title' in input ? input.title : undefined
    const description = 'description' in input ? input.description : undefined
    const tags = 'tags' in input && input.tags ? normalizeTags(input.tags) : undefined

    if (input.sourceType === 'media') {
      const media = await this.mediaRepository.find(input.mediaId, principal)
      if (!media || media.projectId !== input.projectId || media.kind !== input.kind) {
        throw new AppError(404, 'SOURCE_MEDIA_NOT_FOUND', 'Source media not found')
      }
      const content = await this.objectStorage.get(media.storageKey)
      return {
        kind: input.kind,
        title,
        description,
        tags,
        sourceProjectId: workspace.project.id,
        sourceProjectName: workspace.project.name,
        sourceAssetId: null,
        sourceTaskId: input.sourceTaskId ?? null,
        sourceMediaId: media.id,
        sourceSnapshot: mergeSnapshot(input.sourceSnapshot, {
          sourceType: 'media',
          media: mediaSnapshot(media),
          project: projectSnapshot(workspace.project),
        }),
        content,
        contentType: media.contentType,
      }
    }

    if (input.sourceType === 'text') {
      const content = Buffer.from(input.content, 'utf8')
      return {
        kind: 'script',
        title,
        description,
        tags,
        sourceProjectId: workspace.project.id,
        sourceProjectName: workspace.project.name,
        sourceAssetId: null,
        sourceTaskId: null,
        sourceMediaId: null,
        sourceSnapshot: mergeSnapshot(input.sourceSnapshot, {
          sourceType: 'text',
          project: projectSnapshot(workspace.project),
          contentLength: input.content.length,
          contentPreview: input.content.slice(0, 2_000),
        }),
        content,
        contentType: 'text/plain; charset=utf-8',
      }
    }

    const task = await this.generationTasks?.findById(input.taskId, principal)
    if (!task || task.projectId !== input.projectId) {
      throw new AppError(404, 'SOURCE_TASK_NOT_FOUND', 'Source task not found')
    }
    if (task.status !== 'completed' || task.kind !== 'video') {
      throw new AppError(409, 'SOURCE_TASK_NOT_READY', 'Only completed video tasks can be saved')
    }
    const isFilmPreview = task.metadata?.generationStage === 'film-preview' || task.provider === 'local-compose'
    if (input.kind === 'final-cut' && !isFilmPreview) {
      throw new AppError(400, 'SOURCE_TASK_KIND_MISMATCH', 'Final cut assets require a film preview task')
    }
    if (input.kind === 'video' && isFilmPreview) {
      throw new AppError(400, 'SOURCE_TASK_KIND_MISMATCH', 'Video assets require a shot video task')
    }
    const descriptor = taskVideoDescriptor(task)
    if (!descriptor) {
      throw new AppError(404, 'SOURCE_TASK_CONTENT_NOT_FOUND', 'Task video file was not persisted')
    }
    const content = await this.objectStorage.get(descriptor.storageKey)
    return {
      kind: input.kind,
      title,
      description,
      tags,
      sourceProjectId: workspace.project.id,
      sourceProjectName: workspace.project.name,
      sourceAssetId: null,
      sourceTaskId: task.id,
      sourceMediaId: null,
      sourceSnapshot: mergeSnapshot(input.sourceSnapshot, {
        sourceType: 'task',
        project: projectSnapshot(workspace.project),
        task: taskSnapshot(task),
        sourceFile: {
          view: descriptor.view,
          contentType: descriptor.contentType,
          size: descriptor.size ?? content.length,
        },
      }),
      content,
      contentType: descriptor.contentType,
    }
  }

  private async ownedWorkspace(projectId: string, principal: Principal) {
    const workspace = await this.projects.workspace(projectId, principal)
    if (!workspace || workspace.project.ownerId !== principal.userId) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    }
    return workspace
  }

  private async mediaForAsset(asset: Asset, principal: Principal): Promise<StoredMedia | null> {
    const candidates = [
      ...asset.references.map((reference) => reference.id),
      ...asset.references.flatMap((reference) => mediaIdFromUrl(reference.url) ?? []),
      mediaIdFromUrl(asset.imageUrl),
    ].filter((value): value is string => Boolean(value))

    for (const mediaId of candidates) {
      const media = await this.mediaRepository.find(mediaId, principal)
      if (media && media.projectId === asset.projectId) return media
    }
    return null
  }

  private toView(item: AssetLibraryItemRecord): AssetLibraryItemView {
    const encoded = encodeURIComponent(item.id)
    const publicItem = {
      id: item.id,
      tenantId: item.tenantId,
      ownerUserId: item.ownerUserId,
      kind: item.kind,
      title: item.title,
      description: item.description,
      sourceProjectId: item.sourceProjectId,
      sourceProjectName: item.sourceProjectName,
      sourceAssetId: item.sourceAssetId,
      sourceTaskId: item.sourceTaskId,
      sourceMediaId: item.sourceMediaId,
      sourceSnapshot: item.sourceSnapshot,
      contentHash: item.contentHash,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      duplicateOfItemId: item.duplicateOfItemId,
      currentVersion: item.currentVersion,
      tags: item.tags,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      restoredAt: item.restoredAt,
      deletedAt: item.deletedAt,
    }
    return {
      ...publicItem,
      previewUrl: `/api/v1/library/items/${encoded}/preview`,
      downloadUrl: `/api/v1/library/items/${encoded}/download`,
      packageUrl: `/api/v1/library/items/${encoded}/package`,
    }
  }

  private toVersionView(version: AssetLibraryItemVersionRecord): AssetLibraryItemVersionView {
    return {
      id: version.id,
      itemId: version.itemId,
      tenantId: version.tenantId,
      ownerUserId: version.ownerUserId,
      version: version.version,
      sourceSnapshot: version.sourceSnapshot,
      contentHash: version.contentHash,
      contentType: version.contentType,
      sizeBytes: version.sizeBytes,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      downloadUrl: `/api/v1/library/items/${encodeURIComponent(version.itemId)}/versions/${
        version.version
      }/download`,
    }
  }
}

function defaultImportTarget(item: AssetLibraryItemRecord): 'media' | 'script' {
  return item.kind === 'script' ? 'script' : 'media'
}

function mediaIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  return /^\/api\/v1\/media\/([^/?#]+)$/.exec(value)?.[1] ?? null
}

function mergeSnapshot(
  clientSnapshot: Record<string, unknown> | undefined,
  serverSnapshot: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(clientSnapshot ?? {}),
    ...serverSnapshot,
    savedAt: new Date().toISOString(),
  }
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 30)
}

function contentHashFor(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function projectSnapshot(project: { id: string; name: string; contentType?: string; aspectRatio?: string }) {
  return {
    id: project.id,
    name: project.name,
    contentType: project.contentType,
    aspectRatio: project.aspectRatio,
  }
}

function mediaSnapshot(media: StoredMedia): Record<string, unknown> {
  return {
    id: media.id,
    projectId: media.projectId,
    kind: media.kind,
    name: media.name,
    contentType: media.contentType,
    size: media.size,
    createdAt: media.createdAt,
  }
}

function assetSnapshot(asset: Asset): Record<string, unknown> {
  return {
    id: asset.id,
    projectId: asset.projectId,
    kind: asset.kind,
    sourceMode: asset.sourceMode,
    name: asset.name,
    description: asset.description,
    prompt: asset.prompt,
    promptMode: asset.promptMode,
    customPromptMode: asset.customPromptMode,
    customPrompt: asset.customPrompt,
    negativePrompt: asset.negativePrompt,
    references: asset.references,
    attributes: asset.attributes,
    imageUrl: asset.imageUrl,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

function taskSnapshot(task: GenerationTask): Record<string, unknown> {
  return {
    id: task.id,
    projectId: task.projectId,
    kind: task.kind,
    label: task.label,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    provider: task.provider,
    model: task.model,
    tier: task.tier,
    metadata: task.metadata,
    outputs: task.outputs,
    resultUrl: task.resultUrl,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function taskVideoDescriptor(task: GenerationTask): {
  storageKey: string
  contentType: string
  size?: number
  view: string
} | null {
  if (task.provider === 'local-compose' && typeof task.metadata.previewStorageKey === 'string') {
    return {
      storageKey: task.metadata.previewStorageKey,
      contentType:
        typeof task.metadata.previewContentType === 'string' ? task.metadata.previewContentType : 'video/mp4',
      ...(typeof task.metadata.previewSize === 'number' ? { size: task.metadata.previewSize } : {}),
      view: 'single',
    }
  }
  const generatedOutputs = Array.isArray(task.metadata.generatedOutputs) ? task.metadata.generatedOutputs : []
  const descriptor = generatedOutputs.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item as { view?: unknown }).view === 'single' &&
      typeof (item as { storageKey?: unknown }).storageKey === 'string' &&
      typeof (item as { contentType?: unknown }).contentType === 'string' &&
      String((item as { contentType: string }).contentType).startsWith('video/'),
  ) as { storageKey: string; contentType: string; size?: unknown; view?: unknown } | undefined
  if (descriptor) {
    return {
      storageKey: descriptor.storageKey,
      contentType: descriptor.contentType,
      ...(typeof descriptor.size === 'number' ? { size: descriptor.size } : {}),
      view: typeof descriptor.view === 'string' ? descriptor.view : 'single',
    }
  }
  if (typeof task.metadata.videoStorageKey === 'string') {
    return {
      storageKey: task.metadata.videoStorageKey,
      contentType:
        typeof task.metadata.videoContentType === 'string' ? task.metadata.videoContentType : 'video/mp4',
      ...(typeof task.metadata.videoSize === 'number' ? { size: task.metadata.videoSize } : {}),
      view: 'single',
    }
  }
  return null
}

function packageManifest(item: AssetLibraryItemRecord, assetFileName: string): Record<string, unknown> {
  return {
    schema: 'seqora.asset.package.v1',
    exportedAt: new Date().toISOString(),
    asset: {
      id: item.id,
      kind: item.kind,
      title: item.title,
      description: item.description,
      sourceProjectId: item.sourceProjectId,
      sourceProjectName: item.sourceProjectName,
      sourceAssetId: item.sourceAssetId,
      sourceTaskId: item.sourceTaskId,
      sourceMediaId: item.sourceMediaId,
      contentHash: item.contentHash,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      duplicateOfItemId: item.duplicateOfItemId,
      currentVersion: item.currentVersion,
      tags: item.tags,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
    files: [
      {
        path: assetFileName,
        role: item.kind === 'final-cut' ? 'final-cut' : 'source',
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
      },
    ],
    sourceSnapshot: item.sourceSnapshot,
  }
}

function libraryStorageKey(
  tenantId: string,
  userId: string,
  itemId: string,
  title: string,
  contentType: string,
): string {
  return `${tenantId}/library/${userId}/${itemId}-${safeBaseName(title)}${extensionForContentType(contentType)}`
}

function projectMediaStorageKey(
  tenantId: string,
  projectId: string,
  title: string,
  contentType: string,
): string {
  return `${tenantId}/${projectId}/${randomUUID()}-${safeBaseName(title)}${extensionForContentType(contentType)}`
}

function safeFileName(title: string, contentType: string): string {
  return `${safeBaseName(title) || 'asset'}${extensionForContentType(contentType)}`
}

function safeBaseName(value: string): string {
  return String(value || 'asset')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function extensionForContentType(contentType: string): string {
  const normalized = contentType.toLowerCase()
  if (normalized.includes('jpeg')) return '.jpg'
  if (normalized.includes('png')) return '.png'
  if (normalized.includes('webp')) return '.webp'
  if (normalized.includes('mpeg')) return '.mp3'
  if (normalized.includes('wav')) return '.wav'
  if (normalized.includes('ogg')) return '.ogg'
  if (normalized.includes('mp4')) return '.mp4'
  if (normalized.includes('json')) return '.json'
  if (normalized.includes('text/plain')) return '.txt'
  return '.bin'
}
