import type { GenerateShotsRequest, Principal, ProjectWorkspace, Shot } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'
import type { ProjectRepository } from './repository.js'
import {
  assignShotEpisodes,
  expandLongScriptParagraphs,
  splitScriptParagraphs,
  splitScriptIntoBeatShots,
} from './shotPlanning.js'
import { splitScriptIntoSmartSceneShots } from './directorShotPlanning.js'

export function generateProjectShots(
  repository: ProjectRepository,
  projectId: string,
  workspace: ProjectWorkspace,
  input: GenerateShotsRequest,
  principal: Principal,
) {
  if (workspace.project.contentType === 'short-drama' && workspace.scriptEpisodes?.length) {
    const savedEpisodes = workspace.scriptEpisodes.filter(
      (episode) => episode.status === 'saved' && episode.content.trim(),
    )
    const selectedEpisodes = input.episodeId
      ? savedEpisodes.filter((episode) => episode.id === input.episodeId)
      : savedEpisodes
    if (!selectedEpisodes.length) {
      throw new AppError(
        400,
        'SCRIPT_EPISODE_REQUIRED',
        input.episodeId ? '该集尚未保存，请先保存本集' : '请先保存至少一集剧本',
      )
    }
    const generated = selectedEpisodes.flatMap((episode) => {
      const paragraphs = expandLongScriptParagraphs(splitScriptParagraphs(episode.content))
      const shots =
        input.mode === 'beat'
          ? splitScriptIntoBeatShots(paragraphs, input.maxShots, true)
          : splitScriptIntoSmartSceneShots(paragraphs, input.maxShots, true)
      return shots.map((shot, index) => ({
        ...shot,
        scriptEpisodeId: episode.id,
        episodeBreakBefore: index === 0 && episode.episodeNumber > 1,
        continuityMode: index === 0 ? ('independent' as const) : shot.continuityMode,
        continuityNote: index === 0 ? '' : shot.continuityNote,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
        episodeKind: 'standard' as const,
      }))
    })
    if (input.episodeId)
      return repository.replaceEpisodeShots(projectId, selectedEpisodes[0]!, generated, principal)
    return repository.replaceShots(projectId, generated, principal)
  }
  const source = workspace.project.script.trim()
  if (!source) throw new AppError(400, 'SCRIPT_REQUIRED', '请先填写剧本')
  const paragraphs = expandLongScriptParagraphs(splitScriptParagraphs(source))
  const isWebSeries = workspace.project.contentType === 'short-drama'
  const shots =
    input.mode === 'beat'
      ? splitScriptIntoBeatShots(paragraphs, input.maxShots, isWebSeries)
      : splitScriptIntoSmartSceneShots(paragraphs, input.maxShots, isWebSeries)
  return repository.replaceShots(
    projectId,
    assignShotEpisodes(
      shots.map((shot) => ({ ...shot, scriptEpisodeId: null })),
      input.episodeDurationSeconds,
    ),
    principal,
  )
}

export async function saveShotEpisodeAssignments(
  repository: ProjectRepository,
  projectId: string,
  shots: Shot[],
  episodeDurationSeconds: number,
  principal: Principal,
) {
  const assigned = assignShotEpisodes(shots, episodeDurationSeconds)
  const updated = await repository.updateShotEpisodes(
    projectId,
    assigned.map(({ id, episodeNumber, episodeTitle, episodeKind, continuityMode, continuityNote }) => ({
      id,
      episodeNumber,
      episodeTitle,
      episodeKind,
      continuityMode,
      continuityNote: continuityNote ?? '',
    })),
    principal,
  )
  if (!updated) throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权修改')
  return updated
}
