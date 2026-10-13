import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../services/apiClient'
import { createWorkspaceCommands } from './workspaceCommands'

vi.mock('../../services/apiClient', () => ({
  api: {
    createProject: vi.fn(),
    project: vi.fn(),
    projects: vi.fn(),
  },
}))

const project = {
  id: 'project-1',
  name: '新故事',
  contentType: 'short-drama',
  visualStyle: 'cinematic-cg',
  episodeDurationSeconds: 60,
  aspectRatio: '9:16',
  status: 'draft',
  synopsis: '',
  script: '',
  version: 1,
}

const workspace = { project, scriptEpisodes: [], assets: [], shots: [] }

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function setup(workflowAccess = null) {
  const activeProjectIdRef = { current: null }
  const projectCreationInFlightRef = { current: null }
  const setActiveStep = vi.fn()
  const setMobileNav = vi.fn()
  const setNewProjectOpen = vi.fn()
  const setToast = vi.fn()
  const commands = createWorkspaceCommands({
    project: null,
    projects: [],
    workspace: null,
    tasks: [],
    workspaceCacheRef: { current: new Map() },
    activeProjectIdRef,
    projectCreationInFlightRef,
    replaceTasks: vi.fn(),
    setActiveStep,
    setMobileNav,
    setActiveProject: vi.fn(),
    setNewProjectOpen,
    setToast,
    setWorkspace: vi.fn(),
    setProjects: vi.fn(),
    workflowAccess,
  })
  return { commands, projectCreationInFlightRef, setActiveStep, setNewProjectOpen, setToast }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.project.mockResolvedValue(workspace)
  api.projects.mockResolvedValue([project])
})

describe('project creation single-flight guard', () => {
  it('does not submit a second project while the first request is pending', async () => {
    const request = deferred()
    api.createProject.mockReturnValue(request.promise)
    const { commands, projectCreationInFlightRef, setActiveStep, setNewProjectOpen } = setup()
    const input = { name: '新故事', contentType: 'short-drama' }

    const first = commands.createProject(input)
    const second = commands.createProject(input)

    expect(api.createProject).toHaveBeenCalledOnce()
    expect(projectCreationInFlightRef.current).not.toBeNull()

    request.resolve(project)
    await expect(Promise.all([first, second])).resolves.toEqual([project, project])
    expect(setNewProjectOpen).toHaveBeenCalledWith(false)
    expect(setActiveStep).toHaveBeenCalledWith('script')
    expect(projectCreationInFlightRef.current).toBeNull()
  })

  it('releases the guard after completion so a later project can be created', async () => {
    api.createProject.mockResolvedValue(project)
    const { commands } = setup()

    await commands.createProject({ name: '第一部' })
    await commands.createProject({ name: '第二部' })

    expect(api.createProject).toHaveBeenCalledTimes(2)
  })

  it('does not switch to a locked creative stage from direct navigation', () => {
    const { commands, setActiveStep, setToast } = setup({
      script: true,
      assets: false,
      storyboard: false,
      generate: false,
      film: false,
    })

    expect(commands.navigateTo('assets')).toBe(false)
    expect(setActiveStep).not.toHaveBeenCalled()
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining('保存剧本'))
  })
})
