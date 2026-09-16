import { expect, test } from '@playwright/test'
import {
  assetLibraryItem,
  createWebE2EState,
  generationTask,
  mockWebApi,
  tinyImageDataUrl,
} from '../fixtures.js'

const originalPrompt = '林晚在诊所拿起旧怀表，望向窗外。'

async function setup(page, options = {}) {
  const state = createWebE2EState()
  state.health.providers.seedance = 'configured'
  state.workspace.shots = [
    {
      id: 'shot-1',
      projectId: 'project-1',
      order: 1,
      title: '诊所重逢',
      framing: '中景',
      prompt: originalPrompt,
      duration: 5,
      episodeNumber: 1,
      episodeTitle: '归来',
      episodeKind: 'standard',
      continuityMode: 'independent',
      imageUrl: null,
    },
  ]
  state.workspace.assets = [
    { id: 'character-1', kind: 'character', name: '林晚', imageUrl: tinyImageDataUrl },
    { id: 'prop-1', kind: 'prop', name: '旧怀表' },
    { id: 'scene-1', kind: 'scene', name: '诊所', imageUrl: tinyImageDataUrl },
    { id: 'character-2', kind: 'character', name: '程野' },
  ].map((asset) => ({
    projectId: 'project-1',
    attributes: {},
    references: [],
    prompt: '',
    description: '',
    ...asset,
  }))
  state.tasks = [
    generationTask({
      id: 'old-video',
      kind: 'video',
      provider: 'seedance',
      status: options.active ? 'running' : 'completed',
      metadata: { shotId: 'shot-1', resolution: '1080p' },
    }),
  ]
  state.libraryItems = options.libraryItems || [
    assetLibraryItem({
      id: 'template-1',
      kind: 'prompt-template',
      title: '电影近景',
      contentType: 'text/plain',
      sourceSnapshot: { contentPreview: '柔和侧光，浅景深。' },
    }),
  ]
  const saves = []
  const jobs = []
  await mockWebApi(page, state)
  await page.route('**/api/v1/projects/project-1/shots/shot-1', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const input = route.request().postDataJSON()
    saves.push(input)
    if (options.saveFails) return route.fulfill({ status: 500, json: { error: { message: '保存暂时失败' } } })
    Object.assign(state.workspace.shots[0], input)
    await route.fulfill({ json: state.workspace.shots[0] })
  })
  await page.route('**/api/v1/generation/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const input = route.request().postDataJSON()
    jobs.push(input)
    if (options.generateFails)
      return route.fulfill({ status: 503, json: { error: { message: '生成服务暂不可用' } } })
    if (options.holdJob) await options.holdJob
    const task = generationTask({ ...input, id: 'new-video', status: 'queued', progress: 0 })
    state.tasks.unshift(task)
    await route.fulfill({ json: task })
  })
  await page.goto('/?projectId=project-1&view=storyboard')
  await expect(page.getByRole('button', { name: '编辑分镜', exact: true })).toBeVisible()
  return { state, saves, jobs }
}

