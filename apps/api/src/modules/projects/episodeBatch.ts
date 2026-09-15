import { createHash } from 'node:crypto'
import type { GenerateScriptRequest, Principal, ScriptEpisode } from '@seqora/contracts'
import type { LocalTaskExecutionContext } from '../../core/jobs/localTaskHandler.js'
import { AppError } from '../../core/errors.js'
import type { ProjectService } from './service.js'

export async function generateEpisodeBatch(
  service: ProjectService,
  projectId: string,
  input: GenerateScriptRequest,
  principal: Principal,
  context?: LocalTaskExecutionContext,
  taskId?: string,
) {
  const plan = input.episodePlan!
  const workspace = await service.workspace(projectId, principal)
  if (workspace.project.contentType !== 'short-drama') {
    throw new AppError(400, 'EPISODE_PLAN_NOT_SUPPORTED', '分集计划仅适用于网剧')
  }
  const hash = createHash('sha256')
    .update(
      JSON.stringify([projectId, plan.episodes, input.model, input.episodeDurationSeconds, input.direction]),
    )
    .digest('hex')
    .slice(0, 24)
  const episodes: ScriptEpisode[] = []
  for (const [index, entry] of plan.episodes.entries()) {
    await context?.assertActive?.()
    const requestId = `episode-plan-${plan.id}-${hash}-${index}`
    const current = await service.workspace(projectId, principal)
    const completed = current.scriptEpisodes.find(
      (episode) => episode.continuityState.batchGenerationKey === requestId,
    )
    if (completed) {
      episodes.push(completed)
      continue
    }
    const previous = episodes.at(-1)
    const continuity = previous ? (previous.draftContent || previous.content).slice(-3_000) : ''
    const result = await service.generateScript(
      projectId,
      entry.source,
      input.direction,
      'quick',
      input.segment,
      'web-series',
      input.episodeMinutes,
      requestId,
      principal,
      input.model,
      `分集转写：只处理本集素材，保持事件顺序和因果，不提前写后续集。${input.revisionNote}`,
      'direct',
      input.episodeDurationSeconds,
      context?.onTextProgress,
      context?.onTextTiming,
      undefined,
      {
        createNext: true,
        title: entry.title,
        batchGenerationKey: requestId,
        continuity,
        beforeWrite: context?.assertActive,
        billingRequestId: taskId ? `${taskId}-episode-${index}` : requestId,
      },
    )
    if (!('episode' in result) || !result.episode)
      throw new AppError(502, 'EPISODE_WRITE_FAILED', '分集写入失败')
    episodes.push(result.episode)
  }
  const last = episodes.at(-1)!
  return {
    script: last.draftContent || last.content,
    episode: last,
    episodes,
    warnings: [`已生成 ${episodes.length} 集草稿，请逐集核对并保存。`],
    mode: 'quick' as const,
  }
}
