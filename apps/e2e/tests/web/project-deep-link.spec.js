import { expect, test } from '@playwright/test'
import { createNavigationE2EState, mockWebApi } from '../fixtures.js'

async function holdWorkspace(page, state, { fail = false } = {}) {
  let release
  let requested = false
  let replied = false
  const response = new Promise((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/projects/project-1', async (route) => {
    requested = true
    await response
    await route.fulfill(
      fail ? { status: 503, json: { error: { message: '测试工作区读取失败' } } } : { json: state.workspace },
    )
    replied = true
  })
  return { release, requested: () => requested, replied: () => replied }
}

for (const view of ['assets', 'storyboard']) {
  test(`项目深链接等待真实工作区后进入 ${view}`, async ({ page }) => {
    const state = createNavigationE2EState()
    state.workspace.project.script = ''
    if (view === 'assets') state.workspace.shots = []
    else state.workspace.assets = []
    await mockWebApi(page, state)
    const pending = await holdWorkspace(page, state)
    await page.goto(`/?projectId=project-1&view=${view}`)
    await expect.poll(pending.requested).toBe(true)
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', 'overview')
    await expect(page.locator('.toast')).toHaveCount(0)
    pending.release()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', view)
    await expect(
      page.getByRole('heading', {
        name: view === 'assets' ? '建立可复用的视觉资产' : '一眼看清整段影片',
        exact: true,
      }),
    ).toBeVisible()
  })
}

test('等待深链接时切换项目，旧响应不能打开新项目的受限页面', async ({ page }) => {
  const state = createNavigationE2EState()
  state.workspace.project.script = ''
  const secondProject = { ...state.workspace.project, id: 'project-2', name: '另一个空项目' }
  state.projects.push(secondProject)
  await mockWebApi(page, state)
  const pending = await holdWorkspace(page, state)
  await page.route('**/api/v1/projects/project-2', (route) =>
    route.fulfill({
      json: { project: secondProject, scriptEpisodes: [], assets: [], shots: [] },
    }),
  )
  await page.route('**/api/v1/projects/project-2/generation/tasks*', (route) => route.fulfill({ json: [] }))
  await page.goto('/?projectId=project-1&view=assets')
  await expect.poll(pending.requested).toBe(true)
  await page.getByRole('button', { name: state.workspace.project.name, exact: true }).click()
  await page
    .locator('.project-menu-list')
    .getByRole('button', { name: /另一个空项目/ })
    .click()
  await expect(page.getByRole('heading', { name: '继续创作《另一个空项目》', exact: true })).toBeVisible()
  pending.release()
  await expect.poll(pending.replied).toBe(true)
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', 'overview')
  await expect(page.getByRole('heading', { name: '继续创作《另一个空项目》', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '03 资产设计', exact: true })).toBeDisabled()
})

test('深链接工作区读取失败时保留错误，不能按项目摘要放行', async ({ page }) => {
  const state = createNavigationE2EState()
  await mockWebApi(page, state)
  const pending = await holdWorkspace(page, state, { fail: true })
  await page.goto('/?projectId=project-1&view=assets')
  await expect.poll(pending.requested).toBe(true)
  pending.release()
  await expect(page.getByRole('alert')).toContainText('测试工作区读取失败')
  await expect(page.getByRole('heading', { name: '建立可复用的视觉资产', exact: true })).toHaveCount(0)
})
