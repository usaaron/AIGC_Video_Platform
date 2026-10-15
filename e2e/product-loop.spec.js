import { expect, test } from '@playwright/test'

import { createMockApi } from './support/mockApi.js'

test.describe('product loop', () => {
  test('creator workspace covers push sync, retries, reruns and export acceptance', async ({ page }) => {
    const mockApi = createMockApi()
    await mockApi.install(page)
    await installTaskEventSource(page, mockApi.state.tasks)

    await page.goto('/')

    await expect(page.getByRole('heading', { name: /当前项目进度/ })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            window.__seqoraEventSourceUrls?.some((entry) => entry.url.includes('/generation/tasks/events')),
          ),
        ),
      )
      .toBe(true)

    await page.locator('nav').getByRole('button', { name: /剧本/ }).click()
    const scriptInput = page.locator('textarea').first()
    await scriptInput.fill(
      '雨夜，临港市旧火车站。林夏打开信，信封上没有署名。林夏把信放进风衣口袋，继续看向站台。',
    )
    const propSuggestion = page.locator('.asset-suggestion-card', { hasText: '信' }).first()
    await expect(propSuggestion).toBeVisible()
    await propSuggestion.getByRole('button', { name: /创建资产/ }).click()
    await expect
      .poll(() =>
        mockApi.state.workspace.assets.some((asset) => asset.kind === 'prop' && asset.name === '信'),
      )
      .toBe(true)

    await page.locator('nav').getByRole('button', { name: /资产/ }).click()
    await expect(page.getByRole('heading', { name: /角色 \/ 场景 \/ 道具 \/ 服装 \/ 音频/ })).toBeVisible()

    await page.locator('.asset-card', { hasText: '林夏' }).first().getByLabel('编辑资产').click()
    await expect(page.locator('.asset-studio')).toContainText('生成三张三视图源图')
    await page.getByRole('button', { name: '重生侧面' }).click()

    await expect.poll(() => mockApi.getLastCreatedTaskPayload('image')?.metadata?.regenerateView).toBe('side')
    const sideViewPayload = mockApi.getLastCreatedTaskPayload('image')
    expect(sideViewPayload.estimatedCredits).toBe(6)
    expect(sideViewPayload.metadata.generationStage).toBe('turnaround')
    expect(sideViewPayload.metadata.outputViews).toEqual(['side'])

    await page.locator('.asset-studio').getByRole('button', { name: '关闭' }).click()
    await expect(page.locator('.asset-studio')).toBeHidden()

    await page.locator('nav').getByRole('button', { name: /分镜/ }).click()
    const storyboardShot = page.locator('.shot-row', { hasText: '林夏抵达' }).first()
    await storyboardShot.getByRole('button', { name: '编辑' }).click()
    const shotModal = page.locator('.shot-editor-modal')
    await shotModal.getByRole('button', { name: /自动引用资产/ }).click()
    await shotModal.getByRole('button', { name: /角色行动/ }).click()
    await shotModal.getByLabel('选择负面提示词模板').selectOption('character')
    await shotModal.getByRole('button', { name: /加入约束/ }).click()
    await shotModal.getByRole('button', { name: /^保存分镜$/ }).click()
    await expect
      .poll(() => mockApi.state.workspace.shots.find((shot) => shot.id === 'shot-2')?.assetIds || [])
      .toContain('asset-station')
    const updatedShot = mockApi.state.workspace.shots.find((shot) => shot.id === 'shot-2')
    expect(updatedShot.prompt).toContain('镜头模板：角色行动')
    expect(updatedShot.prompt).toContain('负面约束：')
    await storyboardShot.getByRole('button', { name: /重生成|生成/ }).click()
    await expect.poll(() => mockApi.getLastCreatedTaskPayload('video')?.metadata?.shotId).toBe('shot-2')
    const videoPayload = mockApi.getLastCreatedTaskPayload('video')
    expect(videoPayload.prompt).toContain('镜头模板：角色行动')
    expect(videoPayload.prompt).not.toContain('负面约束：')
    expect(videoPayload.negativePrompt).toContain('不要磨皮过度')
    expect(videoPayload.metadata.assetIds).toContain('asset-station')

    await page.locator('nav').getByRole('button', { name: /生成/ }).click()
    await expect(page.getByRole('heading', { name: '任务状态' })).toBeVisible()
    await expect(page.getByText(/实时推送/)).toBeVisible()

    const failedAudioRow = generationRow(page, '幽灵列车 · 音频')
    await expect(failedAudioRow).toContainText('Audio provider timeout')
    await failedAudioRow.getByRole('button', { name: /日志/ }).click()
    const logModal = page.locator('.task-log-modal')
    await expect(page.getByText('provider.poll_failed')).toBeVisible()
    await expect(
      logModal.locator('.task-log-row strong', { hasText: 'Audio provider timeout' }),
    ).toBeVisible()
    await logModal
      .locator('.modal-actions')
      .getByRole('button', { name: /^关闭$/ })
      .click()
    await failedAudioRow.getByRole('button', { name: /重试/ }).click()

    await expect.poll(() => mockApi.state.retryTaskIds).toContain('task-audio-failed')
    await expect(failedAudioRow).toContainText('等待中')

    const audioTaskCount = countCreatedTasks(mockApi, 'audio')
    await generationRow(page, '雨夜站台 · 音频').getByRole('button', { name: /重生/ }).click()

    await expect.poll(() => countCreatedTasks(mockApi, 'audio')).toBe(audioTaskCount + 1)
    const audioPayload = mockApi.getLastCreatedTaskPayload('audio')
    expect(audioPayload.provider).toBe('audio')
    expect(audioPayload.metadata.assetId).toBe('asset-rain')
    expect(audioPayload.metadata.generationStage).toBe('audio')

    const imageTaskCount = countCreatedTasks(mockApi, 'image')
    await generationRow(page, '林夏 · 三视图').getByRole('button', { name: /重生/ }).click()

    await expect.poll(() => countCreatedTasks(mockApi, 'image')).toBe(imageTaskCount + 1)
    const turnaroundPayload = mockApi.getLastCreatedTaskPayload('image')
    expect(turnaroundPayload.estimatedCredits).toBe(18)
    expect(turnaroundPayload.metadata.generationStage).toBe('turnaround')
    expect(turnaroundPayload.metadata.outputViews).toEqual(['front', 'side', 'back'])

    await page.locator('nav').getByRole('button', { name: /成片/ }).click()
    await expect(page.getByRole('heading', { name: '预览和导出' })).toBeVisible()
    await expect(page.getByText('2/2 个镜头已完成')).toBeVisible()
    await expect(page.getByText('1/1 个音频资产可用于导出')).toBeVisible()

    const exportButton = page.getByRole('button', { name: /导出 MP4/ })
    await expect(exportButton).toBeEnabled()
    await exportButton.click()

    await expect.poll(() => mockApi.state.exportTaskId).not.toBe('')
    const exportPayload = mockApi.getLastCreatedTaskPayload('video')
    expect(exportPayload.provider).toBe('film-export')
    expect(exportPayload.metadata.sourceTaskIds).toEqual(['task-shot-1', 'task-shot-2'])
    expect(exportPayload.metadata.audioTaskIds).toEqual(['task-audio-complete'])
  })

  test('admin app opens as an independent dashboard', async ({ page }) => {
    const mockApi = createMockApi()
    mockApi.state.authMode = 'none'
    await mockApi.install(page)

    await page.goto('http://127.0.0.1:5174/')
    await expect(page.getByRole('heading', { name: '平台运行与审计' })).toBeVisible()

    await page.getByRole('button', { name: /进入后台/ }).click()

    await expect(page.getByRole('heading', { name: '平台运行状态' })).toBeVisible()
    await expect(page.getByText('平台管理员')).toBeVisible()
    await expect(page.getByText('用户数')).toBeVisible()
    await expect(page.getByText('活跃任务')).toBeVisible()
    await expect(page.getByText('最近审计日志')).toBeVisible()
    await expect(page.getByText('API、数据存储和队列依赖可用。')).toBeVisible()
  })
})

