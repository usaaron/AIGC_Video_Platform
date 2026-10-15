import { expect, test } from '@playwright/test'
import { textCompletionSnapshotSchema } from '@seqora/contracts'
import { openTextCompletion, privateText, taskId } from './text-completion.fixture.js'

async function expectReadOnly(result) {
  expect(result.writes).toEqual([])
  expect(result.downloads).toEqual([])
  expect(result.externalRequests).toEqual([])
  await expect(result.dialog.getByRole('button', { name: /正式下载|发布|冻结合同/ })).toHaveCount(0)
  for (const text of [privateText, 'FORGED_METADATA_MODEL', 'private-client-request'])
    await expect(result.dialog).not.toContainText(text)
  await expect
    .poll(() => result.dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
    .toBe(true)
}

for (const width of [1440, 390]) {
  test.describe(`文本结果来源 ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
    })

    test('只读查看五类来源及空响应记录，支持键盘关闭和文本筛选', async ({ page }, testInfo) => {
      const result = await openTextCompletion(page, testInfo)
      await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
        'data-reason',
        'verified',
      )
      await expect(result.dialog).toContainText('当前可编辑剧本可能已变化')
      await expect(result.dialog).toContainText('不等于上游认证、内容质量验收或正式交付授权')
      for (const source of ['模型输出', '混合生成', '保留原文', '本地处理', '复用剧集'])
        await expect(result.dialog).toContainText(source)
      await result.dialog.getByText('查看 5 个结果单元与调用详情', { exact: true }).click()
      await result.dialog.getByText('查看 2 次调用记录', { exact: true }).click()
      await expect(result.dialog).toContainText('返回文本 0 字节')
      await expectReadOnly(result)
      await result.dialog.evaluate((node) => {
        node.scrollTop = 0
      })
      await page.screenshot({ path: testInfo.outputPath(`text-completion-${width}.png`) })
      const close = result.dialog.getByRole('button', { name: '关闭', exact: true })
      await close.focus()
      await page.keyboard.press('Shift+Tab')
      await expect(result.dialog.getByRole('button', { name: '重新核验', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(result.dialog).toHaveCount(0)
      await expect(result.trigger).toBeFocused()
      await page.getByRole('button', { name: '文本', exact: true }).click()
      await expect(result.trigger).toBeVisible()
      expect(result.queries).toHaveLength(1)
    })

    for (const [reason, status] of [
      ['task-not-completed', 'pending'],
      ['missing-receipt', 'pending'],
      ['invalid-receipt', 'failed'],
      ['receipt-mismatch', 'failed'],
    ]) {
      test(`${reason} 不显示可信详情或采信任务 metadata`, async ({ page }, testInfo) => {
        const result = await openTextCompletion(page, testInfo, { reason })
        const view = result.dialog.getByTestId('text-completion-receipt')
        await expect(view).toHaveAttribute('data-reason', reason)
        await expect(view).toHaveAttribute('data-status', status)
        await expect(result.dialog.getByTestId('text-completion-details')).toHaveCount(0)
        await expectReadOnly(result)
      })
    }

    for (const field of ['taskId', 'projectId', 'tenantId', 'taskUpdatedAt', 'taskStatus']) {
      test(`拒绝不匹配的 ${field} 查询响应`, async ({ page }, testInfo) => {
        const result = await openTextCompletion(page, testInfo, {
          transform: (snapshot) => {
            const mismatched =
              field === 'taskStatus'
                ? { ...snapshot, taskStatus: 'running', reason: 'task-not-completed', receipt: null }
                : {
                    ...snapshot,
                    [field]: field === 'taskUpdatedAt' ? '2026-10-15T04:01:00.000Z' : 'foreign-scope',
                    receipt:
                      field === 'taskUpdatedAt'
                        ? snapshot.receipt
                        : { ...snapshot.receipt, [field]: 'foreign-scope' },
                  }
            // The response is internally valid; only the current UI task
            // boundary can reject it. Do not accidentally test schema errors.
            return textCompletionSnapshotSchema.parse(mismatched)
          },
        })
        await expect(result.dialog.getByRole('alert')).toBeVisible()
        await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveCount(0)
        await expect(result.dialog.getByTestId('text-completion-details')).toHaveCount(0)
        await expectReadOnly(result)
      })
    }

    test('格式错误可重新核验且不回退任务 metadata', async ({ page }, testInfo) => {
      const result = await openTextCompletion(page, testInfo, {
        transform: (snapshot) => ({ ...snapshot, receipt: null }),
      })
      await expect(result.dialog.getByRole('alert')).toContainText('格式无效')
      await expect(result.dialog.getByTestId('text-completion-details')).toHaveCount(0)
      result.controls.transform = undefined
      await result.dialog.getByRole('button', { name: '重新核验', exact: true }).click()
      await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
        'data-reason',
        'verified',
      )
      expect(result.queries).toHaveLength(2)
      await expectReadOnly(result)
    })

    test('关闭后迟到响应不能重开弹窗', async ({ page }, testInfo) => {
      const result = await openTextCompletion(page, testInfo, { hold: true })
      await expect.poll(result.pendingCount).toBe(1)
      await result.dialog.getByRole('button', { name: '关闭', exact: true }).click()
      result.release()
      await expect.poll(() => result.replies.includes(1)).toBe(true)
      await expect(result.dialog).toHaveCount(0)
      await result.trigger.click()
      await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
        'data-reason',
        'verified',
      )
      expect(result.queries).toHaveLength(2)
      await expectReadOnly(result)
    })

    test('重新核验后忽略较早返回的成功结果', async ({ page }, testInfo) => {
      const result = await openTextCompletion(page, testInfo, { hold: true })
      await expect.poll(result.pendingCount).toBe(1)
      result.controls.reason = 'missing-receipt'
      await result.dialog.getByRole('button', { name: '重新核验', exact: true }).click()
      await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
        'data-reason',
        'missing-receipt',
      )
      result.release()
      await expect.poll(() => result.replies.includes(1)).toBe(true)
      await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
        'data-reason',
        'missing-receipt',
      )
      await expect(result.dialog.getByTestId('text-completion-details')).toHaveCount(0)
      await expectReadOnly(result)
    })

    test('运行任务版本更新会关闭旧来源查询', async ({ page }, testInfo) => {
      const result = await openTextCompletion(page, testInfo, { reason: 'task-not-completed', hold: true })
      await expect.poll(result.pendingCount).toBe(1)
      result.task.updatedAt = '2026-10-15T04:02:00.000Z'
      result.task.progress = 55
      await expect(result.dialog).toHaveCount(0)
      result.release()
      await expect.poll(() => result.replies.includes(1)).toBe(true)
      await result.trigger.click()
      await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
        'data-reason',
        'task-not-completed',
      )
      await expectReadOnly(result)
    })

    test('HTTP失败可恢复且不触发下载或写入', async ({ page }, testInfo) => {
      const result = await openTextCompletion(page, testInfo)
      await expect(result.dialog.getByTestId('text-completion-details')).toBeVisible()
      result.controls.status = 503
      await result.dialog.getByRole('button', { name: '重新核验', exact: true }).click()
      await expect(result.dialog.getByRole('alert')).toContainText('来源查询暂时失败')
      await expect(result.dialog.getByTestId('text-completion-details')).toHaveCount(0)
      result.controls.status = 200
      await result.dialog.getByRole('button', { name: '重新核验', exact: true }).click()
      await expect(result.dialog.getByTestId('text-completion-receipt')).toHaveAttribute(
        'data-reason',
        'verified',
      )
      expect(result.queries.every((url) => url.endsWith(`/generation/tasks/${taskId}/text-completion`))).toBe(
        true,
      )
      await expectReadOnly(result)
    })

    test('同页切换项目后迟到来源响应不能进入新项目', async ({ page }, testInfo) => {
      const result = await openTextCompletion(page, testInfo, { hold: true, secondProject: true })
      await expect.poll(result.pendingCount).toBe(1)
      const originalDocument = await page.locator('html').elementHandle()
      // Invoke the production switcher while the source modal is open, so
      // neither closing that modal nor destroying the document supplies the
      // cancellation that this project-boundary regression must prove.
      await page.locator('.project-switcher').evaluate((button) => button.click())
      await page
        .locator('.project-menu')
        .getByRole('button', { name: /来源隔离项目/ })
        .evaluate((button) => button.click())
      await expect(page.getByRole('heading', { name: '继续创作《来源隔离项目》', exact: true })).toBeVisible()
      // Loading another workspace replaces App's shell, but the browser
      // document and pending query must survive until production cancellation.
      expect(await originalDocument.evaluate((node) => node === document.documentElement)).toBe(true)
      result.release()
      await expect.poll(() => result.replies.includes(1)).toBe(true)
      await expect(result.dialog).toHaveCount(0)
      expect(result.writes).toEqual([])
      expect(result.downloads).toEqual([])
      expect(result.externalRequests).toEqual([])
    })
  })
}
