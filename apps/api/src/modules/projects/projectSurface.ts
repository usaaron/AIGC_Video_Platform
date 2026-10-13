import type { FastifyRequest } from 'fastify'
import { AppError } from '../../core/errors.js'

/** IDs owned by the independent Script Master application. */
export const STANDALONE_PROJECT_PREFIX = 'sm-standalone-'
const PROJECT_REFERENCE_KEYS = new Set([
  'projectid',
  'projectids',
  'sourceprojectid',
  'sourceprojectids',
  'storyprojectid',
  'storyprojectids',
  'targetprojectid',
  'targetprojectids',
  'destinationprojectid',
  'destinationprojectids',
  'hostprojectid',
])
const PROJECT_PATH_GUARD_MARK = Symbol('project-surface-path-guard')

export function isStandaloneProjectId(projectId: string | null | undefined): boolean {
  return typeof projectId === 'string' && projectId.startsWith(STANDALONE_PROJECT_PREFIX)
}

/** Main-project APIs reserve the independent namespace and never open it. */
export function rejectStandaloneProjectId(projectId: string | null | undefined): void {
  if (isStandaloneProjectId(projectId)) {
    throw new AppError(403, 'PROJECT_SURFACE_DENIED', '主项目不能访问独立剧本大师项目')
  }
}

/**
 * Reject independent-project references embedded in a request payload.
 *
 * Most main-project endpoints carry the project id in the URL and are covered
 * by {@link rejectStandaloneProjectPath}. A few creation/list endpoints carry
 * it in JSON or query data instead. Keep this check recursive so a metadata or
 * snapshot object cannot smuggle an independent id into main-project storage.
 */
export function rejectStandaloneProjectReferences(value: unknown): void {
  const visited = new Set<object>()

  const visit = (current: unknown, key?: string): void => {
    if (typeof current === 'string') {
      if (key && isProjectReferenceKey(key)) rejectStandaloneProjectId(current)
      return
    }
    if (current === null || typeof current !== 'object') return
    if (visited.has(current)) return
    visited.add(current)

    if (Array.isArray(current)) {
      for (const item of current) visit(item, key)
      return
    }

    for (const [childKey, childValue] of Object.entries(current)) {
      visit(childValue, childKey)
    }
  }

  visit(value)
}

function isProjectReferenceKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, '').toLowerCase()
  // Keep the explicit list for compatibility with unusual payload names, and
  // accept future `*ProjectId(s)` aliases without requiring every route to
  // update this guard first.
  return (
    PROJECT_REFERENCE_KEYS.has(normalized) ||
    normalized.endsWith('projectid') ||
    normalized.endsWith('projectids')
  )
}

export async function rejectStandaloneProjectPath(request: FastifyRequest): Promise<void> {
  const guardedRequest = request as FastifyRequest & { [PROJECT_PATH_GUARD_MARK]?: boolean }
  if (guardedRequest[PROJECT_PATH_GUARD_MARK]) return
  guardedRequest[PROJECT_PATH_GUARD_MARK] = true
  // This hook sits above every main-project route. Inspect all decoded request
  // inputs so new endpoints cannot accidentally bypass the namespace boundary
  // by moving a project id from the path into query or JSON metadata.
  rejectStandaloneProjectReferences(request.params)
  rejectStandaloneProjectReferences(request.query)
  rejectStandaloneProjectReferences(request.body)
}