for (const width of [1440, 390]) {
  test(`镜头资产、模板与保存生成闭环 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    const { state, saves, jobs } = await setup(page)
    const edit = page.getByRole('button', { name: '编辑分镜', exact: true })
    expect((await edit.boundingBox()).height).toBeGreaterThanOrEqual(44)
    const rowBox = await page.locator('.shot-row').boundingBox()
    const editBox = await edit.boundingBox()
    expect(editBox.x + editBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width)
    await expect(page.getByRole('button', { name: '再抽一次', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`storyboard-${width}.png`), fullPage: true })
    await edit.click()
    const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
    const prompt = dialog.getByRole('textbox', { name: '画面提示词' })
    await expect
      .poll(async () => (await prompt.boundingBox()).height)
      .toBeGreaterThanOrEqual(width === 390 ? 360 : 420)
    await expect(dialog.getByRole('button', { name: '插入人物 林晚' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '插入物品 旧怀表' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '插入场景 诊所' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '插入人物 程野' })).toHaveCount(0)
    await prompt.fill('等待。')
    await prompt.press('Home')
    await dialog.getByRole('button', { name: '插入人物 林晚' }).click()
    await expect(prompt).toHaveValue('林晚等待。')
    await expect(prompt).toBeFocused()
    await prompt.press('End')
    await expect(dialog.getByRole('button', { name: '添加项目资产' })).toHaveCount(0)
    await dialog.getByRole('button', { name: '插入物品 旧怀表' }).click()
    await expect(prompt).toHaveValue('林晚等待。旧怀表')
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`) })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true)
    await expect.poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)

    await dialog.getByRole('button', { name: '存为提示词模板' }).click()
    const templateEditor = page.getByRole('dialog', { name: '新建提示词模板' })
    await templateEditor.getByRole('textbox', { name: '模板名称' }).fill('归来镜头')
    await templateEditor.getByRole('button', { name: '保存模板', exact: true }).click()
    await expect(templateEditor).toHaveCount(0)
    expect(saves).toHaveLength(0)
    expect(jobs).toHaveLength(0)
    expect(state.libraryItems.at(-1).sourceSnapshot.contentPreview).toBe('林晚等待。旧怀表')
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: '使用提示词模板' }).click()
    let picker = page.getByRole('dialog', { name: '选择提示词模板' })
    await expect(picker.getByRole('article')).toHaveCount(2)
    const inset = await picker
      .locator('.shot-template-picker-body')
      .evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft))
    expect(inset).toBeGreaterThanOrEqual(16)
    await expect(picker.locator('article > strong').first()).toHaveCSS('color', 'rgb(36, 86, 56)')
    await page.screenshot({ path: testInfo.outputPath(`template-picker-${width}.png`) })
    await picker
      .getByRole('article')
      .filter({ hasText: '电影近景' })
      .getByRole('button', { name: '编辑模板' })
      .click()
    const modify = page.getByRole('dialog', { name: '编辑提示词模板' })
    await modify.getByRole('textbox', { name: '提示词内容' }).fill('柔和侧光，人物近景，缓慢推镜。')
    await modify.getByRole('button', { name: '保存模板', exact: true }).click()
    await expect(modify).toHaveCount(0)
    expect(state.libraryItems[0].currentVersion).toBe(2)
    expect(saves).toHaveLength(0)
    await expect(prompt).toHaveValue('林晚等待。旧怀表')
    await prompt.click()
    await prompt.press('Control+End')
    await dialog.getByRole('button', { name: '使用提示词模板' }).click()
    picker = page.getByRole('dialog', { name: '选择提示词模板' })
    await picker
      .getByRole('article')
      .filter({ hasText: '电影近景' })
      .getByRole('button', { name: '插入模板' })
      .click()
    await expect(picker).toHaveCount(0)
    await expect(prompt).toHaveValue('林晚等待。旧怀表；柔和侧光，人物近景，缓慢推镜。')
    const highlighted = dialog.locator('.prompt-template-text')
    await expect(highlighted).toHaveText('柔和侧光，人物近景，缓慢推镜。')
    await expect(highlighted).toHaveCSS('color', 'rgb(36, 86, 56)')
    await expect(prompt).toHaveCSS('-webkit-text-fill-color', 'rgba(0, 0, 0, 0)')
    await page.screenshot({ path: testInfo.outputPath(`inserted-template-${width}.png`) })
    await dialog.getByRole('button', { name: '保存并生成新版' }).click()
    await expect(dialog).toHaveCount(0)
    expect(saves).toHaveLength(1)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].prompt).toContain('林晚等待。旧怀表；柔和侧光，人物近景，缓慢推镜。')
    expect(jobs[0].metadata.resolution).toBe('1080p')
    expect(jobs[0].estimatedCredits).toBe(18)
    expect(state.tasks.some((task) => task.id === 'old-video')).toBe(true)
    await expect(edit).toBeDisabled()
  })
}

