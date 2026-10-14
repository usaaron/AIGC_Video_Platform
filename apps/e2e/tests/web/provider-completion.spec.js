import { expect, test } from '@playwright/test'
import {
  openProviderCompletion,
  providerTaskId,
  syntheticStorageKey,
  taskUpdatedAt,
} from './provider-completion.fixture.js'

async function expectIsolatedRead(result) {
  expect(result.writes).toEqual([])
  expect(result.downloads).toEqual([])
  expect(result.externalRequests).toEqual([])
  await expect(result.dialog).not.toContainText(syntheticStorageKey)
  await expect(result.dialog).not.toContainText('storageKey')
  await expect
    .poll(() => result.dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
    .toBe(true)
}

for (const width of [1440, 390]) {
  test.describe(`Provider 完成回执 ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
    })

    test('新 Seedance 合同强制保留完成回执要求并实际提交', async ({ page }, testInfo) => {
      const result = await openProviderCompletion(page, testInfo, {
        frozen: false,
        receipt: 'missing-receipt',
      })
      const requirement = result.dialog.getByTestId('provider-completion-required')
      await expect(requirement).toBeChecked()
      await expect(requirement).toBeDisabled()
      await expect(result.dialog).toContainText('历史任务缺少可信完成回执时会保持待补')
      await result.dialog.getByRole('button', { name: '确认冻结合同', exact: true }).click()
      await expect(result.dialog.getByRole('status')).toContainText('交付合同已冻结')
      expect(result.freezes).toHaveLength(1)
      expect(result.freezes[0]).toMatchObject({
        expectedUpdatedAt: taskUpdatedAt,
        contract: {
          contractHash: null,
          frozenAt: null,
          must: expect.arrayContaining([
            expect.objectContaining({ id: 'provider-completed', source: 'provider' }),
          ]),
        },
      })
      expect(result.freezes[0].contract.must.filter((item) => item.id === 'provider-completed')).toHaveLength(
        1,
      )
      expect(result.writes).toEqual([`/api/v1/generation/tasks/${providerTaskId}/delivery-contract`])
      expect(result.downloads).toEqual([])
      expect(result.externalRequests).toEqual([])
    })

    test('历史任务缺回执显示待补且不能正式下载', async ({ page }, testInfo) => {
      const result = await openProviderCompletion(page, testInfo, { receipt: 'missing-receipt' })
      const receipt = result.dialog.getByTestId('provider-completion-receipt')
      await expect(receipt).toContainText('待补')
      await expect(receipt).not.toContainText('服务端完成回执已核验')
      await expect(receipt).toContainText('不会自动补签')
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
      await expectIsolatedRead(result)
    })

    test('旧冻结合同明确说明未纳入回执要求且不改写合同', async ({ page }, testInfo) => {
      const result = await openProviderCompletion(page, testInfo, {
        required: false,
        receipt: 'missing-receipt',
      })
      await expect(result.dialog.getByTestId('provider-completion-receipt')).toContainText(
        '此冻结合同未纳入 Provider 完成回执要求；回执信息仅供查看，整体交付以服务器门禁为准。',
      )
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeEnabled()
      expect(result.freezes).toEqual([])
      await expectIsolatedRead(result)
    })

    for (const currentMediaStatus of ['failed', 'pending']) {
      test(`已有回执遇到当前媒体 ${currentMediaStatus} 时不显示通过且不能下载`, async ({
        page,
      }, testInfo) => {
        const result = await openProviderCompletion(page, testInfo, { currentMediaStatus })
        const receipt = result.dialog.getByTestId('provider-completion-receipt')
        await expect(receipt).toHaveAttribute('data-status', currentMediaStatus)
        await expect(receipt).not.toContainText('服务端完成回执已核验')
        await expect(receipt).toContainText(
          currentMediaStatus === 'failed' ? '当前主视频媒体核验失败' : '当前主视频媒体仍待核验',
        )
        await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
        await expectIsolatedRead(result)
      })

      test(`异常通过状态与媒体 ${currentMediaStatus} 冲突时保守展示`, async ({ page }, testInfo) => {
        const result = await openProviderCompletion(page, testInfo, {
          currentMediaStatus,
          stalePassedEvidence: true,
        })
        const receipt = result.dialog.getByTestId('provider-completion-receipt')
        await expect(receipt).toHaveAttribute('data-status', currentMediaStatus)
        await expect(receipt).not.toContainText('服务端完成回执已核验')
        await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
        await expectIsolatedRead(result)
      })
    }

    test('通过回执说明服务端观察边界且不泄露存储键', async ({ page }, testInfo) => {
      const result = await openProviderCompletion(page, testInfo)
      const receipt = result.dialog.getByRole('region', { name: 'Provider 完成回执', exact: true })
      await expect(receipt).toHaveAttribute('data-status', 'passed')
      await expect(receipt).toContainText('服务端完成回执已核验')
      await expect(receipt).toContainText('服务端观察到 Provider 完成')
      await expect(receipt).toContainText('此回执不代表上游签名或内容质量验收')
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeEnabled()
      await expectIsolatedRead(result)
      await receipt.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`provider-completion-${width}.png`) })
    })
  })
}
