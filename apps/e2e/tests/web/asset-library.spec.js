import { expect, test } from '@playwright/test'
import { mockWebApi } from '../fixtures.js'

test('资产库列表支持下载入口并可导入当前项目', async ({ page }) => {
  const state = await mockWebApi(page)

  await page.goto('/')
  await page.getByRole('button', { name: /资产库/ }).click()

  await expect(page.getByText('雨夜车站参考图')).toBeVisible()
  await expect(page.getByRole('link', { name: /下载/ })).toHaveAttribute(
    'href',
    '/api/v1/library/items/library-image-1/download',
  )
  await page.getByRole('button', { name: /导入当前项目/ }).click()

  await expect.poll(() => state.libraryImports.length).toBe(1)
  expect(state.libraryImports[0]).toEqual({ itemId: 'library-image-1', target: 'auto' })
  await expect(page.getByText('资产已导入当前项目')).toBeVisible()
})
