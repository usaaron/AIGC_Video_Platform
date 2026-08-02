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

    await api.login({ email: 'member@seqora.local', password: 'MemberPassword123!' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('sends invitation-code registration requests with cookie credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ account: { id: 'user-1' }, permissions: [] }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api.register({
      token: 'invite-token-'.padEnd(32, '1'),
      name: 'New Member',
      email: 'member@example.com',
      password: 'MemberPassword123!',
      verificationCode: '123456',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/register',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          token: 'invite-token-'.padEnd(32, '1'),
          name: 'New Member',
          email: 'member@example.com',
          password: 'MemberPassword123!',
          verificationCode: '123456',
        }),
      }),
    )
  })

  it('requests an email code before invitation registration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        expiresAt: '2026-08-03T12:10:00.000Z',
        resendAfterSeconds: 60,
      }, { status: 202 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api.requestRegistrationCode({
      token: 'invite-token-'.padEnd(32, '1'),
      email: 'member@example.com',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/registration-code/request',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          token: 'invite-token-'.padEnd(32, '1'),
          email: 'member@example.com',
        }),
      }),
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

  it('calls payment configuration and checkout endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          provider: 'stripe',
          enabled: true,
          memberSubscriptionEnabled: true,
          creditPurchaseEnabled: true,
          creditPackCredits: 100,
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            provider: 'stripe',
            checkoutType: 'subscription',
            checkoutSessionId: 'cs_test_subscription',
            url: 'https://checkout.stripe.test/subscription',
            status: 'open',
            plan: 'member',
            credits: null,
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            provider: 'stripe',
            checkoutType: 'credits',
            checkoutSessionId: 'cs_test_credits',
            url: 'https://checkout.stripe.test/credits',
            status: 'open',
            plan: null,
            credits: 100,
          },
          { status: 201 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await api.billingPaymentConfiguration()
    await api.createMemberSubscriptionCheckout()
    await api.createCreditCheckout({ credits: 100 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/billing/payment/configuration',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/billing/checkout/subscription',
      expect.objectContaining({ method: 'POST', credentials: 'include', body: '{}' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/billing/checkout/credits',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ credits: 100 }),
      }),
    )
  })

  it('calls organization switching and self-session account endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({
          account: { tenantId: 'tenant-2', organizationId: 'tenant-2' },
          workspace: { id: 'tenant-2' },
          organization: { id: 'tenant-2' },
        }),
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.organizations()
    await api.switchOrganization('tenant-2')
    await api.authSessions()
    await api.revokeAuthSession('session-1')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/organizations',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/organizations/tenant-2/switch',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/auth/sessions',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/auth/sessions/session-1',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
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
        body: JSON.stringify({ mode: 'partial', force: false, episodeNumber: null }),
      }),
    )
  })

  it('calls novel import, chapter summary and story bible endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ previewId: 'preview-1', chapters: [] }))
      .mockResolvedValueOnce(Response.json({ document: { id: 'novel-1' }, chapters: [] }, { status: 201 }))
      .mockResolvedValueOnce(Response.json([{ id: 'novel-1', name: '雨夜旧站' }]))
      .mockResolvedValueOnce(Response.json({ document: { id: 'novel-1' }, chapters: [] }))
      .mockResolvedValueOnce(Response.json({ summaries: [], missingSummaryCount: 2 }))
      .mockResolvedValueOnce(Response.json({ queue: null, items: [] }))
      .mockResolvedValueOnce(Response.json({ queue: { id: 'queue-1' }, items: [] }))
      .mockResolvedValueOnce(Response.json({ summaries: [], generatedSummaries: [] }))
      .mockResolvedValueOnce(Response.json({ storyBible: null, missingSummaryCount: 0 }))
      .mockResolvedValueOnce(Response.json({ storyBible: { title: '雨夜旧站' } }))
      .mockResolvedValueOnce(Response.json({ script: '场次：1｜剧情：渡口等待。', chapters: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const input = {
      clientRequestId: 'novel-import-1',
      name: '雨夜旧站',
      format: 'txt',
      content: '第一章 雨夜来信\n林夏收到一封信。',
    }

    await api.previewNovelSplit('project-1', input)
    await api.importNovel('project-1', input)
    await api.novels('project-1')
    await api.novel('project-1', 'novel-1')
    await api.novelSummaries('project-1', 'novel-1')
    await api.novelSummaryQueue('project-1', 'novel-1')
    await api.createNovelSummaryQueue('project-1', 'novel-1', {
      clientRequestId: 'queue-1',
      batchSize: 4,
    })
    await api.generateNovelSummaries('project-1', 'novel-1', {
      clientRequestId: 'summary-1',
      batchSize: 4,
    })
    await api.novelStoryBible('project-1', 'novel-1')
    await api.generateNovelStoryBible('project-1', 'novel-1', {
      clientRequestId: 'bible-1',
      force: true,
    })
    await api.generateNovelChapterAdaptation('project-1', 'novel-1', {
      clientRequestId: 'adapt-1',
      chapterIds: ['chapter-1'],
      targetSeconds: 60,
      mode: 'scene',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-1/novels/preview-split',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(input),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-1/novels/import',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(input),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/projects/project-1/novels',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/projects/project-1/novels/novel-1',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/v1/projects/project-1/novels/novel-1/summaries',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ clientRequestId: 'queue-1', batchSize: 4 }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      '/api/v1/projects/project-1/novels/novel-1/summaries/generate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ clientRequestId: 'summary-1', batchSize: 4 }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      '/api/v1/projects/project-1/novels/novel-1/story-bible',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      10,
      '/api/v1/projects/project-1/novels/novel-1/story-bible/generate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ clientRequestId: 'bible-1', force: true }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      11,
      '/api/v1/projects/project-1/novels/novel-1/adapt-script',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          clientRequestId: 'adapt-1',
          chapterIds: ['chapter-1'],
          targetSeconds: 60,
          mode: 'scene',
        }),
      }),
    )
  })

  it('calls novel summary queue control endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ queue: { id: 'queue-1' }, items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await api.runNovelSummaryQueueBatch('project-1', 'novel-1', 'queue-1', {
      clientRequestId: 'run-1',
      batchSize: 2,
    })
    await api.pauseNovelSummaryQueue('project-1', 'novel-1', 'queue-1')
    await api.resumeNovelSummaryQueue('project-1', 'novel-1', 'queue-1')
    await api.retryNovelSummaryQueueItem('project-1', 'novel-1', 'queue-1', 'item-1')
    await api.skipNovelSummaryQueueItem('project-1', 'novel-1', 'queue-1', 'item-1')
    await api.commitNovelSummaryQueueResults('project-1', 'novel-1', 'queue-1', { force: true })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue/queue-1/run-batch',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ clientRequestId: 'run-1', batchSize: 2 }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue/queue-1/pause',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue/queue-1/resume',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue/queue-1/items/item-1/retry',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue/queue-1/items/item-1/skip',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      '/api/v1/projects/project-1/novels/novel-1/summary-queue/queue-1/commit-results',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ force: true }),
      }),
    )
  })

  it('calls novel boundary detection endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ boundaries: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await api.novelBoundaries('project-1', 'novel-1')
    await api.detectNovelBoundaries('project-1', 'novel-1', { force: true, maxBoundaries: 10 })
    await api.generateNovelBoundaryNotes('project-1', 'novel-1', {
      clientRequestId: 'boundary-notes-1',
      batchSize: 2,
      boundaryIds: ['boundary-1'],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-1/novels/novel-1/boundaries',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-1/novels/novel-1/boundaries/detect',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ force: true, maxBoundaries: 10 }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/projects/project-1/novels/novel-1/boundaries/notes/generate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          clientRequestId: 'boundary-notes-1',
          batchSize: 2,
          boundaryIds: ['boundary-1'],
        }),
      }),
    )
  })

  it('requests script asset suggestions from the current draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ summary: '核心资产建议', assets: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const direction = {
      style: 'cinematic-cg',
      composition: 'rule-of-thirds',
      lighting: 'low-key',
      camera: 'restrained',
      focus: 'character',
    }

    await api.suggestScriptAssets(
      'project-1',
      '场次：1｜场景：边城药铺｜角色：女剑客｜关键物件：旧长剑',
      direction,
      'asset-suggestions-1',
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/script/asset-suggestions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          clientRequestId: 'asset-suggestions-1',
          script: '场次：1｜场景：边城药铺｜角色：女剑客｜关键物件：旧长剑',
          direction,
        }),
      }),
    )
  })

  it('requests novel asset suggestions from the selected document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ summary: '小说资产建议', assets: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await api.suggestNovelAssets('project-1', 'novel-1', {
      clientRequestId: 'novel-assets-1',
      maxAssets: 12,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/novels/novel-1/asset-suggestions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          clientRequestId: 'novel-assets-1',
          maxAssets: 12,
        }),
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

  it('sends long-form segment generation requests without changing the quick endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ script: '已有剧本\n\n下一段', mode: 'segment' }))
    vi.stubGlobal('fetch', fetchMock)
    const direction = {
      style: 'cinematic-cg',
      composition: 'rule-of-thirds',
      lighting: 'low-key',
      camera: 'restrained',
      focus: 'character',
    }

    await api.generateScriptSegment(
      'project-1',
      '已有剧本',
      direction,
      { goal: '进入第二个冲突', targetMinutes: 5 },
      'segment-1',
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/script/generate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          clientRequestId: 'segment-1',
          draft: '已有剧本',
          direction,
          mode: 'segment',
          segment: { goal: '进入第二个冲突', targetMinutes: 5 },
        }),
      }),
    )
  })

  it('sends web-series mode and episode duration to generation endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ script: '网剧剧本' }))
    vi.stubGlobal('fetch', fetchMock)
    const direction = {
      style: 'cinematic-cg',
      composition: 'dynamic',
      lighting: 'high-contrast',
      camera: 'suspense',
      focus: 'balanced',
    }

    await api.generateScript('project-1', '故事素材', direction, 'web-series-1', {
      productionMode: 'web-series',
      episodeMinutes: 3,
      model: 'kimi-3',
      revisionNote: '保留主角关系，强化结尾钩子',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      productionMode: 'web-series',
      episodeMinutes: 3,
      model: 'kimi-3',
      revisionNote: '保留主角关系，强化结尾钩子',
    })
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
