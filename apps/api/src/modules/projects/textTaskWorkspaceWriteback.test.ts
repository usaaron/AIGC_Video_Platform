import { describe, expect, it } from 'vitest'
import { setupTextWriteGuard, textWritePrincipal as principal } from './textTaskWriteGuard.fixture.js'
import { captureTextTaskWorkspaceWriteback } from './textTaskWorkspaceWriteback.js'

describe('guarded text task workspace cache writeback', () => {
  it('mirrors accepted project and episode commits when their captured targets are unchanged', async () => {
    const { store, project, episode } = await setupTextWriteGuard()
    const projectWriteback = captureTextTaskWorkspaceWriteback(store, project.id, principal)
    const acceptedProject = { ...project, script: 'Accepted project', updatedAt: '2030-01-01T00:00:00.000Z' }
    await projectWriteback.project(acceptedProject)
    const episodeWriteback = captureTextTaskWorkspaceWriteback(store, project.id, principal)
    const acceptedEpisode = { ...episode, draftContent: 'Accepted episode', revision: episode.revision + 1 }
    await episodeWriteback.episode(acceptedEpisode)
    expect(store.read((state) => state.projects.find((item) => item.id === project.id))).toEqual(
      acceptedProject,
    )
    expect(store.read((state) => state.scriptEpisodes.find((item) => item.id === episode.id))).toEqual(
      acceptedEpisode,
    )
  })

  it('retains a concurrent project edit even when its timestamp is unchanged', async () => {
    const { store, project } = await setupTextWriteGuard()
    const writeback = captureTextTaskWorkspaceWriteback(store, project.id, principal)
    await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
      state.projects.find((item) => item.id === project.id)!.script = 'Newer project edit'
    })
    const current = store.read((state) => state.projects.find((item) => item.id === project.id))
    await writeback.project({
      ...project,
      script: 'Older committed result',
      updatedAt: '2030-01-01T00:00:00.000Z',
    })
    expect(store.read((state) => state.projects.find((item) => item.id === project.id))).toEqual(current)
  })

  it('retains concurrent episode content at the same timestamp and revision', async () => {
    const { store, project, episode } = await setupTextWriteGuard()
    const writeback = captureTextTaskWorkspaceWriteback(store, project.id, principal)
    await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
      state.scriptEpisodes.find((item) => item.id === episode.id)!.draftContent = 'Newer episode edit'
    })
    const current = store.read((state) => state.scriptEpisodes.find((item) => item.id === episode.id))
    await writeback.episode({
      ...episode,
      draftContent: 'Older committed result',
      revision: episode.revision + 1,
    })
    expect(store.read((state) => state.scriptEpisodes.find((item) => item.id === episode.id))).toEqual(
      current,
    )
  })

  it('mirrors the episode without overwriting concurrent project changes', async () => {
    const { store, project, episode } = await setupTextWriteGuard()
    const writeback = captureTextTaskWorkspaceWriteback(store, project.id, principal)
    await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
      state.projects.find((item) => item.id === project.id)!.name = 'Edited name'
    })
    const currentProject = store.read((state) => state.projects.find((item) => item.id === project.id))
    await writeback.episode({
      ...episode,
      draftContent: 'Accepted result',
      updatedAt: '2030-01-01T00:00:00.000Z',
    })
    expect(
      store.read((state) => state.scriptEpisodes.find((item) => item.id === episode.id)!.draftContent),
    ).toBe('Accepted result')
    expect(store.read((state) => state.projects.find((item) => item.id === project.id))).toEqual(
      currentProject,
    )
  })

  it('does not resurrect removed targets or overwrite a new episode already mirrored by another commit', async () => {
    const { store, project, episode } = await setupTextWriteGuard()
    const writeback = captureTextTaskWorkspaceWriteback(store, project.id, principal)
    const newEpisode = {
      ...episode,
      id: 'new-episode',
      episodeNumber: 2,
      draftContent: 'Newer created draft',
    }
    await store.mutateProjectWorkspaceRuntimeCacheAsync((state) => {
      state.projects = state.projects.filter((item) => item.id !== project.id)
      state.scriptEpisodes = state.scriptEpisodes.filter((item) => item.id !== episode.id)
      state.scriptEpisodes.push(newEpisode)
    })
    await writeback.project({ ...project, script: 'Older committed result' })
    await writeback.episode({ ...episode, draftContent: 'Older committed result' })
    await writeback.episode({ ...newEpisode, draftContent: 'Older created draft' })
    await writeback.episode({ ...newEpisode, id: 'new-orphan-episode', draftContent: 'Late new draft' })
    expect(store.read((state) => state.projects.some((item) => item.id === project.id))).toBe(false)
    expect(store.read((state) => state.scriptEpisodes.some((item) => item.id === episode.id))).toBe(false)
    expect(store.read((state) => state.scriptEpisodes.some((item) => item.id === 'new-orphan-episode'))).toBe(
      false,
    )
    expect(store.read((state) => state.scriptEpisodes.find((item) => item.id === newEpisode.id))).toEqual(
      newEpisode,
    )
  })
})
