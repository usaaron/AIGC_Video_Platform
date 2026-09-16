import type { Asset, Shot } from '@seqora/contracts'
export function assetInsertParams(asset: Asset): unknown[] {
  return [
    asset.id,
    asset.projectId,
    asset.tenantId,
    asset.kind,
    asset.sourceMode,
    asset.name,
    asset.description,
    asset.prompt,
    asset.promptMode,
    asset.customPromptMode,
    asset.customPrompt,
    asset.negativePrompt,
    JSON.stringify(asset.references),
    JSON.stringify(asset.attributes),
    asset.imageUrl,
    asset.status,
    asset.createdAt,
    asset.updatedAt,
  ]
}

export const shotInsertColumns = `id, project_id, tenant_id, script_episode_id, shot_order,
  title, framing, duration_seconds, prompt, negative_prompt, image_url, continuity_mode,
  continuity_note, episode_break_before, episode_number, episode_title, episode_kind,
  created_at, updated_at, reference_images`
export const shotInsertValues = Array.from({ length: 20 }, (_, index) => `$${index + 1}`).join(', ')

export function shotInsertParams(shot: Shot): unknown[] {
  return [
    shot.id,
    shot.projectId,
    shot.tenantId,
    shot.scriptEpisodeId,
    shot.order,
    shot.title,
    shot.framing,
    shot.duration,
    shot.prompt,
    shot.negativePrompt,
    shot.imageUrl,
    shot.continuityMode,
    shot.continuityNote,
    shot.episodeBreakBefore,
    shot.episodeNumber,
    shot.episodeTitle,
    shot.episodeKind,
    shot.createdAt,
    shot.updatedAt,
    shot.referenceImages === undefined ? null : JSON.stringify(shot.referenceImages),
  ]
}
