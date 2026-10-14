import { expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createNavigationE2EState, generationTask, mockWebApi, tinyImageDataUrl } from '../fixtures.js'

export const taskId = 'image-provider-completion-e2e'
export const updatedAt = '2026-10-14T12:00:00.000Z'
export const privateRequestId = 'private-image-server-idempotency-key'
export const privateStoragePrefix = 'tenant-1/project-1/generated/image-provider-private-'
export const imageBytes = Buffer.from(tinyImageDataUrl.split(',')[1], 'base64')
const sha256 = createHash('sha256').update(imageBytes).digest('hex')
const contractHash = 'c'.repeat(64)
const views = ['front', 'side', 'back']
const requirements = [
  { id: 'task-completed', source: 'system', statement: '任务必须已完成' },
  { id: 'media-url', source: 'provider', statement: '当前主图可读' },
  { id: 'provider-completed', source: 'provider', statement: '所有图片输出拥有可信完成回执' },
]

function contract(required) {
  return {
    version: 'seqora.delivery.v1',
    contractHash,
    frozenAt: updatedAt,
    intent: { mode: 'asset', projectId: 'project-1', episodeId: null, shotIds: [] },
    expectedArtifact: { type: 'image', count: 1 },
    must: required ? requirements : requirements.slice(0, 2),
  }
}

function storageProof(status) {
  return {
    status,
    reason: status === 'passed' ? 'verified' : status === 'failed' ? 'checksum-mismatch' : 'read-timeout',
    contentType: 'image/png',
    expectedSize: imageBytes.length,
    actualSize: status === 'pending' ? null : imageBytes.length,
    expectedSha256: sha256,
    actualSha256: status === 'passed' ? sha256 : status === 'failed' ? 'd'.repeat(64) : null,
  }
}

