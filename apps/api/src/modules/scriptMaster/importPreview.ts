import { createHash } from 'node:crypto'
import type { ScriptMasterImportRequest, ScriptMasterImportPreview } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import { importedId, planImport, type ImportWorkspace } from './importPlan.js'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}

export function importTargetChecksum(workspace: ImportWorkspace): string {
  const ordered = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          project: workspace.project,
          scriptEpisodes: ordered(workspace.scriptEpisodes),
          assets: ordered(workspace.assets),
          shots: ordered(workspace.shots),
        }),
      ),
    )
    .digest('hex')
}

export function assertImportTarget(workspace: ImportWorkspace, input: ScriptMasterImportRequest) {
  if (input.expectedTargetChecksum && input.expectedTargetChecksum !== importTargetChecksum(workspace)) {
    throw new AppError(409, 'IMPORT_TARGET_CHANGED', '主项目在检查后有了新编辑，请刷新同步差异后重试')
  }
}

export function previewImport(
  workspace: ImportWorkspace,
  input: ScriptMasterImportRequest,
  actorId: string,
): ScriptMasterImportPreview {
  const conflicts: string[] = []
  const episodes = input.episodes.map((episode) => {
    const base = { sourceEpisodeId: episode.sourceEpisodeId, episodeNumber: episode.episodeNumber }
    try {
      const plan = planImport(workspace, { ...input, episodes: [episode], assets: [] }, actorId)
      const exists = workspace.scriptEpisodes.some(
        (item) => item.id === importedId(input, 'episode', episode.sourceEpisodeId),
      )
      return {
        ...base,
        status: !exists
          ? ('new' as const)
          : plan.episodes.length || plan.shots.length || plan.removedShotIds.length
            ? ('update' as const)
            : ('unchanged' as const),
        importedShots: plan.receipt.importedShots,
        updatedShots: plan.receipt.updatedShots,
      }
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      conflicts.push(error.message)
      return {
        ...base,
        status: 'conflict' as const,
        importedShots: 0,
        updatedShots: 0,
        message: error.message,
        code: error.code,
      }
    }
  })
  let assets = { imported: 0, updated: 0, preserved: 0 }
  try {
    const plan = planImport(workspace, { ...input, episodes: [] }, actorId)
    assets = {
      imported: plan.receipt.importedAssets,
      updated: plan.receipt.updatedAssets,
      preserved: plan.receipt.preservedAssets,
    }
    // Cross-episode constraints must also be checked as one batch.
    if (!conflicts.length) planImport(workspace, input, actorId)
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    conflicts.push(error.message)
  }
  return {
    targetProjectId: workspace.project.id,
    targetChecksum: importTargetChecksum(workspace),
    episodes,
    assets,
    conflicts,
  }
}
