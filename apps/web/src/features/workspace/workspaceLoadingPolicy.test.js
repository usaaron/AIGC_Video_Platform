import { describe, expect, it } from 'vitest'
import { shouldLoadTaskDetails, workspacePollingProjectId } from './workspaceLoadingPolicy'

describe('workspace loading policy', () => {
  const workspace = { project: { id: 'project-1' } }

  it('does not poll or preload a project while the library is open', () => {
    expect(workspacePollingProjectId('home', workspace)).toBeNull()
  })

  it('opens the overview with compact task summaries', () => {
    expect(workspacePollingProjectId('overview', workspace)).toBe('project-1')
    expect(shouldLoadTaskDetails('overview')).toBe(false)
  })

  it.each(['script', 'assets', 'storyboard', 'film', 'image-studio'])(
    'loads full task details for %s',
    (step) => {
      expect(shouldLoadTaskDetails(step)).toBe(true)
    },
  )
})
