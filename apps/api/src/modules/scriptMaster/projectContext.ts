import type { Project, ScriptMasterProjectContext } from '@seqora/contracts'
import { AppError } from '../../core/errors.js'

const DEFAULT_EPISODE_DURATION_SECONDS = 60
const MAX_SYNOPSIS_LENGTH = 1_000

type HostProjectFields = Pick<Project, 'name' | 'synopsis' | 'episodeDurationSeconds'>

/**
 * Resolve the project facts that accompany a Script Master import.
 *
 * The host project owns its title and pacing contract.  A source context is
 * useful as a binding check, but must never silently rename the host project
 * or change the duration already used by assets and storyboards.  Synopsis is
 * the one creative field that may be filled by the source when it is non-empty.
 */
export function normalizeScriptMasterProjectContext(
  project: HostProjectFields,
  source: ScriptMasterProjectContext | undefined,
  fallbackSynopsis = '',
): HostProjectFields {
  const title = normalizeTitle(project.name)
  if (!title) {
    throw new AppError(500, 'IMPORT_PROJECT_TITLE_MISSING', '主项目缺少有效标题，无法交接剧本')
  }

  const sourceTitle = source?.title === undefined ? '' : normalizeTitle(source.title)
  if (source?.title !== undefined && !sourceTitle) {
    throw new AppError(400, 'IMPORT_PROJECT_TITLE_INVALID', '剧本大师交接的项目标题不能为空')
  }
  if (sourceTitle && sourceTitle !== title) {
    throw new AppError(
      409,
      'IMPORT_PROJECT_TITLE_MISMATCH',
      '剧本大师项目标题与主项目不一致，请返回主项目后重新进入',
    )
  }

  const hostDuration = project.episodeDurationSeconds
  if (hostDuration !== undefined && !validDuration(hostDuration)) {
    throw new AppError(500, 'IMPORT_PROJECT_DURATION_INVALID', '主项目的单集时长无效，无法交接剧本')
  }
  const sourceDuration = source?.episodeDurationSeconds
  if (sourceDuration !== undefined && !validDuration(sourceDuration)) {
    throw new AppError(400, 'IMPORT_PROJECT_DURATION_INVALID', '剧本大师交接的单集时长无效')
  }
  if (hostDuration !== undefined && sourceDuration !== undefined && hostDuration !== sourceDuration) {
    throw new AppError(
      409,
      'IMPORT_PROJECT_DURATION_MISMATCH',
      '剧本大师单集时长与主项目不一致，请沿用主项目设置',
    )
  }

  const synopsis =
    normalizeSynopsis(source?.synopsis) ||
    normalizeSynopsis(project.synopsis) ||
    normalizeSynopsis(fallbackSynopsis)
  return {
    name: title,
    synopsis,
    episodeDurationSeconds: hostDuration ?? sourceDuration ?? DEFAULT_EPISODE_DURATION_SECONDS,
  }
}

function validDuration(value: number): boolean {
  return Number.isInteger(value) && value >= 5 && value <= 300
}

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function normalizeSynopsis(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SYNOPSIS_LENGTH)
}
