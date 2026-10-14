import type { Principal, ScriptEpisode } from '@seqora/contracts'

export function usageContextForPrincipal(principal: Principal) {
  return {
    tenantId: principal.tenantId,
    organizationId: principal.organizationId ?? principal.tenantId,
    userId: principal.userId,
  }
}

export function episodeContinuationContext(episodes: ScriptEpisode[]): string {
  const ordered = [...episodes].sort((left, right) => left.episodeNumber - right.episodeNumber)
  const latest = ordered.at(-1)
  const history = ordered
    .slice(0, -1)
    .map(
      (episode) =>
        `第 ${episode.episodeNumber} 集摘要：${episode.summary || episode.content.replace(/\s+/g, ' ').slice(0, 500)}`,
    )
    .join('\n')
  return [
    '以下内容是连续网剧的前情上下文。只生成下一集，不得复述旧集。',
    history ? `历史集摘要：\n${history}` : '',
    latest ? `上一集全文：\n${latest.content}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