async function installTaskEventSource(page, initialTasks) {
  await page.addInitScript((tasks) => {
    window.__seqoraEventSourceUrls = []

    class MockEventSource {
      constructor(url, options = {}) {
        this.url = String(url)
        this.withCredentials = Boolean(options.withCredentials)
        this.readyState = MockEventSource.CONNECTING
        this.listeners = new Map()
        window.__seqoraEventSourceUrls.push({
          url: this.url,
          withCredentials: this.withCredentials,
        })

        window.setTimeout(() => {
          if (this.readyState === MockEventSource.CLOSED) return
          this.readyState = MockEventSource.OPEN
          this.emit('open', { type: 'open' })
          this.emit('tasks', {
            type: 'tasks',
            data: JSON.stringify({
              tasks,
              emittedAt: new Date().toISOString(),
            }),
          })
        }, 20)
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || new Set()
        current.add(listener)
        this.listeners.set(type, current)
      }

      removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener)
      }

      close() {
        this.readyState = MockEventSource.CLOSED
      }

      emit(type, event) {
        for (const listener of this.listeners.get(type) || []) {
          listener.call(this, event)
        }
      }
    }

    MockEventSource.CONNECTING = 0
    MockEventSource.OPEN = 1
    MockEventSource.CLOSED = 2
    window.EventSource = MockEventSource
  }, initialTasks)
}

function generationRow(page, label) {
  return page
    .locator('.generation-job')
    .filter({
      has: page.locator('.job-title-line strong', {
        hasText: new RegExp(`^${escapeRegExp(label)}$`),
      }),
    })
    .first()
}

function countCreatedTasks(mockApi, kind) {
  return mockApi.state.createdTaskPayloads.filter((payload) => payload.kind === kind).length
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
