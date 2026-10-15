import { isDeepStrictEqual } from 'node:util'
import type { Principal, Project, ScriptEpisode } from '@seqora/contracts'
import type { AppStore } from '../../infra/store.js'
import { upsertProject } from './repositoryData.js'

/** A committed older worker must not mirror over a newer edit while awaiting the store queue. */
export function captureTextTaskWorkspaceWriteback(
  store: AppStore | null,
  projectId: string,
  principal: Principal,
) {
  const before = store?.read((state) => ({
    project: state.projects.find((item) => item.id === projectId && item.tenantId === principal.tenantId),
    episodes: state.scriptEpisodes.filter(
      (item) => item.projectId === projectId && item.tenantId === principal.tenantId,
    ),
  }))
  return {
    async project(project: Project): Promise<void> {
      if (!store || !before) return
      await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
        const current = state.projects.find(
          (item) => item.id === project.id && item.tenantId === project.tenantId,
        )
        if (isDeepStrictEqual(current, before.project)) upsertProject(state, project)
      })
    },
    async episode(episode: ScriptEpisode): Promise<void> {
      if (!store || !before) return
      await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
        const project = state.projects.find(
          (item) => item.id === episode.projectId && item.tenantId === episode.tenantId,
        )
        if (before.project && !project) return
        const index = state.scriptEpisodes.findIndex(
          (item) => item.id === episode.id && item.tenantId === episode.tenantId,
        )
        const current = index >= 0 ? state.scriptEpisodes[index] : undefined
        const previous = before.episodes.find((item) => item.id === episode.id)
        if (!isDeepStrictEqual(current, previous)) return
        if (index >= 0) state.scriptEpisodes[index] = episode
        else state.scriptEpisodes.push(episode)
        if (project && isDeepStrictEqual(project, before.project) && project.updatedAt < episode.updatedAt) {
          project.updatedAt = episode.updatedAt
        }
      })
    },
  }
}
