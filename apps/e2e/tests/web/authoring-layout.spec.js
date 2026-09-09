import { expect, test } from '@playwright/test'
import { createWebE2EState, mockWebApi } from '../fixtures.js'

async function openAuthoring(page, viewport) {
  await page.setViewportSize(viewport)
  const state = createWebE2EState()
  state.workspace.project.contentType = 'animation'
  state.workspace.project.script =
    '场次：S01｜车站｜夜｜外景｜10秒\n林夏打开铁盒，发现一张照片。\n林夏：这不是明天的车票吗？\n\n场次：S02｜站台｜夜｜外景｜12秒\n她冲向站台，发现相片中的人正走向铁轨。'.repeat(
      4,
    )
  state.health.providers.text = 'configured'
  state.workspace.assets = [
    {
      id: 'character-1',
      kind: 'character',
      name: '林夏',
      description: '27岁，短发，深色风衣',
      sourceMode: 'generate',
      status: 'draft',
      prompt: '短发青年女性，深色风衣',
      references: [],
      imageUrl: '/demo/room.jpg',
      attributes: {
        type: 'character',
        subjectType: 'human',
        faceStatus: 'approved',
        faceReference: { id: 'face-1', url: '/demo/room.jpg', name: '林夏面部' },
        bodyStatus: 'pending',
        appearanceVariants: [],
      },
    },
  ]
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockWebApi(page, state)
  await page.route('**/api/v1/trusted-assets/configuration', (route) =>
    route.fulfill({ json: { virtualRegistrationReady: false, realValidationReady: false } }),
  )
  await page.route('**/validation-session/latest', (route) => route.fulfill({ json: null }))
  await page.route('**/script/asset-suggestions', (route) =>
    route.fulfill({ json: { summary: '当前资产已齐备', assets: [] } }),
  )
  await page.goto('/')
  await page
    .getByRole('region', { name: '项目列表' })
    .getByRole('button', { name: /E2E 短剧项目/ })
    .click()
  return errors
}

async function expectStageNavigationClear(editor) {
  const overlap = await editor.evaluate((element) => {
    const navigation = element.querySelector('.character-stage-nav').getBoundingClientRect()
    const preview = element.querySelector('.character-stage-preview').getBoundingClientRect()
    const width = Math.max(
      0,
      Math.min(navigation.right, preview.right) - Math.max(navigation.left, preview.left),
    )
    const height = Math.max(
      0,
      Math.min(navigation.bottom, preview.bottom) - Math.max(navigation.top, preview.top),
    )
    return width * height
  })
  expect(overlap, 'Character stage navigation must not cover the image preview while scrolling').toBe(0)
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`authoring and asset controls remain accessible at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors = await openAuthoring(page, viewport)
    const navigation = page.getByRole('navigation', { name: '创作流程' })
    await navigation.getByRole('button', { name: /剧本$/ }).click()
    await expect(page.getByRole('textbox', { name: '短片剧本', exact: true })).toBeVisible()
    const continuationDuration = page.getByLabel('续写时长（秒）')
    await continuationDuration.fill('1')
    await continuationDuration.blur()
    await expect(continuationDuration).toHaveValue('10')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`script-${viewport.width}-dark.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await navigation.getByRole('button', { name: /资产设计$/ }).click()
    await expect(page.getByRole('tab', { name: /人物/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByLabel('搜索人物').fill('没有的名字')
    await expect(page.getByRole('button', { name: '清除搜索' })).toBeVisible()
    await page.getByRole('button', { name: '清除搜索' }).click()
    await page.getByRole('button', { name: '编辑资产', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '林夏', exact: true })
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('button', { name: '生成全身候选', exact: true })).toBeEnabled()
    await expect(editor.locator('.prompt-workbench')).toBeHidden()
    await editor.getByRole('button', { name: '提示词', exact: true }).click()
    await expect(editor.locator('.compiled-prompt textarea')).toBeVisible()
    await editor.getByRole('button', { name: '自行编辑', exact: true }).click()
    await expect(editor.locator('.compiled-prompt textarea')).toBeEditable()
    await editor.getByRole('button', { name: '制作', exact: true }).click()
    await expectStageNavigationClear(editor)
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await editor.getByRole('button', { name: '生成全身候选', exact: true }).scrollIntoViewIfNeeded()
    await expect(editor.getByRole('button', { name: '生成全身候选', exact: true })).toBeInViewport()
    await expect(editor.getByRole('button', { name: '保存资产', exact: true })).toBeInViewport()
    await expect(editor.getByRole('button', { name: '删除资产', exact: true })).toBeVisible()
    await expectStageNavigationClear(editor)
    await page.screenshot({
      path: testInfo.outputPath(`asset-editor-${viewport.width}-dark.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await editor.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '切换浅色模式' }).click()
    await page.screenshot({
      path: testInfo.outputPath(`assets-${viewport.width}-light.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '编辑资产', exact: true }).click()
    await expect(editor.getByRole('button', { name: '生成全身候选', exact: true })).toBeEnabled()
    await editor.getByRole('button', { name: '生成全身候选', exact: true }).scrollIntoViewIfNeeded()
    await expectStageNavigationClear(editor)
    await page.screenshot({
      path: testInfo.outputPath(`asset-editor-${viewport.width}-light.png`),
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  })
}
