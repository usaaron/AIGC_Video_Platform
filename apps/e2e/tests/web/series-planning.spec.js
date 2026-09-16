import { createDefaultAttributes } from '../../../web/src/features/assets/assetOptions.js'
import { expect, test } from '@playwright/test'
import { createWebE2EState, mockWebApi, generationTask } from '../fixtures.js'

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`长素材确认分集后才提交生成 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const state = createWebE2EState()
    state.health.providers.text = 'configured'
    const material = '林晚拿着信回到诊所，程野告诉她父亲留下了一张地图。'.repeat(110)
    state.workspace.project.script = material
    state.workspace.scriptEpisodes = []
    const submitted = []
    await mockWebApi(page, state)
    await page.route('**/api/v1/projects/*/script/asset-suggestions', (route) =>
      route.fulfill({ json: { assets: [], summary: '扫描完成', warnings: [] } }),
    )
    await page.route('**/api/v1/generation/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON()
      submitted.push(body)
      const task = generationTask({ ...body, status: 'queued', kind: 'text', provider: 'text', progress: 0 })
      state.tasks = [task]
      await route.fulfill({ json: task })
    })
    await page.goto('/?projectId=project-1&view=script')
    await page.getByRole('button', { name: /生成第 1 集/ }).click()
    const panel = page.getByRole('region', { name: '分集计划' })
    await expect(panel).toBeVisible()
    expect(submitted).toHaveLength(0)
    await panel.getByRole('textbox', { name: '第1集标题', exact: true }).fill('林晚归来')
    await expect(page.locator('.script-textarea-wrap textarea')).toHaveValue(material)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`episode-plan-${viewport.width}.png`), fullPage: true })
    await panel.getByRole('button', { name: /确认并生成/ }).click()
    await expect.poll(() => submitted.length).toBe(1)
    expect(submitted[0].metadata.episodePlan.episodes[0].title).toBe('林晚归来')
    expect(submitted[0].metadata.episodePlan.episodes.map((item) => item.source).join('')).toBe(material)
    expect(submitted[0].estimatedCredits).toBeGreaterThan(0)
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
