import { expect, test } from '@playwright/test'
import { mockWebApi, now } from '../fixtures.js'

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`creation entry and tools retain ideas at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await mockWebApi(page)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/agent/runs', (route) =>
      route.fulfill({
        json: [
          {
            id: 'older-run',
            status: 'completed',
            updatedAt: now,
            originalPrompt: '旧任务',
            plan: {
              projectName: '之前的作品',
              durationSeconds: 60,
              aspectRatio: '9:16',
              visualStyle: 'cinematic-cg',
              contentType: 'web-series',
            },
            stages: [],
            deliveries: [],
          },
        ],
      }),
    )
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '开始你的下一部作品' })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('home-dark.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '切换浅色模式' }).click()
    await page.screenshot({
      path: testInfo.outputPath('home-light.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('textbox', { name: '创作想法' }).fill('拍一部 60 秒的雨夜悬疑短剧')
    await page.getByRole('button', { name: '用这个想法开始创作' }).click()
    await expect(page.getByRole('textbox', { name: '创作要求' })).toHaveValue('拍一部 60 秒的雨夜悬疑短剧')
    await expect(page.getByRole('textbox', { name: '创作要求' })).toBeEnabled()
    await expect(page.getByRole('button', { name: /之前的作品/ })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('agent-light.png'),
      fullPage: true,
      animations: 'disabled',
    })
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: theme === 'dark' ? '切换深色模式' : '切换浅色模式' }).click()
      for (const label of ['生图大师', '剧本大师', '资产库']) {
        if (viewport.width < 600) await page.getByRole('button', { name: '打开导航' }).click()
        await page
          .getByRole('complementary')
          .first()
          .getByRole('button', { name: new RegExp(`^${label}`) })
          .click()
        await expect(page.locator('main h1')).toBeVisible()
        await expect(page.getByText('工作台暂时无法显示')).toHaveCount(0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        await page.screenshot({
          path: testInfo.outputPath(`${label}-${theme}.png`),
          fullPage: true,
          animations: 'disabled',
        })
      }
    }
    expect(errors).toEqual([])
  })
}
