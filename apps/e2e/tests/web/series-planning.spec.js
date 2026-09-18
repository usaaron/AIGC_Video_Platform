import { createDefaultAttributes } from '../../../web/src/features/assets/assetOptions.js'
import { expect, test } from '@playwright/test'
import { createWebE2EState, mockWebApi, generationTask } from '../fixtures.js'

async function mockEmbeddedStudio(page, launches = []) {
  await page.route('**/api/v1/script-master/launch?*', async (route) => {
    launches.push(new URL(route.request().url()).searchParams.get('projectId'))
    await route.fulfill({
      json: {
        enabled: true,
        launchUrl: new URL('/script-master?host_project_id=project-1', route.request().url()).href,
      },
    })
  })
  await page.route('**/script-master?host_project_id=project-1', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<h1>网剧创作测试目标</h1><textarea aria-label="创作输入"></textarea>
      <button onclick="parent.postMessage({type:'seqora:script-master:synced',projectId:'project-1'},location.origin)">同步完成</button>
      <button onclick="parent.postMessage({type:'seqora:script-master:navigate',projectId:'project-1',view:'assets'},location.origin)">进入资产设计</button>
      <script>parent.postMessage({type:'seqora:script-master:ready',projectId:'project-1'},location.origin)</script>`,
    }),
  )
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`网剧在主站内创作并保留草稿 ${viewport.width}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport)
    const state = createWebE2EState(),
      launches = [],
      generations = []
    state.health.providers.text = 'unconfigured'
    await mockWebApi(page, state)
    await mockEmbeddedStudio(page, launches)
    await page.route('**/api/v1/generation/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      generations.push(route.request().method())
      await route.fulfill({ status: 409, json: {} })
    })
    await page.goto('/?projectId=project-1&view=script')
    const creator = page.frameLocator('iframe[title="网剧创作"]')
    await expect(creator.getByRole('heading', { name: '网剧创作测试目标' })).toBeVisible()
    await expect(page).toHaveURL(/view=script$/)
    const initialLaunchCount = launches.length
    expect(initialLaunchCount).toBeGreaterThan(0)
    if (viewport.width > 600) await expect(page.getByRole('navigation', { name: '创作流程' })).toBeVisible()
    await expect(page.getByRole('region', { name: '剧本生成设置' })).toHaveCount(0)
    await creator.getByRole('textbox').fill('切换后仍然保留的创作草稿')
    await page.getByRole('button', { name: /^制作稿/ }).click()
    await expect(page.locator('.script-textarea-wrap textarea')).toBeVisible()
    await page.getByRole('button', { name: /^剧本创作/ }).click()
    await expect(creator.getByRole('textbox')).toHaveValue('切换后仍然保留的创作草稿')
    state.workspace.project.script = '从创作工作台同步的新制作稿'
    await creator.getByRole('button', { name: '同步完成' }).click()
    await page.getByRole('button', { name: /^制作稿/ }).click()
    await expect(page.locator('.script-textarea-wrap textarea')).toHaveValue('从创作工作台同步的新制作稿')
    await page.getByRole('button', { name: /^剧本创作/ }).click()
    await creator.getByRole('button', { name: '进入资产设计' }).click()
    await expect(page.getByRole('heading', { name: '建立可复用的视觉资产', exact: true })).toBeVisible()
    if (viewport.width < 600) await page.getByRole('button', { name: '打开导航' }).click()
    await page
      .getByRole('navigation', { name: '创作流程' })
      .getByRole('button', { name: /02 剧本/ })
      .click()
    await expect(creator.getByRole('textbox')).toHaveValue('切换后仍然保留的创作草稿')
    expect(launches).toHaveLength(initialLaunchCount)
    expect(launches.every((id) => id === 'project-1')).toBe(true)
    expect(generations).toEqual([])
    expect(context.pages()).toHaveLength(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`series-embedded-${viewport.width}.png`),
      fullPage: true,
    })
  })
}

