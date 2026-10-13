import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountHook, resetHookHarness } from '../../testSupport/hookHarness'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal()),
  ...(await import('../../testSupport/hookHarness')).mockReactHooks,
}))
vi.mock('../../services/apiClient', () => ({
  api: {
    billing: vi.fn(),
    recentTasks: vi.fn(),
    projects: vi.fn(),
    tasks: vi.fn(),
    pollTasks: vi.fn(),
    project: vi.fn(),
    pollWorkspaceVersion: vi.fn(),
  },
}))

import { api } from '../../services/apiClient'
import { useWorkspacePolling } from './useWorkspacePolling'
import { workspacePollingOptions } from './workspaceLoadingPolicy'

const projectId = 'host-project'
const workspace = { project: { id: projectId } }
const task = { id: 'task-one', projectId, status: 'running', kind: 'text' }

function mountForStep(step) {
  const props = {
    ...workspacePollingOptions(step, projectId),
    workspaceCacheRef: { current: new Map() },
    activeProjectIdRef: { current: projectId },
    ...Object.fromEntries(
      [
        'replaceTasks',
        'setWorkspace',
        'setBilling',
        'setProjects',
        'setRecentTasks',
        'setRecentTasksLoaded',
        'onWorkspaceError',
      ].map((name) => [name, vi.fn()]),
    ),
  }
  return { ...mountHook(useWorkspacePolling, props), props }
}

beforeEach(() => {
  resetHookHarness()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T08:00:00Z'))
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.clearAllMocks()
  api.billing.mockResolvedValue({ credits: 1 })
  api.recentTasks.mockResolvedValue([])
  api.projects.mockResolvedValue([{ id: projectId }])
  api.tasks.mockResolvedValue([task])
  api.pollTasks.mockResolvedValue({ tasks: [task], etag: 'tasks-v1' })
  api.project.mockResolvedValue(workspace)
  api.pollWorkspaceVersion.mockResolvedValue({ notModified: true })
})

afterEach(() => {
  resetHookHarness()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('workspace polling lifecycle', () => {
  it.each(['writing-studio', 'agent-studio'])(
    'polls account activity once per minute in %s without loading host project data',
    async (step) => {
      const app = mountForStep(step)
      await vi.advanceTimersByTimeAsync(59_999)
      expect(api.billing).toHaveBeenCalledTimes(1)
      expect(api.recentTasks).toHaveBeenCalledTimes(1)
      expect(app.props.setRecentTasksLoaded).toHaveBeenCalledWith(true)
      await vi.advanceTimersByTimeAsync(1)
      expect(api.billing).toHaveBeenCalledTimes(2)
      expect(api.recentTasks).toHaveBeenCalledTimes(2)
      for (const method of ['project', 'tasks', 'pollTasks', 'pollWorkspaceVersion', 'projects']) {
        expect(api[method]).not.toHaveBeenCalled()
      }
    },
  )

  it('does not increase account polling frequency in a hidden tab', async () => {
    document.hidden = true
    mountForStep('writing-studio')
    await vi.advanceTimersByTimeAsync(59_999)
    expect(api.recentTasks).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.recentTasks).toHaveBeenCalledTimes(2)
  })

  it('resumes normal project polling at 2.5 seconds when returning to an active project', async () => {
    const app = mountForStep('writing-studio')
    await vi.advanceTimersByTimeAsync(0)
    app.render({ projectId, includeRecentActivity: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.project).toHaveBeenCalledOnce()
    expect(api.pollTasks).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2_500)
    expect(api.pollTasks).toHaveBeenCalledTimes(2)
    expect(app.props.replaceTasks).toHaveBeenCalledWith(projectId, expect.any(Array))
  })

  it('cleans up the project timer when entering a standalone tool', async () => {
    const app = mountForStep('overview')
    await vi.advanceTimersByTimeAsync(0)
    app.render({ projectId: null, includeRecentActivity: true })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(api.pollTasks).toHaveBeenCalledOnce()
    expect(api.project).toHaveBeenCalledOnce()
    expect(api.recentTasks).toHaveBeenCalledOnce()
    app.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores late account responses after leaving the standalone page', async () => {
    let finish
    api.recentTasks.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const app = mountForStep('writing-studio')
    app.render({ includeRecentActivity: false })
    finish([task])
    await vi.advanceTimersByTimeAsync(0)
    expect(app.props.setRecentTasks).not.toHaveBeenCalled()
    expect(app.props.setBilling).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the existing no-poll policy on the project library', async () => {
    mountForStep('home')
    await vi.advanceTimersByTimeAsync(60_000)
    Object.values(api).forEach((method) => expect(method).not.toHaveBeenCalled())
  })

  it('does not commit old task results after a version probe finishes on a standalone page', async () => {
    const app = mountForStep('overview')
    await vi.advanceTimersByTimeAsync(0)
    let finishVersionProbe
    api.pollWorkspaceVersion.mockImplementation(
      () => new Promise((resolve) => (finishVersionProbe = resolve)),
    )
    api.pollTasks.mockResolvedValue({ tasks: [{ ...task, progress: 50 }], etag: 'tasks-v2' })
    await vi.advanceTimersByTimeAsync(2_500)
    expect(api.pollWorkspaceVersion).toHaveBeenCalledOnce()
    app.render({ projectId: null, includeRecentActivity: true })
    finishVersionProbe({ notModified: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(app.props.replaceTasks).toHaveBeenCalledOnce()
    expect(app.props.setWorkspace).toHaveBeenCalledOnce()
  })

  it('does not report a stale workspace error after leaving the project', async () => {
    let rejectWorkspace
    api.project.mockImplementation((_) => new Promise((resolve, reject) => (rejectWorkspace = reject)))
    const app = mountForStep('overview')
    app.render({ projectId: null, includeRecentActivity: true })
    rejectWorkspace(new Error('old request failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(app.props.onWorkspaceError).not.toHaveBeenCalled()
  })
})
