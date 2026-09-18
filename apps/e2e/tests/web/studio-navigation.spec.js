import { expect, test } from '@playwright/test'
import { createWebE2EState, mockWebApi } from '../fixtures.js'

for (const width of [1440, 390]) {
  test(`新工作台引导、页面导航与支付预览 ${width}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const state = createWebE2EState()
    state.session.account.plan = 'free'
    state.billing.plan = 'free'
    const errors = []
    const writes = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      // Entering the library keeps its existing automatic Script Master sync.
      if (
        pathname.startsWith('/api/v1/') &&
        request.method() !== 'GET' &&
        pathname !== '/api/v1/library/sync-script-master'
      )
        writes.push(pathname)
    })
    await mockWebApi(page, state)
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    const create = page.getByRole('button', { name: '开始新创作', exact: true })
    await expect(create).toBeVisible()
    await expect(page.locator('.studio-particles')).toBeHidden()
    await create.click()
    await expect(page.getByRole('heading', { name: '从一个故事开始' })).toBeVisible()
    await expect(page.getByLabel('项目名称')).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()

    const guide = page.getByLabel('创作指引', { exact: true })
    await guide.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '跟着这五步，开始创作。' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: '跟着这五步，开始创作。' })).toBeHidden()
    await expect(guide).toBeFocused()
    await guide.click()
    await page.getByRole('button', { name: /定义角色与场景/ }).click()
    await expect(page.getByRole('heading', { name: '建立可复用的视觉资产' })).toBeVisible()

    const navigate = async (name) => {
      if (width === 390) await page.getByRole('button', { name: '打开导航', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
    }
    for (const [view, name] of [
      ['home', '项目库'],
      ['overview', '01 项目概览'],
      ['script', '02 剧本'],
      ['assets', '03 资产设计'],
      ['storyboard', '04 分镜'],
      ['generate', '05 生成队列'],
      ['film', '06 成片'],
      ['library', '资产库'],
      ['image-studio', '生图大师 已启用'],
      ['agent-studio', '一句成片 筹备中'],
      ['billing', '积分账单'],
      ['membership', '会员中心'],
      ['recharge', '积分充值'],
      ['settings', '项目设置'],
    ]) {
      await navigate(name)
      await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', view)
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${view}-${width}.png`), fullPage: true })
    }

    await navigate('积分充值')
    const pack = page.getByRole('radio', { name: '500 积分，45 元', exact: true })
    await page.locator('.recharge-pack').filter({ has: pack }).click()
    await expect(pack).toBeChecked()
    await page.getByRole('radio', { name: '支付宝', exact: true }).check()
    await page.getByRole('button', { name: '立即充值', exact: true }).click()
    const payment = page.getByRole('dialog', { name: '支付宝', exact: true })
    await expect(payment).toBeVisible()
    await expect(payment.getByText('充值 500 积分', { exact: true })).toBeVisible()
    await expect(payment.getByAltText('支付二维码占位图，不可用于付款')).toBeVisible()
    await payment.getByRole('button', { name: '我已支付', exact: true }).click()
    await expect(payment.getByText('真实支付尚未接入，本次未扣款，积分和会员权益未变动。')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`payment-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(payment).toHaveCount(0)
    await expect(page.getByRole('button', { name: '立即充值', exact: true })).toBeFocused()
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
