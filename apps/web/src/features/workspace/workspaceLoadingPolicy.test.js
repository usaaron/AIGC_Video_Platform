import { describe, expect, it } from 'vitest'
import {
  isActiveWorkspaceProject,
  normalizeWorkspace,
  shouldLoadTaskDetails,
  workspacePollingProjectId,
} from './workspaceLoadingPolicy'

describe('workspace loading policy', () => {
  const workspace = { project: { id: 'project-1' } }

  it('does not poll or preload a project while the library is open', () => {
    expect(workspacePollingProjectId('home', workspace)).toBeNull()
  })

  it('opens the overview with compact task summaries', () => {
    expect(workspacePollingProjectId('overview', workspace)).toBe('project-1')
    expect(shouldLoadTaskDetails('overview')).toBe(false)
  })

  it('only accepts async results for the currently selected project', () => {
    expect(isActiveWorkspaceProject('project-2', 'project-2')).toBe(true)
    expect(isActiveWorkspaceProject('project-1', 'project-2')).toBe(false)
    expect(isActiveWorkspaceProject(null, 'project-2')).toBe(false)
  })

  it('keeps a valid project open when older workspace fields are missing', () => {
    expect(
      normalizeWorkspace({ project: { id: 'project-1', name: '旧项目' }, assets: null, shots: undefined }),
    ).toEqual({
      project: { id: 'project-1', name: '旧项目' },
      scriptEpisodes: [],
      assets: [],
      shots: [],
    })
  })

  it('rejects malformed workspace responses instead of rendering a blank page', () => {
    expect(normalizeWorkspace(null)).toBeNull()
    expect(normalizeWorkspace({ project: null })).toBeNull()
    expect(normalizeWorkspace({ project: { name: '缺少 id' } })).toBeNull()
  })

  it.each(['script', 'assets', 'storyboard', 'film', 'image-studio'])(
    'loads full task details for %s',
    (step) => {
      expect(shouldLoadTaskDetails(step)).toBe(true)
    },
  )
})
