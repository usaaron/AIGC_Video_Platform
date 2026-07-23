import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, AUTH_EXPIRED_EVENT, waitForProjectScriptUpdate } from './apiClient'

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('sends login requests with cookie credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ account: { id: 'user-1' }, permissions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api.login({ email: 'creator@seqora.local', password: 'Creator123!' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('surfaces API error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(api.login({ email: 'bad@example.com', password: 'wrong-password' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: '邮箱或密码错误',
    })
  })

  it('notifies the app when an authenticated request loses its session', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录' } }, { status: 401 }),
        ),
    )

    await expect(api.projects()).rejects.toMatchObject({ status: 401 })

    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0][0].type).toBe(AUTH_EXPIRED_EVENT)
  })

  it('keeps the session when the current password is incorrect', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'CURRENT_PASSWORD_INVALID', message: '当前密码错误' } },
            { status: 401 },
          ),
        ),
    )

    await expect(
      api.changePassword({ currentPassword: 'WrongPassword!', newPassword: 'NewPassword123!' }),
    ).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID', status: 401 })

    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('calls the authenticated password update endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.changePassword({
      currentPassword: 'CurrentPassword123!',
      newPassword: 'NewPassword123!',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/password',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: 'CurrentPassword123!',
          newPassword: 'NewPassword123!',
        }),
      }),
    )
  })

  it('uploads media as multipart data without overriding its content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'media-1', url: '/api/v1/media/media-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api.uploadMedia('project-1', new File(['image'], 'reference.png', { type: 'image/png' }))

    const options = fetchMock.mock.calls[0][1]
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.headers).not.toHaveProperty('Content-Type')
  })

  it('calls the task pause, resume and delete endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'task-1', status: 'paused' }))
      .mockResolvedValueOnce(Response.json({ id: 'task-1', status: 'queued' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.pauseTask('task-1')
    await api.resumeTask('task-1')
    await api.deleteTask('task-1')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/generation/tasks/task-1/pause',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/generation/tasks/task-1/resume',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/generation/tasks/task-1',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
  })

  it('lists trusted portraits by whitelist type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)

    await api.trustedPortraits('LivenessFace')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/trusted-assets/portraits?groupType=LivenessFace',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('creates a server-side full film preview task', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'preview-task', status: 'running' }))
    vi.stubGlobal('fetch', fetchMock)

    await api.createFilmPreview('project-1', 'partial')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/film-preview',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ mode: 'partial', force: false }),
      }),
    )
  })

  it('sends creative direction to script generation and review plus the shot split limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ script: '场景：雨夜车站' }))
      .mockResolvedValueOnce(Response.json({ score: 80, dimensions: [] }))
      .mockResolvedValueOnce(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const direction = {
      style: 'photorealistic',
      composition: 'rule-of-thirds',
      lighting: 'low-key',
      camera: 'restrained',
      focus: 'character',
    }

    await api.generateScript('project-1', '故事草稿', direction, 'script-generate-1')
    await api.reviewScript('project-1', '完整剧本', direction, 'script-review-1')
    await api.generateShots('project-1', { maxShots: 8 })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      clientRequestId: 'script-generate-1',
      draft: '故事草稿',
      direction,
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      clientRequestId: 'script-review-1',
      script: '完整剧本',
      direction,
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ maxShots: 8 })
  })

  it('sends the quick script to the explicit visual detail enrichment endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ script: '补齐后的剧本', mode: 'detailed', warnings: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const direction = {
      style: 'cinematic-cg',
      composition: 'centered',
      lighting: 'backlight',
      camera: 'immersive',
      focus: 'scene',
    }

    await api.enrichScript('project-1', '快速剧本', direction, 'script-enrich-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/script/enrich',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ clientRequestId: 'script-enrich-1', script: '快速剧本', direction }),
      }),
    )
  })

  it('recovers a generated script saved after the original connection ends', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ project: { id: 'project-1', script: '旧剧本' } }))
      .mockResolvedValueOnce(Response.json({ project: { id: 'project-1', script: '生成后的新剧本' } }))
    vi.stubGlobal('fetch', fetchMock)

    const workspace = await waitForProjectScriptUpdate('project-1', '旧剧本', {
      timeoutMs: 100,
      pollIntervalMs: 0,
    })

    expect(workspace.project.script).toBe('生成后的新剧本')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('plans and executes a one-click quick start batch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ sourceScriptHash: 'a'.repeat(64), assets: [] }))
      .mockResolvedValueOnce(Response.json({ batchId: 'batch-1', tasks: [] }, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const input = {
      clientRequestId: 'quick-start-1',
      sourceScriptHash: 'a'.repeat(64),
      assets: [],
    }

    await api.planQuickStart('project-1')
    await api.executeQuickStart('project-1', input)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-1/quick-start/plan',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-1/quick-start/execute',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(input)
  })
})
