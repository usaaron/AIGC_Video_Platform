import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createNavigationE2EState, generationTask, mockWebApi, tinyImageDataUrl } from '../fixtures.js'

const taskId = 'delivery-download-e2e'
const contractHash = 'a'.repeat(64)
const evidenceUpdatedAt = '2026-10-14T08:00:00.000Z'
const receiptId = '6b11ac4e-5fbb-4eec-9bfd-3af341165709'
const imageBytes = Buffer.from(tinyImageDataUrl.split(',')[1], 'base64')

async function openDelivery(page, testInfo, { kind = 'video', gateStatus = 'allowed', stale = false } = {}) {
  const state = createNavigationE2EState()
  const task = generationTask({
    id: taskId,
    kind,
    label: '正式交付测试结果',
    resultUrl: kind === 'image' ? tinyImageDataUrl : '/test-media/delivery-preview.mp4',
    updatedAt: '2026-10-13T08:00:00.000Z',
    metadata: { deliveryContract: { contractHash, frozenAt: '2026-10-13T08:00:00.000Z' } },
  })
  state.tasks = [task]
  const requests = []
  const writes = []
  const externalRequests = []
  const downloads = []
  const checks = { snapshot: 0, gate: 0 }
  const current = { gateStatus, updatedAt: evidenceUpdatedAt, stale }
  const bytes = kind === 'image' ? imageBytes : Buffer.from('isolated synthetic video download fixture')
  const filename = kind === 'image' ? 'delivery-e2e.png' : 'delivery-e2e.mp4'
  const origin = new URL(testInfo.project.use.baseURL).origin
  await page.context().route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.fallback()
    externalRequests.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  page.on('download', (download) => downloads.push(download))
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/v1/') && request.method() !== 'GET') writes.push(path)
  })
  await mockWebApi(page, state)
  await page.route('**/test-media/*', (route) => route.fulfill({ status: 204 }))
  await page.route(`**/api/v1/generation/tasks/${taskId}/delivery-verification`, (route) => {
    checks.snapshot += 1
    const passed = current.gateStatus === 'allowed'
    return route.fulfill({
      json: {
        taskId,
        contract: task.metadata.deliveryContract,
        evidence: [
          {
            scope: {
              taskId,
              projectId: task.projectId,
              tenantId: task.tenantId,
              taskUpdatedAt: current.updatedAt,
            },
          },
        ],
        verification: {
          status: passed ? 'satisfied' : current.gateStatus === 'blocked' ? 'failed' : 'pending',
          rationale: passed ? '当前全部交付证据已通过' : '当前媒体证据尚未通过',
          satisfiedRequirementIds: passed ? ['task-completed', 'media-url'] : ['task-completed'],
          failedRequirementIds: current.gateStatus === 'blocked' ? ['media-url'] : [],
          pendingRequirementIds: current.gateStatus === 'pending' ? ['media-url'] : [],
        },
      },
    })
  })
  await page.route(`**/api/v1/generation/tasks/${taskId}/delivery-gate`, (route) => {
    checks.gate += 1
    return route.fulfill({
      json: {
        allowed: current.gateStatus === 'allowed',
        status: current.gateStatus,
        rationale: current.gateStatus === 'allowed' ? '正式交付门禁检查通过' : '主媒体仍待验证',
        reasonCodes: current.gateStatus === 'allowed' ? [] : ['MEDIA_NOT_READABLE'],
        verifiedAt: evidenceUpdatedAt,
      },
    })
  })
  await page.route(`**/api/v1/generation/tasks/${taskId}/delivery-download`, (route) => {
    expect(route.request().method()).toBe('POST')
    requests.push(route.request().postDataJSON())
    if (current.stale)
      return route.fulfill({
        status: 409,
        json: { error: { code: 'DELIVERY_DOWNLOAD_STALE', message: '任务已变化，请重新核验后下载' } },
      })
    return route.fulfill({
      headers: {
        'Content-Type': kind === 'image' ? 'image/png' : 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Delivery-Receipt-Id': receiptId,
        'X-Delivery-Sha256': createHash('sha256').update(bytes).digest('hex'),
      },
      body: bytes,
    })
  })
  await page.goto('/?projectId=project-1')
  await expect(page.getByRole('heading', { name: '继续创作《E2E 短剧项目》', exact: true })).toBeVisible()
  if (page.viewportSize().width < 600)
    await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: '05 生成队列', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', 'generate')
  await page.getByRole('button', { name: '查看交付核验', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '交付核验', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('region', { name: '正式交付门禁' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '正式下载', exact: true })).toBeInViewport()
  expect(checks).toEqual({ snapshot: 1, gate: 1 })
  expect(externalRequests).toEqual([])
  return { dialog, requests, writes, externalRequests, downloads, checks, current, bytes, filename }
}

