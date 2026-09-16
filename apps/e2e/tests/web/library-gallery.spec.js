import { expect, test } from '@playwright/test'
import { assetLibraryItem, createWebE2EState, mockWebApi } from '../fixtures.js'

test('大图预览、提示词收藏、编辑和回收站恢复形成闭环', async ({ page }) => {
  const state = await mockWebApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: '资产库', exact: true }).click()
  await page.getByRole('button', { name: '预览 雨夜车站参考图' }).click()
  const preview = page.getByRole('dialog')
  await expect(preview.getByRole('img', { name: '雨夜车站参考图' })).toBeVisible()
  await preview.getByRole('button', { name: '存为提示词模板' }).click()
  await expect(page.getByLabel('提示词内容')).toHaveValue('雨夜车站，电影感灯光')
  await page.getByLabel('模板名称').fill('夜景模板')
  await page.getByRole('button', { name: '保存模板', exact: true }).click()
  await page.getByRole('button', { name: '预览 夜景模板' }).click()
  await expect(preview).toContainText('雨夜车站，电影感灯光')
  await expect(preview.getByRole('button', { name: '导入当前项目' })).toHaveCount(0)
  await preview.getByRole('button', { name: '编辑模板' }).click()
  await page.getByLabel('提示词内容').fill('窗边柔光，人物近景')
  await page.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect.poll(() => state.libraryItems.at(-1).currentVersion).toBe(2)
  await page.getByRole('button', { name: '移入回收站 夜景模板' }).click()
  await expect(page.getByRole('button', { name: '预览 夜景模板' })).toHaveCount(0)
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await page.getByRole('button', { name: '预览 夜景模板' }).click()
  await expect(preview).toContainText('窗边柔光，人物近景')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '全部资产', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览 夜景模板' })).toBeVisible()
})

test('六类筛选先于分页，支持剧本全文和音频试听', async ({ page }) => {
  const items = Array.from({ length: 14 }, (_, i) =>
    assetLibraryItem({ id: `prop-${i}`, kind: i % 2 ? 'prop' : 'costume', title: `物品 ${i}` }),
  )
  items.push(
    assetLibraryItem({
      id: 'script-1',
      kind: 'script',
      title: '第一集',
      contentType: 'text/plain',
      sourceSnapshot: { contentPreview: '第一幕，清晨的车站。' },
    }),
  )
  items.push(assetLibraryItem({ id: 'audio-1', kind: 'audio', title: '雨声', contentType: 'audio/wav' }))
  await mockWebApi(page, createWebE2EState({ libraryItems: items }))
  await page.goto('/')
  await page.getByRole('button', { name: '资产库', exact: true }).click()
  const categories = page.getByRole('navigation', { name: '资产分类' })
  await expect(categories.getByRole('button')).toHaveCount(7)
  await categories.getByRole('button', { name: /^物品/ }).click()
  await expect(page.locator('.library-card')).toHaveCount(12)
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.locator('.library-card')).toHaveCount(2)
  await categories.getByRole('button', { name: /^剧本/ }).click()
  await page.getByRole('button', { name: '预览 第一集' }).click()
  await expect(page.getByRole('dialog')).toContainText('第一幕，清晨的车站。')
  await page.keyboard.press('Escape')
  await categories.getByRole('button', { name: /^音频/ }).click()
  await page.getByRole('button', { name: '预览 雨声' }).click()
  await expect(page.getByRole('dialog').locator('audio[controls]')).toBeVisible()
})

test('手机资产库与弹窗无横向溢出，筹备页不请求历史任务', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockWebApi(page)
  const agentRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/agent/')) agentRequests.push(request.url())
  })
  await page.goto('/')
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.getByRole('button', { name: '资产库', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览 雨夜车站参考图' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '预览 雨夜车站参考图' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const box = await page.getByRole('dialog').boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.getByRole('button', { name: '一句成片 筹备中', exact: true }).click()
  await expect(page.getByRole('region', { name: '一句成片筹备中' })).toBeVisible()
  await expect(page.getByText('制作任务', { exact: true })).toHaveCount(0)
  await expect(page.locator('textarea')).toHaveCount(0)
  await page.getByRole('button', { name: '前往项目创作' }).click()
  await expect(page.getByRole('heading', { name: '所有创作，一处管理' })).toBeVisible()
  expect(agentRequests).toEqual([])
})
