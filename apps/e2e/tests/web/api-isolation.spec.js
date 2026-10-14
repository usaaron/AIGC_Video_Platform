import { expect, test } from '@playwright/test'
import { mockWebApi } from '../fixtures.js'

test('测试 Web 服务拒绝绕过浏览器模拟的 API 读写请求', async ({ request }) => {
  const pageResponse = await request.get('/')
  expect(pageResponse.status()).toBe(200)
  expect(pageResponse.headers()['content-type']).toContain('text/html')

  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const response = await request.fetch('/api/v1/projects', { method })
    expect(response.status()).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'E2E_API_UNMOCKED',
        message: 'API requests must be handled by an E2E fixture.',
      },
    })
  }
})

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
