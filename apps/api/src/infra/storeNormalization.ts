import { assetLibraryItemRecordSchema, assetLibraryItemVersionRecordSchema } from '@seqora/contracts'
import type { Asset, AssetLibraryItemRecord, AssetLibraryItemVersionRecord, Role } from '@seqora/contracts'
import { normalizeAiJobLifecycle } from '../core/jobs/aiJobLease.js'
import { normalizeGenerationTaskLifecycle } from '../core/jobs/taskLease.js'
import type { AppState } from './store.js'

export function removeLegacyDemoCharacters(state: AppState): AppState {
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
  if (kind === 'brand') {
    return {
      type: 'brand',
      brandType: 'logo',
      usage: 'general',
      background: 'transparent',
      layout: 'centered',
      exactText: '',
      palette: '',
      visualStyle: 'cinematic-cg',
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

export function normalizeState(
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
  const projects = input.projects ?? []
  const storedEpisodes = input.scriptEpisodes ?? []
  const migratedEpisodes = projects.flatMap((project) => {
    if (
      project.contentType !== 'short-drama' ||
      !project.script.trim() ||
      storedEpisodes.some(
        (episode) => episode.projectId === project.id && episode.tenantId === project.tenantId,
      )
    ) {
      return []
    }
    return [
      {
        id: `legacy-${project.id}`,
        projectId: project.id,
        tenantId: project.tenantId,
        episodeNumber: 1,
        title: '第 1 集',
        content: project.script,
        draftContent: '',
        status: 'saved' as const,
        summary: project.script.replace(/\s+/g, ' ').slice(0, 500),
        continuityState: {},
        revision: 1,
        lastEditedBy: project.ownerId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ]
  })
  return {
    users,
    projects,
    scriptEpisodes: [...storedEpisodes, ...migratedEpisodes].map((episode) => ({
      ...episode,
      draftContent: episode.draftContent ?? '',
      status: episode.status ?? 'saved',
      summary: episode.summary ?? episode.content.replace(/\s+/g, ' ').slice(0, 500),
      continuityState: episode.continuityState ?? {},
      revision: episode.revision ?? 1,
    })),
    assets,
    shots: (input.shots ?? []).map((shot) => ({
      ...shot,
      scriptEpisodeId: shot.scriptEpisodeId ?? null,
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
        record.sourceSnapshot &&
        typeof record.sourceSnapshot === 'object' &&
        !Array.isArray(record.sourceSnapshot)
          ? record.sourceSnapshot
          : {},
      contentHash:
        typeof record.contentHash === 'string' && record.contentHash
          ? record.contentHash
          : `legacy:${record.id}`,
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
        record.sourceSnapshot &&
        typeof record.sourceSnapshot === 'object' &&
        !Array.isArray(record.sourceSnapshot)
          ? record.sourceSnapshot
          : {},
      contentHash:
        typeof record.contentHash === 'string' && record.contentHash
          ? record.contentHash
          : `legacy:${itemId}`,
      sizeBytes: Number(record.sizeBytes),
      createdBy:
        typeof record.createdBy === 'string' && record.createdBy ? record.createdBy : record.ownerUserId,
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
