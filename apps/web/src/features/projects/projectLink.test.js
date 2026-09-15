import { describe, expect, it } from 'vitest'
import { projectLinkTarget } from './projectLink'

describe('return from Script Master', () => {
  const projects = [{ id: 'recent' }, { id: 'import-target' }]
  it('returns to the imported project instead of the most recent project', () => {
    expect(projectLinkTarget(projects, '?projectId=import-target&view=script')).toEqual({
      project: projects[1],
      view: 'script',
    })
  })
  it('ignores unknown projects and only accepts supported project views', () => {
    expect(projectLinkTarget(projects, '?projectId=another-user-project&view=script')).toBeNull()
    expect(projectLinkTarget(projects, '?projectId=import-target&view=writing-studio')?.view).toBe('overview')
    expect(projectLinkTarget(projects, '')).toBeNull()
  })
})
