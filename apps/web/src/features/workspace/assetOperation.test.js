import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../services/apiClient'
import { createWorkspaceCommands } from './workspaceCommands'

vi.mock('../../services/apiClient', () => ({
  api: {
    createAsset: vi.fn(),
    createTask: vi.fn(),
    project: vi.fn(),
    projects: vi.fn(),
    tasks: vi.fn(),
    billing: vi.fn(),
  },
}))

const project = { id: 'project-1', aspectRatio: '9:16' }
const workspace = { project, assets: [], scriptEpisodes: [], shots: [] }
const input = {
  kind: 'prop',
  sourceMode: 'generate',
  name: '白宫徽章',
  description: '银色徽章',
  prompt: '银色徽章，正面视图',
  attributes: { type: 'prop' },
}

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function setup(assetOperationInFlightRef, { projects = [] } = {}) {
  return createWorkspaceCommands({
    project,
    projects,
    workspace,
    tasks: [],
    workspaceCacheRef: { current: new Map() },
    activeProjectIdRef: { current: project.id },
    assetOperationInFlightRef,
    replaceTasks: vi.fn(),
    refreshSession: vi.fn(),
    setWorkspace: vi.fn(),
    setProjects: vi.fn(),
    setTasks: vi.fn(),
    setBilling: vi.fn(),
    setToast: vi.fn(),
    setActiveProject: vi.fn(),
    setActiveStep: vi.fn(),
    setMobileNav: vi.fn(),
    markNotificationRead: vi.fn(),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  api.project.mockResolvedValue(workspace)
  api.projects.mockResolvedValue([])
  api.tasks.mockResolvedValue([])
  api.billing.mockResolvedValue({ credits: 100 })
})

describe('project asset operations', () => {
  it('shares a pending asset write across command instances for the same project', async () => {
    const request = deferred()
    const created = { id: 'asset-1', ...input }
    api.createAsset.mockReturnValue(request.promise)
    const assetOperationInFlightRef = { current: new Map() }
    const first = setup(assetOperationInFlightRef)
    const second = setup(assetOperationInFlightRef)

    const firstResult = first.createAsset(input)
    const secondResult = second.createAsset({ ...input, attributes: { ...input.attributes } })
    await Promise.resolve()
    await Promise.resolve()
    expect(api.createAsset).toHaveBeenCalledOnce()

    request.resolve(created)
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([created, created])
  })

  it('does not submit duplicate model asset suggestions while the request is pending', async () => {
    const request = deferred()
    const task = { id: 'suggestion-task', projectId: project.id, status: 'queued' }
    api.createTask.mockReturnValue(request.promise)
    const assetOperationInFlightRef = { current: new Map() }
    const first = setup(assetOperationInFlightRef)
    const second = setup(assetOperationInFlightRef)
    const suggestion = {
      script: '外星人攻打白宫',
      sourceScriptFingerprint: 'script-fingerprint-1',
      assetRevision: 'asset:none',
    }

    const firstResult = first.createScriptJob('资产建议', 'suggest-assets', suggestion)
    const secondResult = second.createScriptJob('资产建议', 'suggest-assets', { ...suggestion })
    await Promise.resolve()
    await Promise.resolve()
    expect(api.createTask).toHaveBeenCalledOnce()

    request.resolve(task)
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([task, task])
  })

  it('waits for the destination project before opening a notification stage', async () => {
    const request = deferred()
    const readyWorkspace = {
      ...workspace,
      project: { ...project, script: '已保存剧本' },
    }
    api.project.mockReturnValue(request.promise)
    const commands = setup({ current: new Map() }, { projects: [project] })
    const destination = commands.openNotification({
      id: 'notification-1',
      projectId: project.id,
      target: 'assets',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(api.project).toHaveBeenCalledOnce()

    request.resolve(readyWorkspace)
    await expect(destination).resolves.toBe(true)
  })
})
