import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  createAssetSchema,
  createShotSchema,
  type Asset,
  type Project,
  type ScriptEpisode,
  type Shot,
  type ScriptMasterImportRequest,
  type ScriptMasterImportReceipt,
  characterIdentity,
  characterVariantKey,
  characterVariantName,
} from '@seqora/contracts'
import { defaultAssetAttributes } from '../../infra/storeNormalization.js'
import { AppError } from '../../core/errors.js'
import { productionHistory, PRODUCTION_HISTORY_KEY, reviseProduction } from './productionRevision.js'
import { disambiguateEpisodeTitle, findDuplicateEpisodeContent } from '../projects/episodeTitle.js'
import { normalizeScriptMasterProjectContext } from './projectContext.js'

export type ImportWorkspace = {
  project: Project
  scriptEpisodes: ScriptEpisode[]
  assets: Asset[]
  shots: Shot[]
}

type ImportedAsset = ScriptMasterImportRequest['assets'][number]
type CharacterAsset = Asset & {
  kind: 'character'
  attributes: Extract<Asset['attributes'], { type: 'character' }>
}
type CharacterVariant = CharacterAsset['attributes']['appearanceVariants'][number]

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
  const { project: existingProject } = workspace
  const projectContext = normalizeScriptMasterProjectContext(
    existingProject,
    input.projectContext,
    input.episodes[0]?.content,
  )
  const project: Project = { ...existingProject, ...projectContext }
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
  const removedShotIds = new Set<string>()
  const incomingOrder = new Map<string, number>()
  let episodeTextChanged = false
  let nextOrder = Math.max(0, ...workspace.shots.map((s) => s.order))
  const common = { projectId: project.id, tenantId: project.tenantId, createdAt: now, updatedAt: now }
  for (const entry of input.episodes.slice().sort((a, b) => a.episodeNumber - b.episodeNumber)) {
    if (
      entry.assetEvidence &&
      entry.assetEvidence.contentHash !== createHash('sha256').update(entry.content.trim()).digest('hex')
    )
      throw new AppError(
        400,
        'IMPORT_ASSET_EVIDENCE_HASH_MISMATCH',
        `第 ${entry.episodeNumber} 集的资产依据与正文不一致，请重新读取后导入`,
      )
    const id = importedId(input, 'episode', entry.sourceEpisodeId)
    const current = workspace.scriptEpisodes.find((e) => e.id === id)
    // Generated long-form episodes share recurring cast/location scaffolding;
    // the fuzzy duplicate detector is too aggressive for that delivery shape.
    // Keep exact-body protection while retaining fuzzy checks for short input.
    const duplicate = findDuplicateEpisodeContent(
      entry.content,
      [...workspace.scriptEpisodes, ...episodes],
      id,
      { longFormExactOnly: true },
    )
    if (duplicate)
      throw new AppError(
        409,
        'IMPORT_EPISODE_DUPLICATE_CONTENT',
        `第 ${entry.episodeNumber} 集的剧情行动、冲突和结果与第 ${duplicate.episodeNumber} 集重复，疑似剧本大师交接或分集切分重复；已拦截，请检查来源后重试`,
      )
    const title = disambiguateEpisodeTitle(
      entry.title,
      entry.episodeNumber,
      [...workspace.scriptEpisodes, ...episodes],
      id,
    )
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
    const textChanged = !current || current.content !== entry.content || current.title !== title
    const evidenceChanged = !isDeepStrictEqual(
      current?.continuityState.scriptAssetEvidence,
      entry.assetEvidence,
    )
    const deliveryState = current?.continuityState.scriptAssetDesignDelivery
    const deliveryVersion =
      deliveryState && typeof deliveryState === 'object' && 'version' in deliveryState
        ? deliveryState.version
        : undefined
    const assetDesignDeliveryChanged =
      Boolean(deliveryVersion === 'script_asset_design_delivery.v1') !== Boolean(entry.assetDesignsDelivered)
    episodeTextChanged ||= textChanged
    const existingShots = workspace.shots.filter((shot) => shot.scriptEpisodeId === id)
    const revision =
      textChanged && current && existingShots.length && input.storyboardRevision === 'preserve-history'
        ? reviseProduction(current, entry, existingShots, now, (index) =>
            importedId(
              input,
              'revision-shot',
              `${entry.sourceEpisodeId}:${current.revision + 1}:${input.sourceRevision}:${index}`,
            ),
          )
        : undefined
    if (textChanged && existingShots.length && entry.shots === undefined && !revision)
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
    if (textChanged || evidenceChanged || assetDesignDeliveryChanged) {
      const history = current ? productionHistory(current) : []
      const continuityState: ScriptEpisode['continuityState'] = textChanged
        ? history.length
          ? { [PRODUCTION_HISTORY_KEY]: history }
          : {}
        : { ...current!.continuityState }
      if (revision) {
        continuityState[PRODUCTION_HISTORY_KEY] = revision.history
        revision.removedShotIds.forEach((shotId) => removedShotIds.add(shotId))
        revision.shots.forEach((shot, index) => {
          shots.push(shot)
          incomingOrder.set(shot.id, index)
        })
        receipt.revisionSummary ??= { episodeNumbers: [], preservedShots: 0, renewedShots: 0 }
        receipt.revisionSummary.episodeNumbers.push(entry.episodeNumber)
        receipt.revisionSummary.preservedShots += revision.preservedShots
        receipt.revisionSummary.renewedShots += revision.shots.length - revision.preservedShots
        receipt.importedShots += revision.shots.length - revision.preservedShots
      }
      if (entry.assetEvidence) continuityState.scriptAssetEvidence = structuredClone(entry.assetEvidence)
      else delete continuityState.scriptAssetEvidence
      if (entry.assetDesignsDelivered) {
        continuityState.scriptAssetDesignDelivery = {
          version: 'script_asset_design_delivery.v1',
          source: 'model-authored',
        }
      } else {
        delete continuityState.scriptAssetDesignDelivery
      }
      episodes.push({
        ...common,
        ...current,
        id,
        episodeNumber: entry.episodeNumber,
        title,
        content: entry.content,
        draftContent: textChanged ? '' : current!.draftContent,
        status: textChanged ? 'saved' : current!.status,
        summary: textChanged ? entry.content.replace(/\s+/g, ' ').slice(0, 500) : current!.summary,
        continuityState,
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
        episodeTitle: title,
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
  const assetChanges = new Set<string>()
  const preservedAssetIds = new Set<string>()
  const plannedAssets = new Map<string, Asset>()
  const existingCharacters = workspace.assets.filter(
    (asset): asset is CharacterAsset => asset.attributes.type === 'character',
  )
  const characterByReference = new Map<string, CharacterAsset>()

  const referenceKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
  const characterNameKey = (value: string) => referenceKey(characterIdentity(value).name)
  const isCharacterVariantEntry = (entry: ImportedAsset) => {
    const identity = characterIdentity(entry.name)
    return (
      identity.name !== entry.name.trim() ||
      Boolean(
        entry.appearanceVariantId ??
        entry.appearance_variant_id ??
        entry.appearanceVariantName ??
        entry.appearance_variant_name,
      )
    )
  }
  const registerCharacter = (asset: CharacterAsset, ...references: (string | undefined)[]) => {
    for (const reference of references) {
      if (!reference?.trim()) continue
      characterByReference.set(referenceKey(reference), asset)
    }
    characterByReference.set(characterNameKey(asset.name), asset)
    characterByReference.set(referenceKey(asset.name), asset)
  }
  for (const asset of existingCharacters) registerCharacter(asset, asset.id)

  const protectedAsset = (asset: Asset) =>
    asset.status === 'confirmed' ||
    Boolean(asset.imageUrl) ||
    asset.references.length > 0 ||
    (asset.attributes.type === 'character' && Boolean(asset.attributes.faceReference))

  const queueAsset = (asset: Asset, previous: Asset | undefined, options: { preserved?: boolean } = {}) => {
    const firstChange = !assetChanges.has(asset.id) && !preservedAssetIds.has(asset.id)
    if (options.preserved) {
      if (firstChange) receipt.preservedAssets++
      preservedAssetIds.add(asset.id)
      return
    }
    if (firstChange) receipt[previous ? 'updatedAssets' : 'importedAssets']++
    assetChanges.add(asset.id)
    plannedAssets.set(asset.id, asset)
  }

  const findWorkspaceCharacter = (entry: ImportedAsset, targetId: string): CharacterAsset | undefined => {
    const byId = workspace.assets.find((asset) => asset.id === targetId)
    if (byId?.attributes.type === 'character') return byId as CharacterAsset
    const identityKey = characterNameKey(entry.name)
    return existingCharacters.find((asset) => characterNameKey(asset.name) === identityKey)
  }

  // Resolve all character source ids before reading costumes. The model can
  // emit a wardrobe record before its base character record in the payload.
  // Prefer an explicit/base identity before legacy entries such as
  // "Maya-战斗服版本". This lets the latter become a variant of the already
  // registered person instead of creating a second character card.
  const characterEntries = input.assets
    .filter((entry) => entry.kind === 'character')
    .sort((a, b) => Number(isCharacterVariantEntry(a)) - Number(isCharacterVariantEntry(b)))
  const characterTargets = new Map<string, CharacterAsset>()
  const characterTargetsByIdentity = new Map<string, CharacterAsset>()
  const characterVariantEntries: ImportedAsset[] = []
  for (const entry of characterEntries) {
    const identityKey = characterNameKey(entry.name)
    const pending = characterTargetsByIdentity.get(identityKey)
    if (pending) {
      characterTargets.set(entry.sourceAssetId, pending)
      registerCharacter(
        pending,
        entry.sourceAssetId,
        entry.characterRef,
        entry.character_ref,
        entry.characterAssetId,
        entry.character_asset_id,
        entry.baseCharacterAssetId,
        entry.base_character_asset_id,
      )
      if (isCharacterVariantEntry(entry)) characterVariantEntries.push(entry)
      continue
    }
    const importedTargetId = importedId(input, 'asset', entry.sourceAssetId)
    const previous = findWorkspaceCharacter(entry, importedTargetId)
    const id = previous?.id ?? importedTargetId
    if (previous && previous.kind !== entry.kind)
      throw new AppError(409, 'IMPORT_ASSET_KIND_CHANGED', '同一来源资产的分类不能改变，请使用新的来源编号')
    const attributes = defaultAssetAttributes('character') as CharacterAsset['attributes']
    attributes.subjectType = entry.subjectType
    attributes.gender = 'unspecified'
    attributes.visualStyle = project.visualStyle ?? 'cinematic-cg'
    const fields = createAssetSchema.parse({
      kind: 'character',
      name: characterIdentity(entry.name).name,
      description: entry.description,
      prompt: entry.prompt,
      sourceMode: 'generate',
      attributes,
    })
    const candidate = {
      ...common,
      ...fields,
      ...previous,
      id,
      // The character is the stable identity. Legacy payloads may call a
      // default look "Name-标准版"; keep that suffix out of the asset name.
      name: characterIdentity(entry.name).name,
      description: entry.description,
      prompt: entry.prompt,
      status: previous?.status ?? 'draft',
      updatedAt: now,
    } as unknown as CharacterAsset
    characterTargets.set(entry.sourceAssetId, candidate)
    characterTargetsByIdentity.set(identityKey, candidate)
    registerCharacter(
      candidate,
      entry.sourceAssetId,
      importedTargetId,
      entry.characterRef,
      entry.character_ref,
      entry.characterAssetId,
      entry.character_asset_id,
      entry.baseCharacterAssetId,
      entry.base_character_asset_id,
    )
    if (isCharacterVariantEntry(entry)) characterVariantEntries.push(entry)
    if (!previous) {
      queueAsset(candidate, undefined)
    } else if (!protectedAsset(previous)) {
      if (
        previous.name !== candidate.name ||
        previous.description !== candidate.description ||
        previous.prompt !== candidate.prompt
      )
        queueAsset(candidate, previous)
    } else {
      // Media and face confirmation are immutable. Keep the existing body and
      // prompt; wardrobe variants can still be appended below.
      characterTargets.set(entry.sourceAssetId, previous)
      characterTargetsByIdentity.set(identityKey, previous)
      registerCharacter(
        previous,
        entry.sourceAssetId,
        importedTargetId,
        entry.characterRef,
        entry.character_ref,
        entry.characterAssetId,
        entry.character_asset_id,
        entry.baseCharacterAssetId,
        entry.base_character_asset_id,
      )
      queueAsset(previous, previous, { preserved: true })
    }
  }

  const currentCharacterForReference = (entry: ImportedAsset) => {
    const references = [
      entry.characterRef,
      entry.character_ref,
      entry.characterAssetId,
      entry.character_asset_id,
      entry.baseCharacterAssetId,
      entry.base_character_asset_id,
    ]
    for (const reference of references) {
      if (!reference?.trim()) continue
      const resolved = characterByReference.get(referenceKey(reference))
      if (resolved) return resolved

      // Source asset IDs are not part of the host character schema, but the
      // imported host ID is deterministic for a target/source pair. Resolve
      // a later costume-only delivery through that ID so the base character
      // does not need to be sent again in every revision.
      const deterministicId = importedId(input, 'asset', reference)
      const deterministic = workspace.assets.find(
        (asset): asset is CharacterAsset =>
          asset.id === deterministicId && asset.attributes.type === 'character',
      )
      if (deterministic) {
        registerCharacter(deterministic, reference, deterministicId)
        return deterministic
      }
    }
    // Legacy payloads often only carry a suffixed character/costume name.
    // Resolve its base identity when the suffix follows the canonical naming
    // convention; ambiguous unowned costumes remain standalone below.
    return characterByReference.get(characterNameKey(entry.name))
  }

  const variantFor = (entry: ImportedAsset, character: CharacterAsset): CharacterVariant => {
    const variantId =
      entry.appearanceVariantId ??
      entry.appearance_variant_id ??
      importedId(input, 'appearance-variant', `${character.id}:${entry.sourceAssetId}`)
    const rawName = entry.appearanceVariantName ?? entry.appearance_variant_name ?? entry.name
    const variantName = characterVariantName(character.name, rawName).slice(0, 80)
    const continuityNote = entry.continuityNote ?? entry.continuity_note
    const sceneNumbers = entry.sceneNumbers ?? entry.scene_numbers
    return {
      id: variantId,
      name: variantName,
      // The card summary is capped at 1,000 characters, while the complete
      // production detail remains in prompt for image/video generation.
      description: entry.description ? entry.description.slice(0, 1_000) : undefined,
      prompt: entry.prompt || undefined,
      continuityNote: continuityNote || undefined,
      sourceAssetId: entry.sourceAssetId,
      sceneNumbers,
      bodyReference: null,
      turnaroundReferences: [],
      turnaroundLayout: 'sheet',
      createdAt: now,
      updatedAt: now,
    }
  }

  const appendVariant = (character: CharacterAsset, variant: CharacterVariant) => {
    const planned = plannedAssets.get(character.id)
    const current = (planned ?? character) as CharacterAsset
    if (current.attributes.type !== 'character') return
    const variants = [...current.attributes.appearanceVariants]
    const variantKey = characterVariantKey(variant.name)
    const index = variants.findIndex(
      (item) => item.id === variant.id || characterVariantKey(item.name) === variantKey,
    )
    let changed = false
    if (index < 0) {
      variants.push(variant)
      changed = true
    } else {
      const previous = variants[index]!
      const merged: CharacterVariant = {
        ...previous,
        // A later model pass may refine the same stable variant. Keep legacy
        // values only when the new delivery omits that field; otherwise the
        // richer authored detail must replace the stale summary.
        description: variant.description || previous.description,
        prompt: variant.prompt || previous.prompt,
        continuityNote: variant.continuityNote || previous.continuityNote,
        sourceAssetId: previous.sourceAssetId || variant.sourceAssetId,
        sceneNumbers: variant.sceneNumbers?.length ? variant.sceneNumbers : previous.sceneNumbers,
        updatedAt: now,
      }
      if (JSON.stringify(previous) !== JSON.stringify(merged)) {
        variants[index] = merged
        changed = true
      }
    }
    const activeId = current.attributes.activeAppearanceVariantId ?? variants[0]?.id ?? null
    if (activeId !== current.attributes.activeAppearanceVariantId) changed = true
    if (!changed) return
    const updated: CharacterAsset = {
      ...current,
      attributes: {
        ...current.attributes,
        appearanceVariants: variants,
        activeAppearanceVariantId: activeId,
      },
      updatedAt: now,
    }
    queueAsset(
      updated,
      workspace.assets.find((asset) => asset.id === current.id),
    )
    plannedAssets.set(updated.id, updated)
    registerCharacter(updated)
  }

  const associatedCostumes = new Set<string>()
  for (const entry of [
    ...input.assets.filter((item) => item.kind === 'costume'),
    ...characterVariantEntries,
  ]) {
    const character = currentCharacterForReference(entry)
    if (!character) continue
    associatedCostumes.add(entry.sourceAssetId)
    appendVariant(character, variantFor(entry, character))
  }

  // Keep scene/prop assets and legacy costumes without an explicit character
  // reference on the old standalone-asset path for backwards compatibility.
  for (const entry of input.assets.filter(
    (item) =>
      item.kind !== 'character' && !(item.kind === 'costume' && associatedCostumes.has(item.sourceAssetId)),
  )) {
    const id = importedId(input, 'asset', entry.sourceAssetId)
    const previous = workspace.assets.find((a) => a.id === id)
    if (previous && previous.kind !== entry.kind)
      throw new AppError(409, 'IMPORT_ASSET_KIND_CHANGED', '同一来源资产的分类不能改变，请使用新的来源编号')
    if (previous && protectedAsset(previous)) {
      queueAsset(previous, previous, { preserved: true })
      continue
    }
    const attributes = defaultAssetAttributes(entry.kind)
    if ('visualStyle' in attributes) attributes.visualStyle = project.visualStyle ?? 'cinematic-cg'
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
    queueAsset(
      {
        ...common,
        ...fields,
        ...previous,
        id,
        name: entry.name,
        description: entry.description,
        prompt: entry.prompt,
        status: 'draft',
        updatedAt: now,
      },
      previous,
    )
  }
  assets.push(...[...plannedAssets.values()].filter((asset) => !assets.some((item) => item.id === asset.id)))
  const byId = new Map(workspace.scriptEpisodes.map((e) => [e.id, e]))
  episodes.forEach((e) => byId.set(e.id, e))
  const script =
    input.episodes.length && !episodeTextChanged
      ? project.script
      : [...byId.values()]
          .filter((e) => e.status === 'saved')
          .sort((a, b) => a.episodeNumber - b.episodeNumber)
          .map((e) => e.content.trim())
          .join('\n\n【强制下一集】\n\n')
  // Importing episode 2 before episode 1 must still produce the correct playback order.
  const ordered = new Map(
    workspace.shots.filter((shot) => !removedShotIds.has(shot.id)).map((s) => [s.id, s]),
  )
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
    removedShotIds: [...removedShotIds],
    project: { ...project, script, updatedAt: now },
    receipt,
  }
}
