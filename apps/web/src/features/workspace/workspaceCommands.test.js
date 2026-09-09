import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../services/apiClient'
import { createWorkspaceCommands } from './workspaceCommands'

afterEach(() => vi.restoreAllMocks())

function setup() {
  const project = { id: 'project-1', contentType: 'short-drama', aspectRatio: '9:16' }
  const task = { id: 'task-1', projectId: project.id, kind: 'image', status: 'queued', metadata: {} }
  const context = {
    project,
    projects: [project],
    workspace: { project, assets: [], shots: [] },
    tasks: [],
    workspaceCacheRef: { current: new Map() },
    activeProjectIdRef: { current: project.id },
    replaceTasks: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    markNotificationRead: vi.fn(),
    setActiveStep: vi.fn(),
    setMobileNav: vi.fn(),
    setWorkspace: vi.fn(),
    setActiveProject: vi.fn(),
    setTasks: vi.fn(),
    setBilling: vi.fn(),
    setProjects: vi.fn(),
    setNewProjectOpen: vi.fn(),
    setToast: vi.fn(),
  }
  vi.spyOn(api, 'createTask').mockResolvedValue(task)
  vi.spyOn(api, 'tasks').mockResolvedValue([task])
  vi.spyOn(api, 'billing').mockResolvedValue({ credits: 100 })
  vi.spyOn(api, 'project').mockResolvedValue(context.workspace)
  vi.spyOn(api, 'projects').mockResolvedValue([project])
  return { context, task, commands: createWorkspaceCommands(context) }
}

describe('workspace task submission', () => {
  it('preserves accepted tasks when refreshing the task list fails', async () => {
    const { context, task, commands } = setup()
    api.tasks.mockRejectedValue(new Error('Network unavailable'))

    await expect(commands.createJob('Character', '图片', 4)).resolves.toEqual(task)
    expect(api.createTask).toHaveBeenCalledOnce()
    expect(context.setTasks.mock.calls[0][0]([])).toEqual([task])
    expect(context.setToast).toHaveBeenLastCalledWith(expect.stringContaining('请勿重复提交'))
    expect(context.replaceTasks).not.toHaveBeenCalled()
  })

  it('keeps script submission successful when refreshing billing fails', async () => {
    const { context, task, commands } = setup()
    api.billing.mockRejectedValue(new Error('Billing temporarily unavailable'))

    await expect(
      commands.createScriptJob('Script', 'generate', { model: 'deepseek-v4-flash' }),
    ).resolves.toEqual(task)
    expect(context.replaceTasks).toHaveBeenCalledWith(task.projectId, [task])
    expect(api.createTask).toHaveBeenCalledOnce()
  })

  it('keeps trusted portrait submission successful when refreshing the session fails', async () => {
    const { context, task, commands } = setup()
    context.refreshSession.mockRejectedValue(new Error('Session refresh unavailable'))

    await expect(commands.createTrustedPortraitJob('asset-1', 'Character', 'face-1')).resolves.toEqual(task)
    expect(api.createTask).toHaveBeenCalledOnce()
  })

  it('does not insert an accepted task into a different project after navigation', async () => {
    const { context, task, commands } = setup()
    api.createTask.mockImplementation(async () => {
      context.activeProjectIdRef.current = 'project-2'
      return task
    })

    await expect(commands.createJob('Character')).resolves.toEqual(task)
    expect(context.setTasks).not.toHaveBeenCalled()
    expect(context.replaceTasks).not.toHaveBeenCalled()
    expect(context.setToast).not.toHaveBeenCalled()
  })

  it('does not replace tasks if navigation happens during the refresh', async () => {
    const { context, commands } = setup()
    api.tasks.mockImplementation(async () => {
      context.activeProjectIdRef.current = 'project-2'
      return []
    })

    await commands.createJob('Character')
    expect(context.replaceTasks).not.toHaveBeenCalled()
  })

  it('still surfaces a rejected task without creating an optimistic task', async () => {
    const { context, commands } = setup()
    api.createTask.mockRejectedValue(new Error('Insufficient credits'))

    await expect(commands.createJob('Character')).resolves.toBeNull()
    expect(context.setTasks).not.toHaveBeenCalled()
    expect(context.setToast).toHaveBeenCalledWith('Insufficient credits')
    expect(api.tasks).not.toHaveBeenCalled()
  })

  it('preserves a submitted batch when the workspace refresh fails', async () => {
    const { context, commands } = setup()
    const shot = {
      id: 'shot-1',
      order: 1,
      duration: 5,
      prompt: 'A opens the door.',
      continuityMode: 'independent',
    }
    context.workspace.shots = [shot]
    api.project.mockRejectedValue(new Error('Workspace temporarily unavailable'))

    await expect(commands.createStoryboardVideoBatch([shot], '720p', 'independent')).resolves.toMatchObject({
      created: 1,
    })
    expect(api.createTask).toHaveBeenCalledOnce()
    expect(context.setToast).toHaveBeenLastCalledWith(expect.stringContaining('已创建 1 个'))
  })
})
