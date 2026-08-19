import { expect, test } from '@playwright/test'
import { mockAdminApi } from '../fixtures.js'

test('后台个人账号支持创建、改套餐和两次确认删除', async ({ page }) => {
  const state = await mockAdminApi(page)

  await page.goto('/?tab=personal-accounts')
  await expect(page.getByRole('heading', { name: '个人账号' }).first()).toBeVisible()

  await page.getByRole('button', { name: '直接创建账号' }).click()
  const createDialog = page.getByRole('dialog', { name: '直接创建个人账号' })
  await createDialog.getByLabel('邮箱').fill('created@example.com')
  await createDialog.getByLabel('姓名').fill('新建个人账号')
  await createDialog.getByLabel('初始临时密码').fill('Password123!')
  await createDialog.getByRole('button', { name: '直接创建个人账号' }).click()
  await page
    .locator('.modal')
    .filter({ hasText: '将直接创建账号并设置初始临时密码。' })
    .getByRole('button', { name: '创建账号' })
    .click()

  await expect.poll(() => state.createdUsers.length).toBe(1)
  expect(state.createdUsers[0]).toMatchObject({
    email: 'created@example.com',
    name: '新建个人账号',
    password: 'Password123!',
    role: 'member',
  })
  await expect(page.getByText('created@example.com')).toBeVisible()
  await page.getByRole('button', { name: '关闭下一步提示' }).click()

  const row = page.getByRole('row').filter({ hasText: 'created@example.com' })
  await row.getByRole('button', { name: /修改套餐，必要时发放会员积分/ }).click()
  const planDialog = page.getByRole('dialog', { name: '改套餐 / 冲会员' })
  await planDialog.getByLabel('目标套餐').selectOption('member')
  await planDialog.getByLabel('备注').fill('E2E 套餐测试')
  await planDialog.getByRole('button', { name: '保存套餐' }).click()
  await page
    .locator('.modal')
    .filter({ hasText: '请确认该套餐变更对应个人账号或指定 membership' })
    .getByRole('button', { name: '保存套餐' })
    .click()

  await expect.poll(() => state.planUpdates.length).toBe(1)
  expect(state.planUpdates[0]).toMatchObject({
    membershipId: 'membership-created',
    body: { plan: 'member', grantMonthlyCredits: true, reason: 'E2E 套餐测试' },
  })

  await row.locator('summary[aria-label="打开更多个人账号操作"]').click()
  await row.getByRole('button', { name: /删除账号，需要两次确认/ }).click()
  await page
    .locator('.modal')
    .filter({ hasText: '删除后该账号将无法登录' })
    .getByRole('button', { name: '继续删除' })
    .click()
  await page
    .locator('.modal')
    .filter({ hasText: '请再次确认这是要删除的目标账号。' })
    .getByRole('button', { name: '确认删除账号' })
    .click()

  await expect.poll(() => state.deletedUsers).toContain('user-created')
  await expect(row).toContainText('已删除')
})
