import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  imageBytes,
  openImageCompletion,
  privateRequestId,
  privateStoragePrefix,
  taskId,
  updatedAt,
} from './image-provider-completion.fixture.js'

async function expectSafeDisplay(result) {
  expect(result.externalRequests).toEqual([])
  for (const secret of [
    privateRequestId,
    privateStoragePrefix,
    'requestId',
    'storageKey',
    'private-image-media-version',
  ])
    await expect(result.dialog).not.toContainText(secret)
  await expect
    .poll(() => result.dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
    .toBe(true)
}

for (const width of [1440, 390]) {
  test.describe(`Image2 完成回执 ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
    })

    test('新图片合同固定完成回执要求且仅承诺当前主图', async ({ page }, testInfo) => {
      const result = await openImageCompletion(page, testInfo, { frozen: false })
      const required = result.dialog.getByTestId('provider-completion-required')
      await expect(required).toBeChecked()
      await expect(required).toBeDisabled()
      await expect(result.dialog).toContainText('不会打包下载全部视图')
      await result.dialog.getByRole('button', { name: '确认冻结合同', exact: true }).click()
      await expect(result.dialog.getByRole('status')).toContainText('交付合同已冻结')
      expect(result.freezes).toHaveLength(1)
      expect(result.freezes[0]).toMatchObject({
        expectedUpdatedAt: updatedAt,
        contract: {
          contractHash: null,
          frozenAt: null,
          expectedArtifact: { type: 'image', count: 1 },
          must: expect.arrayContaining([expect.objectContaining({ id: 'provider-completed' })]),
        },
      })
      expect(result.writes).toEqual([`/api/v1/generation/tasks/${taskId}/delivery-contract`])
      expect(result.downloadRequests).toEqual([])
      await expectSafeDisplay(result)
    })

    test('展示三视图安全回执且正式下载仅取得一个主图文件', async ({ page }, testInfo) => {
      const result = await openImageCompletion(page, testInfo)
      const receipt = result.dialog.getByTestId('provider-completion-receipt')
      await expect(receipt).toHaveAttribute('data-status', 'passed')
      await expect(receipt).toContainText('TokenAdvent / Image2')
      await expect(receipt).toContainText('3 个')
      const outputs = receipt.getByRole('list', { name: '图片视图回执摘要' })
      await expect(outputs.getByRole('listitem')).toHaveCount(3)
      for (const label of ['正面', '侧面', '背面']) await expect(outputs).toContainText(label)
      await expect(receipt).toContainText('当前全部图片字节通过核验')
      await expect(receipt).toContainText('此回执不代表上游签名或内容质量验收')
      await expect(receipt).toContainText('正式下载仍仅包含当前主图（1 个图片文件）')
      await expectSafeDisplay(result)
      await receipt.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`image-provider-${width}.png`) })
      const downloadButton = result.dialog.getByRole('button', { name: '正式下载', exact: true })
      await downloadButton.scrollIntoViewIfNeeded()
      await expect(downloadButton).toBeInViewport({ ratio: 1 })
      const waiting = page.waitForEvent('download')
      await downloadButton.click()
      const download = await waiting
      expect(download.suggestedFilename()).toBe('image-provider-primary.png')
      const path = testInfo.outputPath('image-provider-primary.png')
      await download.saveAs(path)
      expect(await readFile(path)).toEqual(imageBytes)
      expect(result.downloads).toHaveLength(1)
      expect(result.downloadRequests).toHaveLength(1)
      expect(result.writes).toEqual([`/api/v1/generation/tasks/${taskId}/delivery-download`])
    })

    for (const mediaStatus of ['failed', 'pending']) {
      test(`主图通过但副视图${mediaStatus}时不显示完成且禁用下载`, async ({ page }, testInfo) => {
        const result = await openImageCompletion(page, testInfo, { mediaStatus })
        const receipt = result.dialog.getByTestId('provider-completion-receipt')
        await expect(receipt).toHaveAttribute('data-status', mediaStatus)
        await expect(receipt).not.toContainText('服务端完成回执已核验')
        await expect(receipt).toContainText(
          mediaStatus === 'failed' ? '当前图片输出核验失败' : '当前图片输出仍待核验',
        )
        await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
        expect(result.writes).toEqual([])
        expect(result.downloads).toEqual([])
        await expectSafeDisplay(result)
      })
    }

    test('历史图片缺回执仍待补且不信任任务metadata中的回执', async ({ page }, testInfo) => {
      const result = await openImageCompletion(page, testInfo, { receipt: false })
      const receipt = result.dialog.getByTestId('provider-completion-receipt')
      await expect(receipt).toContainText('待补')
      await expect(receipt).toContainText('不会自动补签')
      await expect(receipt).not.toContainText('服务端完成回执已核验')
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
      expect(result.writes).toEqual([])
      await expectSafeDisplay(result)
    })

    test('旧图片合同未纳入回执要求仍明确沿用服务器门禁', async ({ page }, testInfo) => {
      const result = await openImageCompletion(page, testInfo, { required: false, receipt: false })
      await expect(result.dialog.getByTestId('provider-completion-receipt')).toContainText(
        '此冻结合同未纳入 Provider 完成回执要求',
      )
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeEnabled()
      expect(result.writes).toEqual([])
      await expectSafeDisplay(result)
    })

    test('缺少全部视图当前证明时不把有效图片回执显示为通过', async ({ page }, testInfo) => {
      const result = await openImageCompletion(page, testInfo, { aggregate: false })
      await expect(result.dialog.getByTestId('provider-completion-receipt')).toHaveAttribute(
        'data-status',
        'pending',
      )
      await expect(result.dialog.getByTestId('provider-completion-receipt')).not.toContainText(
        '服务端完成回执已核验',
      )
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
      expect(result.writes).toEqual([])
      await expectSafeDisplay(result)
    })
  })
}
