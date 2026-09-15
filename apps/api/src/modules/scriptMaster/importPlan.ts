import { createHash } from 'node:crypto'
import {
  createAssetSchema,
  createShotSchema,
  type Asset,
  type Project,
  type ScriptEpisode,
  type Shot,
  type ScriptMasterImportRequest,
  type ScriptMasterImportReceipt,
} from '@seqora/contracts'
import { defaultAssetAttributes } from '../../infra/storeNormalization.js'
import { AppError } from '../../core/errors.js'

export type ImportWorkspace = {
  project: Project
  scriptEpisodes: ScriptEpisode[]
  assets: Asset[]
  shots: Shot[]
}

export function importedId(
  input: Pick<ScriptMasterImportRequest, 'targetProjectId' | 'sourceProjectId'>,
  kind: string,
  sourceId: string,
): string {
  const hex = createHash('sha256')
    .update(JSON.stringify([input.targetProjectId, input.sourceProjectId, kind, sourceId]))
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function planImport(
  workspace: ImportWorkspace,
  input: ScriptMasterImportRequest,
  actorId: string,
  now = new Date().toISOString(),
) {
  const { project } = workspace
  if (project.contentType !== 'short-drama' || project.status === 'archived')
    throw new AppError(409, 'IMPORT_PROJECT_UNSUPPORTED', '请选择未归档的网剧项目')
  const receipt: ScriptMasterImportReceipt = {
    status: 'completed',
    targetProjectId: project.id,
    importedEpisodes: 0,
    updatedEpisodes: 0,
    importedAssets: 0,
    updatedAssets: 0,
    preservedAssets: 0,
    importedShots: 0,
    updatedShots: 0,
    completedAt: now,
  }
  const episodes: ScriptEpisode[] = []
  const assets: Asset[] = []
  const shots: Shot[] = []
  const incomingOrder = new Map<string, number>()
  let nextOrder = Math.max(0, ...workspace.shots.map((s) => s.order))
  const common = { projectId: project.id, tenantId: project.tenantId, createdAt: now, updatedAt: now }
  for (const entry of input.episodes.slice().sort((a, b) => a.episodeNumber - b.episodeNumber)) {
    const id = importedId(input, 'episode', entry.sourceEpisodeId)
    const current = workspace.scriptEpisodes.find((e) => e.id === id)
    if (workspace.scriptEpisodes.some((e) => e.episodeNumber === entry.episodeNumber && e.id !== id))
      throw new AppError(
        409,
        'IMPORT_EPISODE_CONFLICT',
        `第 ${entry.episodeNumber} 集已存在其他来源的正文，请选择空项目或原绑定项目`,
      )
    if (current && current.episodeNumber !== entry.episodeNumber)
      throw new AppError(
        409,
        'IMPORT_EPISODE_RENUMBERED',
        '来源集数编号已变化，请导入新项目以保留原镜头对应关系',
      )
    const changed = !current || current.content !== entry.content || current.title !== entry.title
    const existingShots = workspace.shots.filter((shot) => shot.scriptEpisodeId === id)
    if (changed && existingShots.length && entry.shots === undefined)
      throw new AppError(
        409,
        'IMPORT_STORYBOARD_REQUIRED',
        `第 ${entry.episodeNumber} 集已有分镜，请同时导入与正文一致的分镜，或使用新项目`,
      )
    if (entry.shots !== undefined && existingShots.length) {
      const incoming = new Set(
        entry.shots.map((shot) => importedId(input, 'shot', `${entry.sourceEpisodeId}:${shot.sourceShotId}`)),
      )
      if (existingShots.some((shot) => !incoming.has(shot.id)))
        throw new AppError(
          409,
          'IMPORT_SHOT_REMOVAL_CONFLICT',
          `第 ${entry.episodeNumber} 集有主站新增或来源已删除的镜头，请导入新项目以保留原制作版本`,
        )
    }
    if (changed) {
      episodes.push({
        ...common,
        ...current,
        id,
        episodeNumber: entry.episodeNumber,
        title: entry.title,
        content: entry.content,
        draftContent: '',
        status: 'saved',
        summary: entry.content.replace(/\s+/g, ' ').slice(0, 500),
        continuityState: {},
        revision: (current?.revision ?? 0) + 1,
        lastEditedBy: actorId,
        updatedAt: now,
      })
      receipt[current ? 'updatedEpisodes' : 'importedEpisodes']++
    }
    for (const [index, source] of (entry.shots ?? []).entries()) {
      const shotId = importedId(input, 'shot', `${entry.sourceEpisodeId}:${source.sourceShotId}`)
      incomingOrder.set(shotId, index)
      const previous = workspace.shots.find((s) => s.id === shotId)
      const fields = createShotSchema.parse({
        title: source.title,
        framing: source.framing,
        duration: source.duration,
        prompt: source.prompt,
        scriptEpisodeId: id,
        episodeNumber: entry.episodeNumber,
        episodeTitle: entry.title,
        continuityMode: index === 0 ? 'independent' : 'continue',
        continuityNote: source.continuityNote,
        episodeBreakBefore: index === 0,
      })
      const modified =
        !previous ||
        [
          'title',
          'framing',
          'duration',
          'prompt',
          'continuityNote',
          'continuityMode',
          'episodeBreakBefore',
          'episodeTitle',
        ].some((key) => previous[key as keyof Shot] !== fields[key as keyof typeof fields])
      if (!modified) continue
      if (previous && (previous.imageUrl || previous.selectedImageTaskId || previous.selectedVideoTaskId))
        throw new AppError(
          409,
          'IMPORT_SHOT_HAS_MEDIA',
          `镜头“${previous.title}”已有定稿媒体，请将新版分镜导入新项目`,
        )
      shots.push({
        ...common,
        ...previous,
        ...fields,
        id: shotId,
        order: previous?.order ?? ++nextOrder,
        updatedAt: now,
      })
      receipt[previous ? 'updatedShots' : 'importedShots']++
    }
  }
  for (const entry of input.assets) {
    const id = importedId(input, 'asset', entry.sourceAssetId)
    const previous = workspace.assets.find((a) => a.id === id)
    if (previous && previous.kind !== entry.kind)
      throw new AppError(409, 'IMPORT_ASSET_KIND_CHANGED', '同一来源资产的分类不能改变，请使用新的来源编号')
    if (
      previous &&
      (previous.status === 'confirmed' ||
        previous.imageUrl ||
        previous.references.length ||
        (previous.attributes.type === 'character' && previous.attributes.faceReference))
    ) {
      receipt.preservedAssets++
      continue
    }
    const attributes = defaultAssetAttributes(entry.kind)
    if ('visualStyle' in attributes) attributes.visualStyle = project.visualStyle ?? 'cinematic-cg'
    if (attributes.type === 'character') {
      attributes.subjectType = entry.subjectType
      attributes.gender = 'unspecified'
    }
    const fields = createAssetSchema.parse({
      kind: entry.kind,
      name: entry.name,
      description: entry.description,
      prompt: entry.prompt,
      sourceMode: 'generate',
      attributes,
    })
    if (
      previous &&
      previous.name === entry.name &&
      previous.description === entry.description &&
      previous.prompt === entry.prompt
    )
      continue
    assets.push({
      ...common,
      ...fields,
      ...previous,
      id,
      name: entry.name,
      description: entry.description,
      prompt: entry.prompt,
      status: 'draft',
      updatedAt: now,
    })
    receipt[previous ? 'updatedAssets' : 'importedAssets']++
  }
  const byId = new Map(workspace.scriptEpisodes.map((e) => [e.id, e]))
  episodes.forEach((e) => byId.set(e.id, e))
  const script = [...byId.values()]
    .filter((e) => e.status === 'saved')
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((e) => e.content.trim())
    .join('\n\n【强制下一集】\n\n')
  // Importing episode 2 before episode 1 must still produce the correct playback order.
  const ordered = new Map(workspace.shots.map((s) => [s.id, s]))
  shots.forEach((s) => ordered.set(s.id, s))
  const changedShots = new Map(shots.map((s) => [s.id, s]))
  ;[...ordered.values()]
    .sort(
      (a, b) =>
        a.episodeNumber - b.episodeNumber ||
        (incomingOrder.get(a.id) ?? a.order) - (incomingOrder.get(b.id) ?? b.order),
    )
    .forEach((s, index) => {
      if (s.order !== index + 1) changedShots.set(s.id, { ...s, order: index + 1, updatedAt: now })
    })
  return {
    episodes,
    assets,
    shots: [...changedShots.values()],
    project: { ...project, script, updatedAt: now },
    receipt,
  }
}
