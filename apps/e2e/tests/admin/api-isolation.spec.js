import { expect, test } from '@playwright/test'

test('测试 Admin 服务拒绝绕过浏览器模拟的 API 读写请求', async ({ request }) => {
  const pageResponse = await request.get('/')
  expect(pageResponse.status()).toBe(200)
  expect(pageResponse.headers()['content-type']).toContain('text/html')

  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const response = await request.fetch('/api/v1/admin/users', { method })
    expect(response.status()).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'E2E_API_UNMOCKED',
        message: 'API requests must be handled by an E2E fixture.',
      },
    })
  }
})
