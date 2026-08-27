import { expect, test } from '@playwright/test'
import { completedImage2Task, createWebE2EState, failedImage2Task, mockWebApi } from '../fixtures.js'

test('生图大师提交批次前确认积分，并只发送服务端托管参数', async ({ page }) => {
  const state = await mockWebApi(page)

  await page.goto('/')
  await page.getByRole('button', { name: /生图大师/ }).click()

  await page.getByLabel('主提示词').fill('雨夜车站，女主站在发光站牌旁，电影感构图。')
  await page.getByLabel('画幅比例').selectOption('1536x864')
  await page.getByRole('button', { name: '标准' }).click()
  await page.getByRole('spinbutton', { name: '张数' }).fill('3')
  await page.getByRole('button', { name: /提交批次/ }).click()

  const confirm = page.getByRole('dialog', { name: '确认生成批次' })
  await expect(confirm).toContainText('本次将生成 3 张图片')
  await expect(confirm).toContainText('预计消耗 18 积分')
  await expect(confirm).toContainText('当前余额 1910 积分')

  await confirm.getByRole('button', { name: '确认生成' }).click()
  await expect.poll(() => state.image2BatchRequests.length).toBe(1)
  expect(state.image2BatchRequests[0]).toMatchObject({
    projectId: 'project-1',
    prompt: '雨夜车站，女主站在发光站牌旁，电影感构图。',
    aspectRatio: '1536x864',
    quality: 'medium',
    imageCount: 3,
    assist: { promptOptimization: false, referenceVision: false },
    references: [],
  })
  expect(state.image2BatchRequests[0]).not.toHaveProperty('provider')
  expect(state.image2BatchRequests[0]).not.toHaveProperty('apiKey')
  expect(state.image2BatchRequests[0]).not.toHaveProperty('apiBase')
  expect(state.image2BatchRequests[0]).not.toHaveProperty('estimatedCredits')
})

test('失败图片点击重试会确认积分并删除原失败任务', async ({ page }) => {
  const state = createWebE2EState({ tasks: [failedImage2Task()] })
  await mockWebApi(page, state)

  await page.goto('/')
  await page.getByRole('button', { name: /生图大师/ }).click()
  await page.getByText('点击重试').click()

  const confirm = page.getByRole('dialog', { name: '确认重试失败图片' })
  await expect(confirm).toContainText('预计消耗 6 积分')
  await expect(confirm).toContainText('当前余额 1910 积分')
  await confirm.getByRole('button', { name: '确认重试' }).click()

  await expect.poll(() => state.image2BatchRequests.length).toBe(1)
  await expect.poll(() => state.deletedTasks).toContain('task-failed-1')
  expect(state.image2BatchRequests[0]).toMatchObject({
    projectId: 'project-1',
    prompt: '失败任务提示词',
    quality: 'medium',
    imageCount: 1,
  })
})

test('预览弹窗可以查看并复制完整生成提示词', async ({ browser, baseURL }) => {
  const context = await browser.newContext()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  const page = await context.newPage()
  await mockWebApi(
    page,
    createWebE2EState({
      tasks: [
        completedImage2Task({
          metadata: {
            image2BatchId: 'batch-completed',
            batchIndex: 1,
            batchSize: 1,
            generationSnapshot: {
              prompt: '最终电影感提示词：雨夜车站，霓虹反射，35mm 镜头。',
              originalPrompt: '最终电影感提示词：雨夜车站，霓虹反射，35mm 镜头。',
              negativePrompt: 'blurry',
              references: [],
              quality: 'high',
              aspectRatio: '1536x864',
              assist: { promptOptimization: false, referenceVision: false },
            },
          },
        }),
      ],
    }),
  )

  await page.goto('/')
  await page.getByRole('button', { name: /生图大师/ }).click()
  await page.getByRole('button', { name: /预览第 1 张图片/ }).click()
  await page.getByRole('button', { name: '查看提示词' }).click()

  const promptDialog = page.getByRole('dialog', { name: '提示词弹窗' })
  await expect(promptDialog).toContainText('最终电影感提示词：雨夜车站，霓虹反射，35mm 镜头。')
  await promptDialog.getByRole('button', { name: '复制' }).click()

  await expect(promptDialog.getByRole('button', { name: '已复制' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('最终电影感提示词：雨夜车站，霓虹反射，35mm 镜头。')
  await context.close()
})
