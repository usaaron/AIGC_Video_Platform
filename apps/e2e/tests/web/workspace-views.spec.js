import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { createWebE2EState, mockWebApi, now } from '../fixtures.js'

function workflowState() {
  const state = createWebE2EState()
  state.workspace.project.script =
    '场次：S01｜车站｜夜｜外景｜10秒\n林夏捡起地上的信封。\n林夏：这封信为什么在这里？'
  state.workspace.scriptEpisodes = [
    {
      id: 'episode-1',
      episodeNumber: 1,
      title: '第一集',
      content: state.workspace.project.script,
      status: 'saved',
      revision: 1,
      updatedAt: now,
    },
  ]
  state.workspace.assets = [
    {
      id: 'character-1',
      kind: 'character',
      name: '林夏',
      description: '青年女性，短发，深色外套',
      sourceMode: 'generate',
      status: 'confirmed',
      prompt: '林夏，青年女性',
      references: [],
      imageUrl: '/demo/room.jpg',
      attributes: {
        type: 'character',
        faceStatus: 'approved',
        faceReference: { id: 'face-1', name: '面部基准', url: '/demo/room.jpg' },
        appearanceVariants: [],
      },
    },
  ]
  state.workspace.shots = [
    {
      id: 'shot-1',
      order: 1,
      title: '发现信封',
      framing: '中景',
      duration: 10,
      prompt: '林夏捡起地上的信封。',
      continuityMode: 'independent',
      episodeNumber: 1,
      scriptEpisodeId: 'episode-1',
    },
  ]
  return state
}

async function prepare(page, state = workflowState()) {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /unique.*key|same key/.test(message.text())) errors.push(message.text())
  })
  await mockWebApi(page, state)
  await page.route('**/api/v1/organizations', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/auth/sessions', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/trusted-assets/configuration', (route) =>
    route.fulfill({ json: { virtualRegistrationReady: false, realValidationReady: false } }),
  )
  await page.route('**/validation-session/latest', (route) => route.fulfill({ json: null }))
  await page.goto('/')
  await page
    .getByRole('region', { name: '项目列表' })
    .getByRole('button', { name: /E2E 短剧项目/ })
    .click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return errors
}

async function navigate(page, label, mobile) {
  const stage = ['项目概览', '剧本', '资产设计', '分镜', '生成队列', '成片'].includes(label)
  if (!stage && mobile) await page.getByRole('button', { name: '打开导航' }).click()
  if (stage && !(await page.getByRole('navigation', { name: '创作流程' }).count())) {
    if (mobile) await page.getByRole('button', { name: '打开导航' }).click()
    await page
      .getByRole('complementary')
      .first()
      .getByRole('button', { name: /E2E 短剧项目/ })
      .click()
  }
  const container = stage
    ? page.getByRole('navigation', { name: '创作流程' })
    : page.getByRole('complementary').first()
  await container.getByRole('button', { name: new RegExp(label) }).click()
  await expect(page.locator('main h1')).toBeVisible()
  await expect(page.getByText('工作台暂时无法显示')).toHaveCount(0)
}

async function assertContained(page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const main = document.querySelector('main')
        return (
          document.documentElement.scrollWidth <= window.innerWidth + 1 &&
          (!main || main.scrollWidth <= main.clientWidth + 1)
        )
      }),
    )
    .toBe(true)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`all creative views remain usable in both themes at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    const errors = await prepare(page)
    const mobile = viewport.width < 600
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换浅色模式' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const view of [
        '项目概览',
        '剧本',
        '资产设计',
        '分镜',
        '生成队列',
        '成片',
        '积分账单',
        '账号中心',
      ]) {
        await navigate(page, view, mobile)
        await assertContained(page)
        await expect(page.getByText(/Unhandled E2E API route/)).toHaveCount(0)
        if (view === '分镜') {
          const shots = await page.locator('.shot-list').last().boundingBox()
          const nextAction = await page.locator('.storyboard-next-action').boundingBox()
          expect(nextAction.y).toBeGreaterThanOrEqual(shots.y + shots.height)
        }
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${view}.png`),
          fullPage: true,
          animations: 'disabled',
        })
      }
    }
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(errors).toEqual([])
  })
}

test('confirmed face enables full-body generation inside the asset editor', async ({ page }) => {
  const errors = await prepare(page)
  await navigate(page, '资产设计', false)
  await page.getByRole('button', { name: '编辑资产', exact: true }).click()
  await page.getByRole('button', { name: /全身定稿/ }).click()
  await expect(page.getByRole('button', { name: '生成全身候选', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})

test('whitelisted portrait preview retries through the authenticated proxy and opens the image', async ({
  page,
}) => {
  const state = workflowState()
  state.workspace.assets[0].attributes.subjectType = 'human'
  state.workspace.assets[0].attributes.trustedPortrait = {
    assetId: 'portrait-1',
    name: '林夏可信人像',
    status: 'active',
    groupType: 'AIGC',
    previewUrl: 'asset://portrait-1',
  }
  const errors = await prepare(page, state)
  let previewRequests = 0
  await page.route('**/api/v1/trusted-assets/portraits/portrait-1/preview*', (route) => {
    previewRequests += 1
    return previewRequests === 1
      ? route.fulfill({ status: 502, json: { error: { message: 'Temporary preview failure' } } })
      : route.fulfill({ path: fileURLToPath(new URL('../../../web/public/demo/room.jpg', import.meta.url)) })
  })
  await navigate(page, '资产设计', false)
  await page.getByRole('button', { name: '编辑资产', exact: true }).click()
  await page.getByRole('button', { name: '重新加载林夏可信人像的预览' }).click()
  const preview = page.getByRole('button', { name: '放大查看当前可信人像' })
  await expect.poll(() => preview.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await preview.click()
  await expect(page.getByRole('img', { name: '林夏可信人像', exact: true })).toBeVisible()
  expect(previewRequests).toBeGreaterThanOrEqual(2)
  expect(errors).toEqual([])
})
