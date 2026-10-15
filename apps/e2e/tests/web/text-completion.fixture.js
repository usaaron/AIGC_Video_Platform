import { expect } from '@playwright/test'
import { createNavigationE2EState, generationTask, mockWebApi } from '../fixtures.js'

export const taskId = 'text-completion-e2e'
export const updatedAt = '2026-10-15T04:00:00.000Z'
export const privateText = 'PRIVATE_TEXT_MUST_NOT_APPEAR_IN_SOURCE_DIALOG'
const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export function completionSnapshot(task, reason = 'verified') {
  const call = (sequence, bytes = 28) => ({
    sequence,
    model: 'seqora-5.6',
    stage: 'draft',
    observation: 'adapter-returned',
    responseBytes: bytes,
    responseSha256: bytes ? 'a'.repeat(64) : emptySha256,
  })
  const sources = ['provider-derived', 'mixed', 'retained-input', 'local-derived', 'reused-episode']
  return {
    version: 'seqora.text-completion-query.v1',
    taskId: task.id,
    projectId: task.projectId,
    tenantId: task.tenantId,
    taskUpdatedAt: task.updatedAt,
    checkedAt: updatedAt,
    taskStatus: task.status,
    reason,
    receipt:
      reason === 'verified'
        ? {
            version: 'seqora.text-completion.v1',
            attestation: 'server-observed-text-result',
            taskId: task.id,
            projectId: task.projectId,
            tenantId: task.tenantId,
            userId: 'user-1',
            clientRequestId: 'private-client-request',
            attempts: 1,
            model: 'seqora-5.6',
            operation: 'generate',
            completedAt: updatedAt,
            resultSha256: 'b'.repeat(64),
            resultBytes: 1024,
            units: sources.map((source, index) => ({
              unitId: `episode:synthetic-${index + 1}`,
              source,
              resultSha256: 'c'.repeat(64),
              resultBytes: 128,
              providerCalls: index === 0 ? [call(1)] : index === 1 ? [call(2), call(3, 0)] : [],
            })),
          }
        : null,
  }
}

export async function openTextCompletion(page, testInfo, options = {}) {
  const state = createNavigationE2EState()
  const secondProject = options.secondProject
    ? { ...state.workspace.project, id: 'project-2', name: '来源隔离项目' }
    : null
  if (secondProject) state.projects.push(secondProject)
  const task = generationTask({
    id: taskId,
    kind: 'text',
    provider: 'text',
    model: 'seqora-5.6',
    label: '文本来源验收任务',
    prompt: privateText,
    updatedAt,
    status: options.reason === 'task-not-completed' ? 'running' : 'completed',
    metadata: {
      textResult: { script: privateText },
      textCompletionReceipt: { model: 'FORGED_METADATA_MODEL' },
    },
  })
  state.tasks = [task]
  const controls = { reason: options.reason || 'verified', transform: options.transform, status: 200 }
  const queries = [],
    replies = [],
    writes = [],
    downloads = [],
    externalRequests = []
  const pending = []
  let holdNext = Boolean(options.hold)
  const origin = new URL(testInfo.project.use.baseURL).origin
  await page.context().route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.fallback()
    return route.abort('blockedbyclient')
  })
  page.on('download', (download) => downloads.push(download))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) externalRequests.push(request.url())
    const path = url.pathname
    if (path.startsWith('/api/v1/') && request.method() !== 'GET') writes.push(path)
  })
  await mockWebApi(page, state)
  if (secondProject) {
    await page.route('**/api/v1/projects/project-2', (route) =>
      route.fulfill({ json: { project: secondProject, assets: [], shots: [], scriptEpisodes: [] } }),
    )
    await page.route('**/api/v1/projects/project-2/generation/tasks*', (route) => route.fulfill({ json: [] }))
  }
  await page.route(`**/api/v1/generation/tasks/${taskId}/text-completion`, async (route) => {
    expect(route.request().method()).toBe('GET')
    queries.push(route.request().url())
    const sequence = queries.length
    const snapshot = completionSnapshot(task, controls.reason)
    const json =
      controls.status === 200
        ? controls.transform
          ? controls.transform(snapshot)
          : snapshot
        : { error: { message: '来源查询暂时失败，请重试。' } }
    const status = controls.status
    if (holdNext) {
      holdNext = false
      await new Promise((resolve) => pending.push(resolve))
    }
    await route.fulfill({ status, json })
    replies.push(sequence)
  })
  // Page routes take precedence over context routes. Register this guard last
  // so an external URL with a matching API path cannot be swallowed by a mock.
  await page.route('**/*', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin || (url.pathname.startsWith('/api/v1/') && request.method() !== 'GET'))
      return route.abort('blockedbyclient')
    return route.fallback()
  })
  await page.goto('/?projectId=project-1')
  await expect(page.getByRole('heading', { name: '继续创作《E2E 短剧项目》', exact: true })).toBeVisible()
  if (page.viewportSize().width < 600)
    await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: '05 生成队列', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace', 'generate')
  const trigger = page.getByRole('button', { name: '查看来源', exact: true })
  await expect(trigger).toBeVisible()
  expect(queries).toEqual([])
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '文本结果来源', exact: true })
  await expect(dialog).toBeVisible()
  return {
    state,
    secondProject,
    task,
    controls,
    queries,
    replies,
    writes,
    downloads,
    externalRequests,
    dialog,
    trigger,
    holdNext: () => {
      holdNext = true
    },
    release: () => {
      const release = pending.shift()
      if (!release) throw new Error('No held query')
      release()
    },
    pendingCount: () => pending.length,
  }
}