for (const width of [1440, 390]) {
  test.describe(`正式交付下载 ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
    })

    for (const kind of ['video', 'image']) {
      test(`核验后下载实际 ${kind} 附件并显示回执`, async ({ page }, testInfo) => {
        const result = await openDelivery(page, testInfo, { kind })
        const button = result.dialog.getByRole('button', { name: '正式下载', exact: true })
        await expect(button).toBeEnabled()
        const waiting = page.waitForEvent('download')
        await button.click()
        const download = await waiting
        expect(download.suggestedFilename()).toBe(result.filename)
        const savedPath = testInfo.outputPath(result.filename)
        await download.saveAs(savedPath)
        expect(await readFile(savedPath)).toEqual(result.bytes)
        await expect(result.dialog.getByRole('status')).toHaveText(
          `服务器已核验并发送下载。回执 ID：${receiptId}`,
        )
        expect(result.requests).toEqual([
          { expectedUpdatedAt: evidenceUpdatedAt, contractHash, clientRequestId: expect.any(String) },
        ])
        expect(result.requests[0].clientRequestId).toMatch(/^[a-f0-9-]{36}$/)
        expect(result.writes).toEqual([`/api/v1/generation/tasks/${taskId}/delivery-download`])
        expect(result.externalRequests).toEqual([])
        await expect
          .poll(() => result.dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
          .toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`delivery-${kind}-${width}.png`) })
      })
    }

    for (const gateStatus of ['blocked', 'pending']) {
      test(`${gateStatus} 门禁禁用正式下载且不发请求`, async ({ page }, testInfo) => {
        const result = await openDelivery(page, testInfo, { gateStatus })
        await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
        await expect(result.dialog.getByText('当前交付证据尚未全部通过，暂不可正式下载。')).toBeVisible()
        await result.dialog.getByRole('button', { name: '关闭交付核验' }).click()
        await expect(result.dialog).toHaveCount(0)
        expect(result.requests).toEqual([])
        expect(result.writes).toEqual([])
        expect(result.downloads).toEqual([])
        expect(result.externalRequests).toEqual([])
      })
    }

    test('旧任务版本被服务器拒绝后必须重新核验', async ({ page }, testInfo) => {
      const result = await openDelivery(page, testInfo, { stale: true })
      await result.dialog.getByRole('button', { name: '正式下载', exact: true }).click()
      await expect(result.dialog.getByRole('alert')).toContainText('任务已变化，请重新核验后下载')
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
      expect(result.downloads).toEqual([])
      expect(result.requests).toHaveLength(1)
      result.current.updatedAt = '2026-10-14T08:01:00.000Z'
      result.current.gateStatus = 'blocked'
      await result.dialog.getByRole('button', { name: '重新核验', exact: true }).click()
      await expect(result.dialog.getByText('正式交付已被阻止', { exact: true })).toBeVisible()
      await expect(result.dialog.getByRole('alert')).toHaveCount(0)
      await expect(result.dialog.getByRole('button', { name: '正式下载', exact: true })).toBeDisabled()
      expect(result.checks).toEqual({ snapshot: 2, gate: 2 })
      expect(result.requests).toHaveLength(1)
      expect(result.downloads).toEqual([])
      expect(result.externalRequests).toEqual([])
    })
  })
}