export async function openImageCompletion(
  page,
  testInfo,
  { frozen = true, required = true, receipt = true, mediaStatus = 'passed', aggregate = true } = {},
) {
  const state = createNavigationE2EState()
  const completionReceipt = {
    version: 'seqora.provider-image-completion.v1',
    attestation: 'server-observed-completion',
    tenantId: 'tenant-1',
    projectId: 'project-1',
    taskId,
    provider: 'img2',
    providerName: 'tokenadvent-img2',
    requestId: privateRequestId,
    attempts: 1,
    completedAt: updatedAt,
    mediaVersion: 'private-image-media-version',
    outputs: views.map((view) => ({
      view,
      storageKey: `${privateStoragePrefix}${view}.png`,
      contentType: 'image/png',
      size: imageBytes.length,
      sha256,
    })),
  }
  const task = generationTask({
    id: taskId,
    kind: 'image',
    provider: 'img2',
    model: 'seqora-image2',
    label: 'Image2 完成回执测试图片',
    resultUrl: tinyImageDataUrl,
    updatedAt,
    outputs: views.map((view) => ({
      id: `${taskId}-${view}`,
      view,
      url: tinyImageDataUrl,
      mediaType: 'image',
    })),
    metadata: {
      providerName: 'tokenadvent-img2',
      providerState: 'completed',
      providerCompletionReceipt: completionReceipt,
      ...(frozen ? { deliveryContract: contract(required) } : {}),
    },
  })
  state.tasks = [task]
  const writes = [],
    freezes = [],
    downloadRequests = [],
    downloads = [],
    externalRequests = []
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
  await page.route(`**/api/v1/generation/tasks/${taskId}/delivery-contract`, (route) => {
    expect(route.request().method()).toBe('POST')
    const body = route.request().postDataJSON()
    freezes.push(body)
    task.metadata.deliveryContract = { ...body.contract, contractHash, frozenAt: updatedAt }
    task.updatedAt = '2026-10-14T12:01:00.000Z'
    return route.fulfill({ json: task })
  })
  const passed = mediaStatus === 'passed' && (!required || (receipt && aggregate))
  const failed = mediaStatus === 'failed'
  const verification = {
    status: passed ? 'satisfied' : failed ? 'failed' : 'pending',
    rationale: passed ? '当前图片交付证据已通过' : '当前图片输出或回执尚未通过',
    satisfiedRequirementIds: passed
      ? contract(required).must.map((item) => item.id)
      : ['task-completed', 'media-url'],
    pendingRequirementIds: !passed && !failed ? ['provider-completed'] : [],
    failedRequirementIds: failed ? ['provider-completed'] : [],
    verifiedAt: updatedAt,
  }
  const scope = {
    taskId,
    tenantId: 'tenant-1',
    projectId: 'project-1',
    taskUpdatedAt: updatedAt,
    mediaVersion: completionReceipt.mediaVersion,
  }
  const proof = {
    status: mediaStatus,
    reason: mediaStatus === 'passed' ? 'verified' : failed ? 'output-failed' : 'output-pending',
    expectedOutputCount: 3,
    verifiedOutputCount: mediaStatus === 'passed' ? 3 : 2,
    outputs: views.map((view) => ({
      view,
      storageProof: storageProof(view === 'back' ? mediaStatus : 'passed'),
    })),
  }
  await page.route(`**/api/v1/generation/tasks/${taskId}/delivery-verification`, (route) =>
    route.fulfill({
      json: {
        taskId,
        contract: task.metadata.deliveryContract,
        verification,
        evidence: [
          {
            evidenceId: `${taskId}:provider`,
            kind: 'provider',
            status: receipt ? mediaStatus : 'observed',
            requirementIds: ['provider-accepted', 'provider-completed'],
            refType: 'provider-task',
            refId: taskId,
            observedAt: updatedAt,
            scope,
            details: {
              provider: 'img2',
              providerState: 'completed',
              completion: {
                reason: receipt ? 'verified' : 'missing-receipt',
                receipt: receipt ? completionReceipt : null,
              },
              ...(receipt && aggregate ? { currentMediaProof: proof } : {}),
            },
          },
          {
            evidenceId: `${taskId}:asset`,
            kind: 'asset',
            status: 'passed',
            requirementIds: ['media-url'],
            refType: 'generation-output',
            refId: taskId,
            observedAt: updatedAt,
            scope,
            details: { storageProof: storageProof('passed') },
          },
        ],
      },
    }),
  )
  await page.route(`**/api/v1/generation/tasks/${taskId}/delivery-gate`, (route) =>
    route.fulfill({
      json: {
        allowed: passed,
        status: passed ? 'allowed' : failed ? 'blocked' : 'pending',
        rationale: passed ? '正式交付门禁检查通过' : '当前图片输出仍需完整核验',
        reasonCodes: passed ? [] : ['DELIVERY_REQUIREMENTS_INCOMPLETE'],
        verifiedAt: updatedAt,
        verification,
      },
    }),
  )
  await page.route(`**/api/v1/generation/tasks/${taskId}/delivery-download`, (route) => {
    expect(route.request().method()).toBe('POST')
    downloadRequests.push(route.request().postDataJSON())
    return route.fulfill({
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename=image-provider-primary.png',
        'X-Delivery-Receipt-Id': '6b11ac4e-5fbb-4eec-9bfd-3af341165710',
        'X-Delivery-Sha256': sha256,
      },
      body: imageBytes,
    })
  })
  await page.goto('/?projectId=project-1')
  await expect(page.getByRole('heading', { name: '继续创作《E2E 短剧项目》', exact: true })).toBeVisible()
  if (page.viewportSize().width < 600)
    await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: '05 生成队列', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', 'generate')
  await page.getByRole('button', { name: frozen ? '查看交付核验' : '冻结交付合同', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: frozen ? '交付核验' : '冻结交付合同', exact: true })
  await expect(dialog).toBeVisible()
  if (frozen) await expect(dialog.getByRole('region', { name: '正式交付门禁' })).toBeVisible()
  return { dialog, writes, freezes, downloadRequests, downloads, externalRequests }
}
