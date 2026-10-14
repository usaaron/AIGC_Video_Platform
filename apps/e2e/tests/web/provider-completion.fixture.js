import { expect } from '@playwright/test'
import { createNavigationE2EState, generationTask, mockWebApi } from '../fixtures.js'

export const providerTaskId = 'provider-completion-e2e'
export const taskUpdatedAt = '2026-10-14T09:00:00.000Z'
export const syntheticStorageKey =
  'tenant-1/project-1/generated/provider-completion-e2e-private-storage-location.mp4'
const contractHash = 'b'.repeat(64)
const sha256 = 'c'.repeat(64)

function frozenContract(required) {
  const must = [
    { id: 'task-completed', source: 'system', statement: '任务必须已完成' },
    { id: 'media-url', source: 'system', statement: '必须存在可读取的视频媒体' },
  ]
  if (required)
    must.push({ id: 'provider-completed', source: 'provider', statement: '必须提供服务端完成回执' })
  return {
    version: 'seqora.delivery.v1',
    contractHash,
    intent: { mode: 'asset', projectId: 'project-1', episodeId: null, shotIds: [] },
    expectedArtifact: { type: 'video', count: 1 },
    must,
    frozenAt: taskUpdatedAt,
  }
}

function mediaProof(status) {
  return {
    status,
    reason: status === 'passed' ? 'verified' : status === 'failed' ? 'checksum-mismatch' : 'read-timeout',
    contentType: 'video/mp4',
    expectedSize: 24,
    actualSize: status === 'pending' ? null : 24,
    expectedSha256: sha256,
    actualSha256: status === 'passed' ? sha256 : status === 'failed' ? 'd'.repeat(64) : null,
  }
}

export async function openProviderCompletion(
  page,
  testInfo,
  {
    frozen = true,
    required = true,
    receipt = 'verified',
    currentMediaStatus = 'passed',
    stalePassedEvidence = false,
  } = {},
) {
  const state = createNavigationE2EState()
  const completionReceipt = {
    version: 'seqora.provider-completion.v1',
    attestation: 'server-observed-completion',
    tenantId: 'tenant-1',
    projectId: 'project-1',
    taskId: providerTaskId,
    provider: 'seedance',
    providerName: 'dora-router-seedance',
    providerTaskId: 'synthetic-upstream-task-14',
    attempts: 1,
    completedAt: taskUpdatedAt,
    mediaVersion: JSON.stringify([providerTaskId, syntheticStorageKey, null, null]),
    media: {
      view: 'single',
      storageKey: syntheticStorageKey,
      contentType: 'video/mp4',
      size: 24,
      sha256,
    },
  }
  const task = generationTask({
    id: providerTaskId,
    kind: 'video',
    provider: 'seedance',
    model: 'seedance-2.0',
    label: 'Provider 完成回执测试视频',
    resultUrl: '/test-media/provider-completion.mp4',
    updatedAt: taskUpdatedAt,
    metadata: {
      providerName: 'dora-router-seedance',
      providerState: 'completed',
      providerTaskId: completionReceipt.providerTaskId,
      ...(receipt === 'verified' ? { providerCompletionReceipt: completionReceipt } : {}),
      ...(frozen ? { deliveryContract: frozenContract(required) } : {}),
    },
  })
  state.tasks = [task]
  const writes = []
  const freezes = []
  const externalRequests = []
  const downloads = []
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
  await page.route(`**/api/v1/generation/tasks/${providerTaskId}/delivery-contract`, (route) => {
    expect(route.request().method()).toBe('POST')
    const body = route.request().postDataJSON()
    freezes.push(body)
    task.metadata.deliveryContract = { ...body.contract, contractHash, frozenAt: taskUpdatedAt }
    task.updatedAt = '2026-10-14T09:01:00.000Z'
    return route.fulfill({ json: task })
  })
  const passed = currentMediaStatus === 'passed' && (!required || receipt === 'verified')
  const failed = currentMediaStatus === 'failed'
  const verification = {
    status: passed ? 'satisfied' : failed ? 'failed' : 'pending',
    rationale: passed ? '当前交付证据已满足冻结要求' : '当前完成回执或媒体仍待核验',
    satisfiedRequirementIds: passed
      ? frozenContract(required).must.map((item) => item.id)
      : ['task-completed'],
    pendingRequirementIds: !passed && !failed ? ['provider-completed'] : [],
    failedRequirementIds: failed ? ['provider-completed', 'media-url'] : [],
    verifiedAt: taskUpdatedAt,
  }
  const scope = {
    tenantId: task.tenantId,
    projectId: task.projectId,
    taskId: task.id,
    taskUpdatedAt,
    mediaVersion: completionReceipt.mediaVersion,
  }
  await page.route(`**/api/v1/generation/tasks/${providerTaskId}/delivery-verification`, (route) =>
    route.fulfill({
      json: {
        taskId: providerTaskId,
        contract: task.metadata.deliveryContract,
        evidence: [
          {
            evidenceId: `${providerTaskId}:provider`,
            kind: 'provider',
            // The API downgrades provider evidence after checking current storage bytes.
            status:
              receipt === 'verified' ? (stalePassedEvidence ? 'passed' : currentMediaStatus) : 'observed',
            requirementIds: ['provider-accepted', 'provider-completed'],
            refType: 'provider-task',
            refId: providerTaskId,
            observedAt: taskUpdatedAt,
            scope,
            details: {
              provider: 'seedance',
              providerState: 'completed',
              completion: { reason: receipt, receipt: receipt === 'verified' ? completionReceipt : null },
              ...(currentMediaStatus !== 'passed'
                ? { currentMediaProof: mediaProof(currentMediaStatus) }
                : {}),
            },
          },
          {
            evidenceId: `${providerTaskId}:asset`,
            kind: 'asset',
            status: currentMediaStatus,
            requirementIds: ['media-url'],
            refType: 'generation-output',
            refId: providerTaskId,
            observedAt: taskUpdatedAt,
            scope,
            details: { storageProof: mediaProof(currentMediaStatus) },
          },
        ],
        verification,
      },
    }),
  )
  await page.route(`**/api/v1/generation/tasks/${providerTaskId}/delivery-gate`, (route) =>
    route.fulfill({
      json: {
        allowed: passed,
        status: passed ? 'allowed' : failed ? 'blocked' : 'pending',
        rationale: passed ? '正式交付门禁检查通过' : '当前完成回执或媒体仍待核验',
        reasonCodes: passed ? [] : ['DELIVERY_REQUIREMENTS_INCOMPLETE'],
        verifiedAt: taskUpdatedAt,
        verification,
      },
    }),
  )
  await page.goto('/?projectId=project-1')
  await expect(page.getByRole('heading', { name: '继续创作《E2E 短剧项目》', exact: true })).toBeVisible()
  if (page.viewportSize().width < 600)
    await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: '05 生成队列', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', 'generate')
  const name = frozen ? '查看交付核验' : '冻结交付合同'
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: frozen ? '交付核验' : name, exact: true })
  await expect(dialog).toBeVisible()
  if (frozen) await expect(dialog.getByRole('region', { name: '正式交付门禁' })).toBeVisible()
  return { dialog, writes, freezes, externalRequests, downloads }
}
