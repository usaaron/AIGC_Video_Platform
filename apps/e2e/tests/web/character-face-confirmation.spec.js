import { expect, test } from '@playwright/test'
import { createDefaultAttributes } from '../../../web/src/features/assets/assetOptions.js'
import { createWebE2EState, mockWebApi, now, tinyImageDataUrl } from '../fixtures.js'

const faceA = { id: 'face-A', url: '/api/v1/media/face-A', name: 'face-A.png' }
const faceB = { id: 'face-B', url: '/api/v1/media/face-B', name: 'face-B.png' }
const portraitA = {
  assetId: 'portrait-A',
  groupId: 'group-A',
  groupType: 'AIGC',
  faceReferenceId: faceA.id,
  name: '人像 A',
  status: 'active',
  previewUrl: tinyImageDataUrl,
  checkedAt: now,
}

test('新建人物确认不丢失编辑器状态，等待响应期间不能换来源、类型或候选', async ({ page }) => {
  const state = await characterApi(page)
  await openAssets(page)
  await page.getByRole('button', { name: '添加人物', exact: true }).click()
  await page.getByRole('button', { name: /直接使用原图/ }).click()
  await page.locator('.asset-core-fields input').fill('新建确认人物')
  await uploadCandidate(page, faceA)
  await page.getByRole('button', { name: '设为面部基准', exact: true }).click()
  await expect.poll(() => state.confirmations.length).toBe(1)
  await expect(page.locator('.asset-studio-head h2')).toHaveText('新建确认人物')

  // Exercise actual browser hit testing: setInputFiles/dispatchEvent bypass inert.
  for (const control of [
    page.locator('.source-switch button').last(),
    page.locator('.character-subject-field button').last(),
    page.locator('.reference-remove-button'),
  ]) {
    await expect(control.click({ timeout: 500 })).rejects.toThrow(/Timeout/)
  }
  expect(state.created).toHaveLength(1)
  expect(state.confirmations[0].faceReference).toMatchObject({ id: faceA.id, url: faceA.url })
  state.confirmation.resolve()

  await expect(page.locator('.character-stage-nav button[aria-current="step"]')).toContainText('全身定稿')
  await expect(page.locator('.character-stage-nav button').nth(1)).toBeEnabled()
  await expect(page.getByRole('button', { name: '保存并直接使用' })).toBeEnabled()
  await page.getByRole('button', { name: '保存并直接使用' }).click()
  await expect.poll(() => state.patches.length).toBe(1)
  expect(state.patches[0].attributes).toMatchObject({
    faceStatus: 'approved',
    faceReference: { id: faceA.id, url: faceA.url },
  })
  expect(state.created).toHaveLength(1)
  expect(state.confirmations).toHaveLength(1)
})

