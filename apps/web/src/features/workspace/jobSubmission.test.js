import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../services/apiClient'
import { createWorkspaceCommands } from './workspaceCommands'

vi.mock('../../services/apiClient', () => ({
  api: { createTask: vi.fn(), tasks: vi.fn(), billing: vi.fn() },
}))

const created = { id: 'new-task', projectId: 'project-1', status: 'queued' }

function setup() {
  const setTasks = vi.fn()
  const setToast = vi.fn()
  const commands = createWorkspaceCommands({
    project: { id: 'project-1' },
    workspace: { assets: [] },
    activeProjectIdRef: { current: 'project-1' },
    setTasks,
    setToast,
    replaceTasks: vi.fn(),
    setBilling: vi.fn(),
    refreshSession: vi.fn(),
  })
  return { commands, setTasks, setToast }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.createTask.mockResolvedValue(created)
  api.tasks.mockResolvedValue([created])
  api.billing.mockResolvedValue({ credits: 10 })
})

describe('accepted generation jobs', () => {
  it.each(['tasks', 'billing'])('keeps acceptance when %s refresh fails', async (endpoint) => {
    api[endpoint].mockRejectedValue(new Error('network offline'))
    const { commands, setTasks, setToast } = setup()
    await expect(commands.createJob('镜头 1', '视频', 18)).resolves.toBe(created)
    const old = { id: 'old-task', status: 'completed' }
    expect(setTasks.mock.calls[0][0]([old])).toEqual([created, old])
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining('请勿重复提交'))
    expect(api.createTask).toHaveBeenCalledOnce()
  })

  it('does not mark a rejected submission as accepted', async () => {
    api.createTask.mockRejectedValue(new Error('积分不足'))
    const { commands, setTasks, setToast } = setup()
    await expect(commands.createJob('镜头 1', '视频', 18)).resolves.toBeNull()
    expect(setTasks).not.toHaveBeenCalled()
    expect(api.tasks).not.toHaveBeenCalled()
    expect(setToast).toHaveBeenCalledWith('积分不足')
  })
})
