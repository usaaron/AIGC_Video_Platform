import type { ScriptEpisode } from '@seqora/contracts'

export function summarizeEpisodeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 500)
}

export function draftContinuityState(
  current: unknown,
  generationClientRequestId: string | undefined,
  writtenAt: string,
): Record<string, unknown> {
  const existing =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {}
  if (!generationClientRequestId) return existing
  return {
    ...existing,
    generationClientRequestId,
    ...(generationClientRequestId.startsWith('episode-plan-')
      ? { batchGenerationKey: generationClientRequestId }
      : {}),
    generationDraftWrittenAt: writtenAt,
  }
}

export function aggregateEpisodeList(episodes: ScriptEpisode[]): string {
  return episodes
    .filter((episode) => episode.status === 'saved' && episode.content.trim())
    .sort((left, right) => left.episodeNumber - right.episodeNumber)
    .map((episode) => episode.content.trim())
    .join('\n\n【强制下一集】\n\n')
}

export function aggregateSavedEpisodes(
  episodes: ScriptEpisode[],
  projectId: string,
  tenantId: string,
): string {
  return aggregateEpisodeList(
    episodes.filter((episode) => episode.projectId === projectId && episode.tenantId === tenantId),
  )
}