test('确认失败后恢复编辑并保留候选，不误解锁全身', async ({ page }) => {
  const asset = character({ faceStatus: 'pending', faceReference: null })
  const state = await characterApi(page, asset)
  state.confirmationError = '面部来源已失效，请重新选择'
  await openAssets(page)
  await page.getByRole('button', { name: '编辑资产', exact: true }).click()
  await page.getByRole('button', { name: '设为面部基准', exact: true }).click()
  await expect.poll(() => state.confirmations.length).toBe(1)
  state.confirmation.resolve()

  await expect(page.locator('.character-workflow')).toContainText(state.confirmationError)
  await expect(page.getByRole('button', { name: '设为面部基准', exact: true })).toBeEnabled()
  await expect(page.locator('.character-stage-nav button').nth(1)).toBeDisabled()
  await expect(page.getByRole('button', { name: '移除 face-A.png', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '移除 face-A.png', exact: true }).click()
  await uploadCandidate(page, faceB)
  await expect(page.getByRole('button', { name: '移除 face-B.png', exact: true })).toBeVisible()
  expect(state.workspace.assets[0].attributes.faceStatus).toBe('pending')
})

for (const [label, candidate] of [
  ['不同 ID', faceB],
  ['相同 ID、不同 URL', { ...faceB, id: faceA.id }],
]) {
  test(`改选新面部后，旧人像轮询不能回填草稿（${label}）`, async ({ page }) => {
    await page.clock.install()
    const state = await characterApi(page, character())
    state.uploads = [candidate]
    await openAssets(page)
    await page.getByRole('button', { name: '编辑资产', exact: true }).click()
    await page.locator('.character-stage-nav button').first().click()
    await page.getByRole('button', { name: '移除 face-A.png', exact: true }).click()
    await uploadCandidate(page, candidate)
    await publishPortrait(page, state)

    await expect(page.locator('.character-stage-nav button').nth(1)).toBeDisabled()
    await expect(page.getByRole('button', { name: 'AI 人像已可用', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '保存并直接使用' }).click()
    await expect.poll(() => state.patches.length).toBe(1)
    expect(state.patches[0].references).toEqual([candidate])
    expect(state.patches[0].attributes).toMatchObject({
      faceStatus: 'pending',
      faceReference: null,
      trustedPortrait: null,
    })
  })
}

test('同一面部仍能同步人像完成状态，并保留未保存的编辑', async ({ page }) => {
  await page.clock.install()
  const state = await characterApi(page, character())
  await openAssets(page)
  await page.getByRole('button', { name: '编辑资产', exact: true }).click()
  await page.locator('.asset-core-fields textarea').fill('本地未保存的角色说明')
  await publishPortrait(page, state)
  await expect(page.getByRole('button', { name: 'AI 人像已可用', exact: true })).toBeVisible()
  await expect(page.locator('.asset-core-fields textarea')).toHaveValue('本地未保存的角色说明')
  await page.getByRole('button', { name: '保存并直接使用' }).click()
  await expect.poll(() => state.patches.length).toBe(1)
  expect(state.patches[0].attributes.trustedPortrait.assetId).toBe(portraitA.assetId)
  expect(state.patches[0].description).toBe('本地未保存的角色说明')
})

async function openAssets(page) {
  await page.goto('/')
  await page.getByRole('button', { name: /E2E 短剧项目/ }).click()
  await page
    .getByRole('navigation', { name: '创作流程' })
    .getByRole('button', { name: /资产设计$/ })
    .click()
  await expect(page.getByRole('button', { name: '添加人物', exact: true })).toBeVisible()
}

async function uploadCandidate(page, reference) {
  await page.locator('input[type="file"]').setInputFiles({
    name: reference.name,
    mimeType: 'image/png',
    buffer: Buffer.from(tinyImageDataUrl.split(',')[1], 'base64'),
  })
  await expect(page.getByRole('button', { name: `移除 ${reference.name}`, exact: true })).toBeVisible()
}

async function publishPortrait(page, state) {
  const asset = state.workspace.assets[0]
  state.workspace.assets[0] = {
    ...asset,
    name: '服务端人像已同步',
    updatedAt: '2026-08-19T08:01:00.000Z',
    attributes: { ...asset.attributes, trustedPortrait: portraitA },
  }
  await page.clock.fastForward(31_000)
  // The changed title proves the real workspace poll reached AssetsPage and AssetEditor props.
  await expect(page.locator('.asset-studio-head h2')).toHaveText('服务端人像已同步')
}

function character(attributes = {}) {
  return {
    id: 'character-1',
    projectId: 'project-1',
    tenantId: 'tenant-1',
    kind: 'character',
    name: '已有人物',
    sourceMode: 'import',
    description: '',
    prompt: '',
    negativePrompt: '',
    promptMode: 'standard',
    customPromptMode: 'replace',
    customPrompt: '',
    status: 'confirmed',
    references: [faceA],
    imageUrl: faceA.url,
    createdAt: now,
    updatedAt: now,
    attributes: {
      ...createDefaultAttributes('character'),
      faceStatus: 'approved',
      faceReference: faceA,
      ...attributes,
    },
  }
}

async function characterApi(page, initialAsset) {
  const state = createWebE2EState()
  Object.assign(state, {
    created: [],
    patches: [],
    confirmations: [],
    uploads: [initialAsset ? faceB : faceA],
    confirmation: deferred(),
    confirmationError: null,
  })
  if (initialAsset) state.workspace.assets = [initialAsset]
  await mockWebApi(page, state)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    const method = request.method()
    const json = (body, status = 200) => route.fulfill({ status, json: body })
    if (method === 'GET' && path.startsWith('/media/')) {
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(tinyImageDataUrl.split(',')[1], 'base64'),
      })
    }
    if (path === '/trusted-assets/configuration') {
      return json({ configured: true, virtualRegistrationReady: true, realValidationReady: false })
    }
    if (path.endsWith('/trusted-portrait/validation-session/latest')) return json(null)
    if (path.endsWith('/generation/tasks/poll')) {
      return json(state.tasks.map(({ outputs: _outputs, ...task }) => task))
    }
    if (path.endsWith('/workspace/version'))
      return json({ version: state.workspace.assets[0]?.updatedAt || now })
    if (method === 'POST' && path === '/projects/project-1/media') return json(state.uploads.shift())
    if (method === 'POST' && path === '/projects/project-1/assets') {
      const input = request.postDataJSON()
      state.created.push(input)
      const asset = { ...character(), ...input, attributes: input.attributes }
      state.workspace.assets.push(asset)
      return json(asset)
    }
    if (method === 'PATCH' && path === '/projects/project-1/assets/character-1') {
      const input = request.postDataJSON()
      state.patches.push(input)
      const asset = { ...state.workspace.assets[0], ...input }
      state.workspace.assets[0] = asset
      return json(asset)
    }
    if (method === 'POST' && path.endsWith('/face-confirmation')) {
      const input = request.postDataJSON()
      state.confirmations.push(input)
      await state.confirmation.promise
      if (state.confirmationError) {
        return json({ error: { code: 'FACE_SOURCE_REQUIRED', message: state.confirmationError } }, 409)
      }
      const asset = state.workspace.assets[0]
      const confirmed = {
        ...asset,
        updatedAt: '2026-08-19T08:00:01.000Z',
        attributes: { ...asset.attributes, faceStatus: 'approved', faceReference: input.faceReference },
      }
      state.workspace.assets[0] = confirmed
      return json({ asset: confirmed, registrationTask: null, registrationError: null })
    }
    return route.fallback()
  })
  return state
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
