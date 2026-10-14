import type { Principal, Project, ProjectWorkspace } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import { canReadAllTenantContent } from '../../core/auth/roles.js'
import { projectPreviewUrl, projectGenerationSummary } from './projectPreview.js'
import { isStandaloneProjectId } from './projectSurface.js'

export function listProjectsFromStore(store: AppStore, principal: Principal): Project[] {
  const canReadAll = canReadAllTenantContent(principal)
  return store.read((state) =>
    state.projects
      .filter((project) => project.tenantId === principal.tenantId)
      .filter((project) => !isStandaloneProjectId(project.id))
      .filter((project) => project.status !== 'archived')
      .filter((project) => canReadAll || project.ownerId === principal.userId)
      .map((project) => ({
        ...project,
        // Keep the JSON-store path aligned with the Postgres list response.
        // The full script is fetched only when a project is opened.
        script: '',
        previewUrl: projectPreviewUrl(project.id, state),
        generationSummary: projectGenerationSummary(project.id, state),
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  )
}

export function readWorkspaceFromStore(
  store: AppStore,
  projectId: string,
  principal: Principal,
): ProjectWorkspace | null {
  if (isStandaloneProjectId(projectId)) return null
  return store.read((state) => {
    const project = state.projects.find(
      (item) =>
        item.id === projectId &&
        item.tenantId === principal.tenantId &&
        item.status !== 'archived' &&
        (canReadAllTenantContent(principal) || item.ownerId === principal.userId),
    )
    if (!project) return null
    return {
      project,
      scriptEpisodes: state.scriptEpisodes
        .filter((episode) => episode.projectId === projectId && episode.tenantId === principal.tenantId)
        .sort((left, right) => left.episodeNumber - right.episodeNumber),
      assets: state.assets.filter(
        (asset) => asset.projectId === projectId && asset.tenantId === principal.tenantId,
      ),
      shots: state.shots
        .filter((shot) => shot.projectId === projectId && shot.tenantId === principal.tenantId)
        .sort((left, right) => left.order - right.order),
    }
  })
}