for (const saveFails of [false, true]) {
  test(`切回创作前保存制作稿并保护失败内容 saveFails=${saveFails}`, async ({ page }) => {
    const state = createWebE2EState(),
      actions = []
    state.workspace.scriptEpisodes = [
      {
        id: 'episode-1',
        projectId: 'project-1',
        episodeNumber: 1,
        title: '午夜来信',
        content: '原有剧集内容',
        draftContent: '',
        status: 'saved',
        revision: 1,
      },
    ]
    await mockWebApi(page, state)
    await mockEmbeddedStudio(page)
    await page.route('**/api/v1/projects/*/script/episodes/save', async (route) => {
      actions.push('save')
      expect(route.request().postDataJSON()).toMatchObject({
        episodeId: 'episode-1',
        content: '修改后的制作稿',
      })
      if (saveFails) return route.fulfill({ status: 503, json: { error: { message: '保存失败，请重试' } } })
      Object.assign(state.workspace.scriptEpisodes[0], { content: '修改后的制作稿', revision: 2 })
      await route.fulfill({ json: state.workspace.scriptEpisodes[0] })
    })
    await page.goto('/?projectId=project-1&view=script')
    await page.getByRole('button', { name: /^制作稿/ }).click()
    const editor = page.locator('.script-textarea-wrap textarea')
    await expect(editor).toHaveValue('原有剧集内容')
    await editor.fill('修改后的制作稿')
    await page.getByRole('button', { name: /^剧本创作/ }).click()
    if (saveFails) {
      await expect(page.getByText('保存失败，请重试')).toBeVisible()
      await expect(editor).toHaveValue('修改后的制作稿')
    } else {
      await expect(page.frameLocator('iframe').getByRole('heading')).toBeVisible()
      await page.getByRole('button', { name: /^制作稿/ }).click()
      await expect(editor).toHaveValue('修改后的制作稿')
    }
    expect(actions).toEqual(['save'])
    await expect(page).toHaveURL(/view=script$/)
  })
}

test('连接失败可重试，拒绝伪造或其他项目的导航消息', async ({ page }) => {
  await mockWebApi(page, createWebE2EState())
  await page.route('**/api/v1/script-master/launch?*', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '创作服务暂不可用' } } }),
  )
  await page.goto('/?projectId=project-1&view=script')
  await expect(page.getByText('创作服务暂不可用')).toBeVisible()
  await mockEmbeddedStudio(page)
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.frameLocator('iframe').getByRole('heading')).toBeVisible()
  await page.evaluate(() => {
    window.postMessage(
      { type: 'seqora:script-master:navigate', projectId: 'project-1', view: 'assets' },
      location.origin,
    )
    const source = document.querySelector('iframe').contentWindow
    for (const data of [
      { projectId: 'other', view: 'assets' },
      { projectId: 'project-1', view: 'admin' },
    ]) {
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          origin: location.origin,
          data: { type: 'seqora:script-master:navigate', ...data },
        }),
      )
    }
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        origin: 'https://other.example',
        data: { type: 'seqora:script-master:navigate', projectId: 'project-1', view: 'assets' },
      }),
    )
  })
  await expect(page.getByRole('navigation', { name: '剧本工作区' })).toBeVisible()
  await expect(page).toHaveURL(/view=script$/)
})

