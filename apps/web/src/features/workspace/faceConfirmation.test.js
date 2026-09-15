import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../services/apiClient'
import { createWorkspaceCommands } from './workspaceCommands'

vi.mock('../../services/apiClient', () => ({
  api: { confirmCharacterFace: vi.fn(), tasks: vi.fn(), billing: vi.fn() },
}))

const reference = { id: 'face-1', url: '/face.png', name: '面部' }

function setup(result) {
  const setWorkspace = vi.fn()
  const setToast = vi.fn()
  const replaceTasks = vi.fn()
  api.confirmCharacterFace.mockResolvedValue(result)
  const commands = createWorkspaceCommands({
    project: { id: 'project-1' },
    workspace: { assets: [] },
    activeProjectIdRef: { current: 'project-1' },
    setWorkspace,
    setToast,
    replaceTasks,
    setBilling: vi.fn(),
    refreshSession: vi.fn(),
  })
  return { commands, setWorkspace, setToast, replaceTasks }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.tasks.mockResolvedValue([])
  api.billing.mockResolvedValue({ credits: 10 })
})

describe('face confirmation workspace synchronization', () => {
  it('keeps the saved face and exposes a registration error', async () => {
    const result = {
      asset: { id: 'character-1' },
      registrationTask: null,
      registrationError: '面部已确认，但积分不足',
    }
    const { commands, setWorkspace, setToast } = setup(result)
    await expect(commands.confirmCharacterFace('character-1', reference)).resolves.toBe(result)
    expect(api.confirmCharacterFace).toHaveBeenCalledWith('project-1', 'character-1', reference)
    expect(setWorkspace).toHaveBeenCalledOnce()
    expect(setToast).toHaveBeenCalledWith(result.registrationError)
  })

  it('does not report an accepted confirmation as failed if task refresh fails', async () => {
    const result = {
      asset: { id: 'character-1' },
      registrationTask: { id: 'registration-1' },
      registrationError: null,
    }
    const { commands, setToast } = setup(result)
    api.tasks.mockRejectedValue(new Error('network offline'))
    await expect(commands.confirmCharacterFace('character-1', reference)).resolves.toBe(result)
    expect(api.billing).toHaveBeenCalledOnce()
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining('面部已确认'))
  })

  it('does not update UI state when the confirmation itself fails', async () => {
    const { commands, setWorkspace } = setup(null)
    api.confirmCharacterFace.mockRejectedValue(new Error('人物无权访问'))
    await expect(commands.confirmCharacterFace('character-1', reference)).rejects.toThrow('人物无权访问')
    expect(setWorkspace).not.toHaveBeenCalled()
    expect(api.tasks).not.toHaveBeenCalled()
  })
})
