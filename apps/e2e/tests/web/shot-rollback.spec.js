import { expect, test } from '@playwright/test'
import { createWebE2EState, generationTask, mockWebApi } from '../fixtures.js'

async function setup(
  page,
  { count = 3, active = false, fail = false, hold, referenceSnapshots = false } = {},
) {
  const state = createWebE2EState()
  const shot = {
    id: 'shot-1',
    projectId: 'project-1',
    order: 1,
    title: '诊所重逢',
    framing: '中景',
    prompt: '当前正在修改的提示词',
    duration: 5,
    episodeNumber: 1,
    episodeTitle: '归来',
    episodeKind: 'standard',
    continuityMode: 'independent',
    imageUrl: null,
    ...(referenceSnapshots ? { referenceImages: [{ url: '/api/v1/media/current-image' }] } : {}),
    selectedVideoTaskId: `video-${count}`,
  }
  state.workspace.shots = [shot]
  state.tasks = Array.from({ length: count }, (_, index) =>
    generationTask({
      id: `video-${index + 1}`,
      kind: 'video',
      provider: 'seedance',
      createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
      updatedAt: `2026-09-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
      resultUrl: `/test-videos/version-${index + 1}.mp4`,
      metadata: {
        shotId: shot.id,
        resolution: '720p',
        sourcePromptSnapshot: `第 ${index + 1} 版的原始提示词`,
        ...(referenceSnapshots
          ? {
              sourceShotSnapshot: {
                prompt: `第 ${index + 1} 版使用【图1】`,
                referenceImages: [{ url: `/api/v1/media/version-${index + 1}`, name: '此版参考图' }],
              },
            }
          : {}),
      },
    }),
  ).reverse()
  if (active)
    state.tasks.unshift(
      generationTask({ id: 'active', kind: 'video', status: 'running', metadata: { shotId: shot.id } }),
    )
  await mockWebApi(page, state)
  // The suite checks version selection, not provider media playback.
  await page.route('**/test-videos/*', (route) => route.fulfill({ status: 204 }))
  const changes = []
  let generationCount = 0
  await page.route('**/api/v1/generation/tasks', (route) => {
    if (route.request().method() === 'POST') generationCount++
    return route.fallback()
  })
  await page.route('**/api/v1/projects/project-1/shots/shot-1', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const input = route.request().postDataJSON()
    changes.push(input)
    if (hold) await hold
    if (fail) return route.fulfill({ status: 500, json: { error: { message: '版本切换失败，请重试' } } })
    Object.assign(shot, input)
    await route.fulfill({ json: shot })
  })
  await page.goto('/?projectId=project-1&view=storyboard')
  await expect(page.getByRole('button', { name: '回退到上一版本', exact: true })).toBeVisible()
  return { shot, state, changes, generationCount: () => generationCount }
}

for (const width of [1440, 390]) {
  test(`上一版逐次回退、刷新保留、可切回最新 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    const { shot, changes, generationCount } = await setup(page)
    const rollback = page.getByRole('button', { name: '回退到上一版本', exact: true })
    expect((await rollback.boundingBox()).height).toBeGreaterThanOrEqual(42)
    await rollback.click()
    let dialog = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
    await expect(dialog.getByRole('region', { name: '当前使用', exact: true })).toContainText('V3')
    await expect(dialog.getByRole('region', { name: '将恢复的上一版', exact: true })).toContainText('V2')
    await expect(dialog.getByText('回退免费，不会重新生成视频')).toBeVisible()
    await expect(dialog.getByText('设为当前成片', { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '确认回退到上一版本', exact: true })).toBeInViewport()
    const confirmBox = await dialog
      .getByRole('button', { name: '确认回退到上一版本', exact: true })
      .boundingBox()
    const dialogBox = await dialog.boundingBox()
    expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height)
    await page.screenshot({ path: testInfo.outputPath(`rollback-${width}.png`) })
    await expect.poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    expect(changes).toHaveLength(0)
    await dialog.getByRole('button', { name: '确认回退到上一版本', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.shot-current-version')).toHaveText('当前使用 V2')
    await expect(page.locator('.shot-thumb video')).toHaveAttribute('src', '/test-videos/version-2.mp4')
    expect(changes).toEqual([{ selectedVideoTaskId: 'video-2' }])
    expect(shot.prompt).toBe('当前正在修改的提示词')
    await expect(page.getByText('已回退到上一版本，当前使用 V2', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.locator('.shot-current-version')).toHaveText('当前使用 V2')
    await rollback.click()
    dialog = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
    await expect(dialog.getByRole('region', { name: '将恢复的上一版', exact: true })).toContainText('V1')
    await dialog.getByRole('button', { name: '确认回退到上一版本', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(rollback).toBeDisabled()
    await page.getByRole('button', { name: '查看版本', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
    await expect(dialog.getByText('暂无上一版本')).toBeVisible()
    await dialog.getByRole('button', { name: '切回最新版本 V3', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.shot-current-version')).toHaveText('当前使用 V3')
    expect(changes.map((input) => input.selectedVideoTaskId)).toEqual(['video-2', 'video-1', 'video-3'])
    expect(generationCount()).toBe(0)
  })
}

test('取消不改变版本；沿用历史提示词编辑不会隐式回退', async ({ page }) => {
  const { shot, changes } = await setup(page)
  await page.getByRole('button', { name: '回退到上一版本', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(changes).toHaveLength(0)
  await page.getByRole('button', { name: '查看版本', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
  await dialog
    .getByRole('region', { name: '将恢复的上一版', exact: true })
    .getByRole('button', { name: '用此版提示词编辑' })
    .click()
  await expect(dialog).toHaveCount(0)
  const editor = page.getByRole('dialog', { name: '编辑镜头', exact: true })
  await expect(editor.getByRole('textbox', { name: '画面提示词' })).toHaveValue('第 2 版的原始提示词')
  expect(shot.selectedVideoTaskId).toBe('video-3')
  expect(changes).toHaveLength(0)
})

test('只有一版和正在生成时给出明确禁用状态', async ({ page }) => {
  await setup(page, { count: 1, active: true })
  await expect(page.getByRole('button', { name: '回退到上一版本', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '查看版本', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
  await expect(dialog.getByText('暂无上一版本')).toBeVisible()
  await expect(dialog.getByText('当前批次仍在生成，完成后才能切换版本。')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '确认回退到上一版本', exact: true })).toBeDisabled()
})

test('请求期间锁定操作，失败保留预览且允许重试', async ({ page }) => {
  let release
  const hold = new Promise((resolve) => {
    release = resolve
  })
  const { shot, changes, generationCount } = await setup(page, { fail: true, hold })
  await page.getByRole('button', { name: '回退到上一版本', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
  await dialog.getByRole('button', { name: '确认回退到上一版本', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '正在回退…', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  release()
  await expect(dialog.getByRole('alert')).toContainText('版本切换失败')
  await expect(dialog.getByRole('button', { name: '确认回退到上一版本', exact: true })).toBeEnabled()
  expect(shot.selectedVideoTaskId).toBe('video-3')
  expect(changes).toHaveLength(1)
  expect(generationCount()).toBe(0)
})

test('复用历史提示词时一并载入此版参考图，保存前不改变当前镜头', async ({ page }) => {
  const { shot, changes } = await setup(page, { referenceSnapshots: true })
  await page.getByRole('button', { name: '查看版本', exact: true }).click()
  const history = page.getByRole('dialog', { name: '回退到上一版本', exact: true })
  await history
    .getByRole('region', { name: '将恢复的上一版', exact: true })
    .getByRole('button', { name: '用此版提示词编辑' })
    .click()
  const editor = page.getByRole('dialog', { name: '编辑镜头', exact: true })
  await expect(editor.getByRole('textbox', { name: '画面提示词' })).toHaveValue('第 2 版使用【图1】')
  await expect(editor.getByRole('img', { name: '镜头参考', exact: true })).toHaveAttribute(
    'src',
    '/api/v1/media/version-2',
  )
  expect(changes).toHaveLength(0)
  expect(shot.referenceImages[0].url).toBe('/api/v1/media/current-image')
  await editor.getByRole('button', { name: '保存分镜', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(changes[0].referenceImages).toEqual([{ url: '/api/v1/media/version-2', name: '此版参考图' }])
  expect(shot.selectedVideoTaskId).toBe('video-3')
})
