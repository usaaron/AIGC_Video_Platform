import { expect, test } from '@playwright/test'
import { mockWebApi } from '../fixtures.js'

test('页面模拟路由移除后，后台 API 请求仍不能访问本地预览', async ({ page }) => {
  await mockWebApi(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '资产库', exact: true })).toBeVisible()
  await page.unroute('**/api/v1/**')

  const responses = await page.evaluate(async () => {
    return Promise.all(
      ['/api/v1/library/stats', '/api/v1/projects/project-1'].map(async (path) => {
        const response = await fetch(path)
        return { status: response.status, body: await response.json() }
      }),
    )
  })
  for (const response of responses) {
    expect(response).toMatchObject({ status: 503, body: { error: { code: 'E2E_API_UNMOCKED' } } })
  }
})