test('模板正文颜色随编辑移动，清空后恢复普通文字显示', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '编辑分镜', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
  const prompt = dialog.getByRole('textbox', { name: '画面提示词' })
  await prompt.fill('已有画面。')
  await prompt.press('Control+End')
  await dialog.getByRole('button', { name: '使用提示词模板' }).click()
  await page.getByRole('dialog', { name: '选择提示词模板' }).getByRole('button', { name: '插入模板' }).click()
  await expect(dialog.locator('.prompt-template-text')).toHaveText('柔和侧光，浅景深。')
  await prompt.click()
  await prompt.press('Control+Home')
  await prompt.pressSequentially('前景：')
  await expect(dialog.locator('.prompt-template-text')).toHaveText('柔和侧光，浅景深。')
  await prompt.press('Control+End')
  await prompt.press('ArrowLeft')
  await prompt.pressSequentially('，保持自然')
  await expect(dialog.locator('.prompt-template-text')).toHaveText('柔和侧光，浅景深，保持自然。')
  await prompt.fill('')
  await expect(dialog.locator('.prompt-template-text')).toHaveCount(0)
  await expect(prompt).toHaveCSS('-webkit-text-fill-color', 'rgb(43, 47, 41)')
})

for (const width of [1440, 390]) {
  test(`资产库图片导入、剧本传参和参考视频禁用 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    const fullText = '剧本开头。\n顾砚拿起瓷碗，妹妹望向窗外。'
    const { state, saves, jobs } = await setup(page, {
      libraryItems: [
        assetLibraryItem(),
        assetLibraryItem({
          id: 'library-script-1',
          kind: 'script',
          title: '修复瓷碗',
          contentType: 'text/plain',
          currentVersion: 3,
          sourceSnapshot: { contentPreview: '只有摘要' },
        }),
      ],
    })
    await page.route('**/library/items/library-script-1/versions/3/download', (route) =>
      route.fulfill({ contentType: 'text/plain', body: fullText }),
    )
    const mediaUrl = '/api/v1/media/media-imported-1/content'
    await page.route('**/projects/project-1/library/import', async (route) => {
      state.libraryImports.push(route.request().postDataJSON())
      await route.fulfill({
        json: {
          item: state.libraryItems[0],
          imported: { type: 'media', media: { kind: 'image', url: mediaUrl } },
        },
      })
    })
    await page.route('**/media/media-imported-1/content', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(tinyImageDataUrl.split(',')[1], 'base64'),
      }),
    )
    await page.getByRole('button', { name: '编辑分镜', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
    const prompt = dialog.getByRole('textbox', { name: '画面提示词' })
    const libraryButton = dialog.getByRole('button', { name: '使用资产库资产' })
    const templateButton = dialog.getByRole('button', { name: '使用提示词模板' })
    await expect(templateButton).toHaveCSS('color', 'rgb(36, 86, 56)')
    if (width === 1440)
      expect((await libraryButton.boundingBox()).x).toBeLessThan((await templateButton.boundingBox()).x)
    const video = dialog.getByRole('group', { name: '参考视频（开发中）' })
    await expect(video.getByRole('button', { name: '本地上传' })).toBeDisabled()
    await expect(video.getByRole('button', { name: '输入 URL' })).toBeDisabled()
    await libraryButton.click()
    const picker = page.getByRole('dialog', { name: '使用资产库资产' })
    await expect(picker.getByRole('article')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath(`library-picker-${width}.png`) })
    expect(await picker.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await picker.getByRole('button', { name: '用作参考图' }).click()
    await expect(picker).toHaveCount(0)
    await expect(dialog.getByRole('img', { name: '镜头参考', exact: true })).toHaveAttribute('src', mediaUrl)
    expect(state.libraryImports).toEqual([{ itemId: 'library-image-1', target: 'media' }])
    await prompt.fill('已有画面。')
    await prompt.press('Control+End')
    await libraryButton.click()
    await picker.getByRole('button', { name: '剧本', exact: true }).click()
    await picker.getByRole('button', { name: '选择剧本段落' }).click()
    const script = picker.getByRole('textbox', { name: '剧本全文（可选取段落）' })
    await expect(script).toHaveValue(fullText)
    await script.click()
    await script.press('Control+End')
    await script.press('Shift+Home')
    await expect
      .poll(() => script.evaluate((node) => node.selectionEnd - node.selectionStart))
      .toBe(fullText.split('\n').at(-1).length)
    await picker.getByRole('button', { name: '插入选中文本' }).click()
    await expect(prompt).toHaveValue('已有画面。顾砚拿起瓷碗，妹妹望向窗外。')
    expect(state.libraryImports).toHaveLength(1)
    await dialog.getByRole('button', { name: '保存并生成新版' }).click()
    await expect(dialog).toHaveCount(0)
    expect(saves[0].imageUrl).toBe(mediaUrl)
    expect(jobs[0].metadata.manualReferenceUrl).toBe(mediaUrl)
    expect(jobs[0].prompt).toContain('顾砚拿起瓷碗')
  })
}

test('资产导入失败保留草稿；长剧本须选段，累计超长不静默截断', async ({ page }) => {
  const { state, saves, jobs } = await setup(page, {
    libraryItems: [
      assetLibraryItem(),
      assetLibraryItem({
        id: 'long-script',
        kind: 'script',
        title: '长剧本',
        contentType: 'text/plain',
        sourceSnapshot: { contentPreview: '长'.repeat(5001) + '\n结尾短句。' },
      }),
    ],
  })
  await page.route('**/projects/project-1/library/import', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '图片导入暂时不可用' } } }),
  )
  await page.getByRole('button', { name: '编辑分镜', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
  const prompt = dialog.getByRole('textbox', { name: '画面提示词' })
  await prompt.fill('原'.repeat(4999))
  await dialog.getByRole('button', { name: '使用资产库资产' }).click()
  const picker = page.getByRole('dialog', { name: '使用资产库资产' })
  await picker.getByRole('button', { name: '用作参考图' }).click()
  await expect(picker.getByRole('alert')).toContainText('图片导入暂时不可用')
  await expect(prompt).toHaveValue('原'.repeat(4999))
  await picker.getByRole('button', { name: '剧本', exact: true }).click()
  await picker.getByRole('button', { name: '选择剧本段落' }).click()
  await expect(picker.getByRole('button', { name: '插入全文' })).toBeDisabled()
  const script = picker.getByRole('textbox', { name: '剧本全文（可选取段落）' })
  await script.click()
  await script.press('Control+End')
  await script.press('Shift+Home')
  await picker.getByRole('button', { name: '插入选中文本' }).click()
  await expect(picker.getByRole('alert')).toContainText('超过 5,000 字')
  await expect(prompt).toHaveValue('原'.repeat(4999))
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(state.libraryImports).toHaveLength(0)
  expect(saves).toHaveLength(0)
  expect(jobs).toHaveLength(0)
})

test('读取完整模板、超长拦截、关闭子弹窗和单独保存', async ({ page }) => {
  const { saves, jobs } = await setup(page)
  let content = '连续画面，'.repeat(450) + '完整模板的最后一句。'
  await page.route('**/api/v1/library/items/template-1/versions/1/download', (route) =>
    route.fulfill({ contentType: 'text/plain', body: content }),
  )
  await page.getByRole('button', { name: '编辑分镜', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
  const prompt = dialog.getByRole('textbox', { name: '画面提示词' })
  await prompt.fill('')
  await dialog.getByRole('button', { name: '使用提示词模板' }).click()
  let picker = page.getByRole('dialog', { name: '选择提示词模板' })
  await picker.getByRole('button', { name: '插入模板' }).click()
  await expect(prompt).toHaveValue(content)
  content = '长'.repeat(5001)
  await dialog.getByRole('button', { name: '使用提示词模板' }).click()
  picker = page.getByRole('dialog', { name: '选择提示词模板' })
  await picker.getByRole('button', { name: '插入模板' }).click()
  await expect(picker.getByRole('alert')).toContainText('超过 5,000 字')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(prompt).toHaveValue('连续画面，'.repeat(450) + '完整模板的最后一句。')
  await dialog.getByRole('button', { name: '还原提示词' }).click()
  await expect(prompt).toHaveValue(originalPrompt)
  await dialog.getByRole('button', { name: '保存分镜', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(saves).toHaveLength(1)
  expect(jobs).toHaveLength(0)
})

for (const failure of ['saveFails', 'generateFails']) {
  test(`${failure} 保留编辑内容并允许重试`, async ({ page }) => {
    const { saves, jobs } = await setup(page, { [failure]: true })
    await page.getByRole('button', { name: '编辑分镜', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
    const prompt = dialog.getByRole('textbox', { name: '画面提示词' })
    await prompt.fill('失败后应保留的新提示词')
    await dialog.getByRole('button', { name: '保存并生成新版' }).click()
    await expect(dialog.getByRole('alert')).toContainText(
      failure === 'saveFails' ? '保存暂时失败' : '尚未创建生成任务',
    )
    await expect(prompt).toHaveValue('失败后应保留的新提示词')
    await expect(dialog.getByRole('button', { name: '保存并生成新版' })).toBeEnabled()
    expect(saves).toHaveLength(1)
    expect(jobs).toHaveLength(failure === 'saveFails' ? 0 : 1)
  })
}

test('提交期间禁止关闭、重复生成和修改', async ({ page }) => {
  let release
  const holdJob = new Promise((resolve) => {
    release = resolve
  })
  const { saves, jobs } = await setup(page, { holdJob })
  await page.getByRole('button', { name: '编辑分镜', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
  const generate = dialog.getByRole('button', { name: '保存并生成新版' })
  await generate.click()
  await expect.poll(() => jobs.length).toBe(1)
  await expect(generate).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '保存分镜', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('textbox', { name: '画面提示词' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  release()
  await expect(dialog).toHaveCount(0)
  expect(saves).toHaveLength(1)
  expect(jobs).toHaveLength(1)
})

test('再抽一次保留历史且生成期间锁定编辑', async ({ page }) => {
  let release
  const holdJob = new Promise((resolve) => {
    release = resolve
  })
  const { state, saves, jobs } = await setup(page, { holdJob })
  await page.getByRole('button', { name: '再抽一次', exact: true }).click()
  await expect.poll(() => jobs.length).toBe(1)
  await expect(page.getByRole('button', { name: '正在提交', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '编辑分镜', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('button', { name: '正在提交', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑分镜', exact: true })).toBeDisabled()
  expect(saves).toHaveLength(0)
  expect(jobs).toHaveLength(1)
  expect(state.tasks.map((task) => task.id)).toEqual(['new-video', 'old-video'])
})

test('模板读取和保存失败均可恢复且不提交分镜', async ({ page }) => {
  const { saves, jobs } = await setup(page)
  let listFails = true
  await page.route('**/api/v1/library/items?*', (route) =>
    listFails
      ? route.fulfill({ status: 503, json: { error: { message: '模板暂不可用' } } })
      : route.fallback(),
  )
  await page.route('**/api/v1/library/items', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { error: { message: '模板保存失败' } } })
      : route.fallback(),
  )
  await page.getByRole('button', { name: '编辑分镜', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑镜头', exact: true })
  await dialog.getByRole('button', { name: '使用提示词模板' }).click()
  const picker = page.getByRole('dialog', { name: '选择提示词模板' })
  await expect(picker.getByRole('alert')).toContainText('模板暂不可用')
  listFails = false
  await picker.getByRole('button', { name: '重试' }).click()
  await expect(picker.getByRole('button', { name: '插入模板' })).toBeVisible()
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: '存为提示词模板' }).click()
  const draft = page.getByRole('dialog', { name: '新建提示词模板' })
  await draft.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(draft.getByRole('alert')).toContainText('模板保存失败')
  await expect(draft.getByRole('textbox', { name: '提示词内容' })).toHaveValue(originalPrompt)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(saves).toHaveLength(0)
  expect(jobs).toHaveLength(0)
})
