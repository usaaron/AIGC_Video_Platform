import { expect, test } from '@playwright/test'

async function mockAuth(page) {
  const requests = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/registration-code/request')) {
      requests.push({ path, body: route.request().postDataJSON() })
      return route.fulfill({ json: { resendAfterSeconds: 60 } })
    }
    if (path.endsWith('/auth/register')) {
      requests.push({ path, body: route.request().postDataJSON() })
      return route.fulfill({ status: 400, json: { error: { code: 'INVITATION_ACCOUNT_PASSWORD_INVALID' } } })
    }
    if (path.endsWith('/auth/password/reset-request')) {
      requests.push({ path, body: route.request().postDataJSON() })
      return route.fulfill({ json: {} })
    }
    return route.fulfill({ status: 401, json: { error: { code: 'INVALID_CREDENTIALS' } } })
  })
  return requests
}

test('cinematic login keeps images, theme, animation control and failure feedback usable', async ({
  page,
}, testInfo) => {
  await mockAuth(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: '序幕TV' })).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.auth-photo')
        .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 1000)),
    )
    .toBe(true)
  const photo = page.locator('.auth-photo-alpine')
  const initialTransform = await photo.evaluate((image) => getComputedStyle(image).transform)
  await expect
    .poll(() => photo.evaluate((image) => getComputedStyle(image).transform))
    .not.toBe(initialTransform)
  await page.getByRole('button', { name: '暂停背景动画' }).click()
  await expect(photo).toHaveCSS('animation-play-state', 'paused')
  await expect(page.getByRole('button', { name: '播放背景动画' })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: testInfo.outputPath('login-dark-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '切换浅色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.screenshot({ path: testInfo.outputPath('login-light-desktop.png'), fullPage: true })
  await page.getByLabel('邮箱', { exact: true }).fill('creator@example.com')
  await page.getByLabel('密码', { exact: true }).fill('WrongPassword123!')
  await page.getByRole('button', { name: '显示密码' }).click()
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: '进入工作台' }).click()
  await expect(page.getByRole('alert')).toHaveText('邮箱或密码错误')
})

test('mobile invitation registration remains scrollable through verification and account recovery', async ({
  page,
}, testInfo) => {
  const requests = await mockAuth(page)
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto('/register?token=12345678')
  await expect(page.getByLabel('邀请码', { exact: true })).toHaveValue('12345678')
  await page.getByLabel('邮箱', { exact: true }).fill('creator@example.com')
  await page.getByRole('button', { name: '发送邮箱验证码' }).click()
  await expect(page.getByRole('status')).toContainText('验证码已发送')
  await page.getByLabel('邮箱验证码', { exact: true }).fill('123456')
  await page.getByLabel('显示名称', { exact: true }).fill('演示创作者')
  await page.getByLabel('密码', { exact: true }).fill('ExamplePassword123!')
  const submit = page.getByRole('button', { name: '验证并创建账号' })
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('register-dark-mobile.png'), fullPage: true })
  await submit.click()
  expect(requests.at(-1).body).toEqual({
    token: '12345678',
    email: 'creator@example.com',
    name: '演示创作者',
    password: 'ExamplePassword123!',
    verificationCode: '123456',
  })
  await expect(page.getByRole('alert')).toContainText('原登录密码')
  await page.getByRole('button', { name: '重置已有账号密码' }).click()
  await page.getByRole('button', { name: '发送重置邮件' }).click()
  await expect(page.getByRole('status')).toContainText('密码重置邮件')
})

test('reduced motion leaves a static background and security pages use the quiet layout', async ({
  page,
}) => {
  await mockAuth(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  await expect(page.locator('.auth-photo-alpine')).toHaveCSS('animation-name', 'none')
  await expect(page.getByRole('button', { name: '暂停背景动画' })).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.goto('/reset-password')
  await expect(page.getByRole('heading', { name: '重置密码' })).toBeVisible()
  await expect(page.locator('.auth-cinematic-background')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '更新密码' })).toBeDisabled()
})
