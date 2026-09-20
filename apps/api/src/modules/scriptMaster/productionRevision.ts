import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createShotSchema, type ScriptEpisode, type Shot } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import { prepareScriptProductionParagraphs } from '../projects/scriptProductionSource.js'
import { splitScriptIntoSmartSceneShots } from '../projects/directorShotPlanning.js'

export const PRODUCTION_HISTORY_KEY = 'scriptProductionHistory'

export function productionHistory(episode: ScriptEpisode): unknown[] {
  const stored = episode.continuityState[PRODUCTION_HISTORY_KEY]
  return Array.isArray(stored) ? stored : []
}

function fingerprint(
  shot: Pick<Shot, 'prompt' | 'framing' | 'duration' | 'continuityMode' | 'continuityNote'>,
) {
  return JSON.stringify([shot.prompt, shot.framing, shot.duration, shot.continuityMode, shot.continuityNote])
}

function sourceShots(content: string, assetEvidence?: unknown) {
  const paragraphs = prepareScriptProductionParagraphs(content, assetEvidence)
  // Request one beyond the accepted limit so long scripts fail instead of truncating.
  const generated = splitScriptIntoSmartSceneShots(paragraphs, 2_001, true)
  if (!generated.length || generated.length > 2_000)
    throw new AppError(409, 'IMPORT_REVISION_SHOT_LIMIT', '修订正文无法完整拆分，请调整本集场次后再同步')
  let offset = 0
  return paragraphs.flatMap((paragraph) => {
    const count = splitScriptIntoSmartSceneShots([paragraph], 2_001, true).length
    const group = generated.slice(offset, offset + count)
    offset += count
    return group.map((shot, index) => ({
      source: paragraph.text,
      shot:
        offset - count + index === 0
          ? { ...shot, continuityMode: 'independent' as const, continuityNote: '' }
          : shot,
    }))
  })
}

/** Build a complete new production view while retaining the previous one verbatim. */
export function reviseProduction(
  current: ScriptEpisode,
  next: { title: string; content: string; assetEvidence?: unknown },
  currentShots: Shot[],
  now: string,
  newShotId: (index: number) => string,
) {
  const previous = [...currentShots].sort((a, b) => a.order - b.order)
  const history = [
    ...productionHistory(current),
    {
      id: createHash('sha256').update(`${current.id}:${current.revision}:${now}`).digest('hex'),
      savedAt: now,
      episodeRevision: current.revision,
      title: current.title,
      content: current.content,
      ...(current.continuityState.scriptAssetEvidence
        ? { assetEvidence: structuredClone(current.continuityState.scriptAssetEvidence) }
        : {}),
      shots: structuredClone(previous),
    },
  ]
  if (
    next.content === current.content &&
    isDeepStrictEqual(next.assetEvidence, current.continuityState.scriptAssetEvidence)
  ) {
    return {
      history,
      shots: previous.map((shot) => ({ ...shot, episodeTitle: next.title, updatedAt: now })),
      removedShotIds: [] as string[],
      preservedShots: previous.length,
    }
  }
  const oldGenerated = sourceShots(current.content, current.continuityState.scriptAssetEvidence)
  const newGenerated = sourceShots(next.content, next.assetEvidence)
  const available = new Set(previous.map((shot) => shot.id))
  const matches = oldGenerated.map(({ source, shot }) => ({
    source,
    fingerprint: fingerprint(shot),
  }))
  const retained = new Set<string>()
  const shots: Shot[] = []
  for (const [index, { source, shot: draft }] of newGenerated.entries()) {
    const signature = fingerprint(draft)
    const matchingSources = matches.filter((old) => old.fingerprint === signature)
    // Repeated identical-looking scenes have no reliable old shot identity.
    const knownSource =
      matchingSources.length === 1 &&
      matchingSources[0]!.source === source &&
      previous.filter((shot) => fingerprint(shot) === signature).length === 1
    const candidate = knownSource
      ? previous.find(
          (shot, oldIndex) =>
            available.has(shot.id) &&
            fingerprint(shot) === signature &&
            // A continuing shot's media embeds its predecessor's tail-frame context.
            (draft.continuityMode === 'independent' ||
              (index > 0 && oldIndex > 0 && shots[index - 1]?.id === previous[oldIndex - 1]?.id)),
        )
      : undefined
    if (candidate) {
      available.delete(candidate.id)
      retained.add(candidate.id)
      shots.push({ ...candidate, episodeTitle: next.title, updatedAt: now })
      continue
    }
    const fields = createShotSchema.parse({
      ...draft,
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      scriptEpisodeId: current.id,
      episodeNumber: current.episodeNumber,
      episodeTitle: next.title,
      episodeKind: 'standard',
      episodeBreakBefore: index === 0 && current.episodeNumber > 1,
    })
    shots.push({
      ...fields,
      id: newShotId(index),
      projectId: current.projectId,
      tenantId: current.tenantId,
      order: index + 1,
      createdAt: now,
      updatedAt: now,
    })
  }
  return {
    history,
    shots,
    removedShotIds: previous.filter((shot) => !retained.has(shot.id)).map((shot) => shot.id),
    preservedShots: retained.size,
  }
}