for (const contentType of ['animation', 'advertisement']) {
  test(`保留短片广告生成 ${contentType}`, async ({ page }) => {
    const state = createWebE2EState()
    state.workspace.project.contentType = contentType
    state.health.providers.text = 'configured'
    const submitted = []
    await mockWebApi(page, state)
    await page.route('**/api/v1/generation/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON()
      submitted.push(body)
      await route.fulfill({ json: generationTask({ ...body, kind: 'text', status: 'queued' }) })
    })
    await page.goto('/?projectId=project-1&view=script')
    await expect(page.locator('iframe[title="网剧创作"]')).toHaveCount(0)
    await page
      .locator('.script-textarea-wrap textarea')
      .fill('雨夜中的车站，一位年轻人等待末班列车，收到一封没有署名的信。')
    await page.locator('.script-generation-console .direction-generate-button').click()
    await expect.poll(() => submitted.length).toBe(1)
    expect(submitted[0].projectId).toBe('project-1')
  })
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`人物共用面部、跳过已有及排队造型 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const state = createWebE2EState()
    const face = { id: 'face', url: '/api/v1/media/face', name: '面部基准' }
    const variants = ['标准版', '工作服版', '晚礼服版', '家居服版'].map((name, index) => ({
      id: `look-${index}`,
      name: `林晚-${name}`,
      description: `${name}，合身的布料与清晰的服饰剪裁`,
      bodyReference: index === 0 ? face : null,
      turnaroundReferences: [],
      createdAt: '2026-09-16T00:00:00Z',
      updatedAt: '2026-09-16T00:00:00Z',
    }))
    const asset = {
      id: 'character-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      kind: 'character',
      name: '林晚',
      sourceMode: 'generate',
      description: '年轻女性，黑色长发',
      prompt: '',
      promptMode: 'standard',
      customPromptMode: 'append',
      references: [],
      status: 'draft',
      imageUrl: face.url,
      attributes: {
        ...createDefaultAttributes('character'),
        faceReference: face,
        faceStatus: 'approved',
        appearanceVariants: variants,
        activeAppearanceVariantId: 'look-0',
      },
    }
    state.workspace.assets = [asset]
    state.tasks = [
      generationTask({
        id: 'queued-look',
        status: 'queued',
        metadata: {
          assetId: asset.id,
          generationStage: 'body',
          attributes: { activeAppearanceVariantId: 'look-1' },
        },
      }),
    ]
    const submitted = []
    await mockWebApi(page, state)
    await page.route('**/api/v1/projects/project-1/assets/character-1', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      Object.assign(state.workspace.assets[0], route.request().postDataJSON())
      await route.fulfill({ json: state.workspace.assets[0] })
    })
    await page.route('**/api/v1/generation/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON()
      submitted.push(body)
      const task = generationTask({
        ...body,
        id: `created-${submitted.length}`,
        status: 'queued',
        progress: 0,
      })
      state.tasks.push(task)
      await route.fulfill({ json: task })
    })
    await page.goto('/?projectId=project-1&view=assets')
    await expect(page.getByRole('button', { name: '添加人物', exact: true })).toBeVisible()
    await expect(page.locator('.asset-tabs').getByText('服装', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '编辑资产', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '人物造型', exact: true })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath(`character-looks-${viewport.width}.png`),
      fullPage: true,
    })
    await page.getByRole('button', { name: /批量生成缺失造型（2 套/ }).click()
    await expect.poll(() => submitted.length).toBe(2)
    expect(submitted.map((task) => task.metadata.attributes.activeAppearanceVariantId)).toEqual([
      'look-2',
      'look-3',
    ])
    expect(submitted.every((task) => task.metadata.references[0].id === 'face')).toBe(true)
    expect(submitted[0].prompt).toContain('晚礼服版')
    expect(state.workspace.assets[0].attributes.activeAppearanceVariantId).toBe('look-0')
    await page.getByRole('combobox', { name: '人物造型', exact: true }).selectOption('look-2')
    const versionName = page.getByRole('textbox', { name: '当前版本名称', exact: true })
    await expect(versionName).toHaveValue('林晚-晚礼服版本')
    await versionName.fill('深蓝礼服')
    await page.getByRole('textbox', { name: '造型描述', exact: true }).click()
    await expect
      .poll(() => state.workspace.assets[0].attributes.appearanceVariants[2].name)
      .toBe('林晚-深蓝礼服版本')
    expect(state.workspace.assets[0].attributes.faceReference).toEqual(face)
    await versionName.fill('林晚-标准版本')
    await page.getByRole('textbox', { name: '造型描述', exact: true }).click()
    await expect(page.getByText('已有同名人物版本，请切换使用，或填写不同的服装造型名称')).toBeVisible()
    expect(state.workspace.assets[0].attributes.appearanceVariants).toHaveLength(4)
    await expect(versionName).toHaveValue('林晚-深蓝礼服版本')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`character-version-name-${viewport.width}.png`),
      fullPage: true,
    })
  })
}
