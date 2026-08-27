import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Image2CreditConfirmDialog } from './Image2CreditConfirmDialog'
import { ImageResultGallery } from './ImageResultGallery'
import { ImageStudioPage, getPromptReferenceWarnings } from './ImageStudioPage'
import { PromptComposer } from './PromptComposer'
import { ReferenceStrip } from './ReferenceStrip'

describe('ImageStudioPage', () => {
  it('surfaces the provider unavailable state without exposing any key UI', () => {
    const html = renderToStaticMarkup(
      <ImageStudioPage
        project={{ id: 'project-1', name: 'Demo Project' }}
        billing={{ billingScope: 'project', credits: 24 }}
        tasks={[]}
        image2ProviderStatus="local-mock"
      />,
    )

    expect(html).toContain('生图大师服务尚未配置')
    expect(html).toContain('aria-label="生图大师工作台"')
    expect(html).toContain('image2-toolbar-mark')
    expect(html).toContain('aria-label="结果画廊"')
    expect(html).not.toContain('批次提示词')
    expect(html).toContain('aria-label="提示词编排"')
    expect(html).toContain('aria-label="生成设置"')
    expect(html).toContain('image2-submit-summary')
    expect(html).toContain('0 / 5')
    expect(html).toContain('画幅比例')
    expect(html).toContain('自适应 auto')
    expect(html).toContain('2160×3840')
    expect(html).toContain('提示词优化')
    expect(html).toContain('引用图视觉解析')
    expect(html).toContain('image2-reference-toggle')
    expect(html).toContain('添加引用图')
    expect(html).not.toContain('序幕 TV 影视制作提示词模板')
    expect(html).not.toContain('人物定妆照')
    expect(html).not.toContain('连戏参考图')
    expect(html).not.toContain('场景气氛图')
    expect(html).not.toContain('API Key')
    expect(html).not.toContain('API 地址')
    expect(html).not.toContain('/chat/completions')
    expect(html).not.toContain('等待第一个 image2 批次')
    expect(html).not.toContain('image2-reference-empty')
    expect(html.indexOf('aria-label="提示词编排"')).toBeLessThan(html.indexOf('aria-label="结果画廊"'))
    expect(html.indexOf('aria-label="生成设置"')).toBeLessThan(html.indexOf('image2-submit-summary'))
  })

  it('renders the submit summary beside the button and the confirmation dialog copy', () => {
    const html = renderToStaticMarkup(
      <PromptComposer
        prompt="sunset portrait"
        negativePrompt=""
        availableCredits={42}
        estimatedCredits={18}
        aspectRatio="auto"
        quality="low"
        imageCount={3}
        onAspectRatioChange={() => undefined}
        onQualityChange={() => undefined}
        onImageCountChange={() => undefined}
        assist={{ promptOptimization: false, referenceVision: false }}
        onAssistChange={() => undefined}
        submitting={false}
        disabled={false}
        submitConfirmOpen
        onSubmitRequest={() => undefined}
        onConfirmSubmit={() => undefined}
        onCancelSubmit={() => undefined}
        insertRequest={null}
        onPromptChange={() => undefined}
        onNegativePromptChange={() => undefined}
        error=""
      />,
    )

    expect(html).toContain('image2-submit-summary')
    expect(html).toContain('image2-submit-confirm')
    expect(html).toContain('本次将生成 <strong>3</strong> 张图片')
    expect(html).toContain('预计消耗 <strong>18</strong> 积分')
    expect(html).toContain('当前余额 <strong>42</strong> 积分')
  })

  it('renders action, estimated credits, and remaining balance before a rerun', () => {
    const html = renderToStaticMarkup(
      <Image2CreditConfirmDialog
        open
        title="确认按原参数重做"
        actionDescription="按这张图片的完整生成快照重新生成 1 张图片"
        confirmLabel="确认重做"
        imageCount={1}
        estimatedCredits={6}
        availableCredits={42}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )

    expect(html).toContain('确认按原参数重做')
    expect(html).toContain('本次将按这张图片的完整生成快照重新生成 1 张图片')
    expect(html).toContain('预计消耗 <strong>6</strong> 积分')
    expect(html).toContain('当前余额 <strong>42</strong> 积分')
    expect(html).toContain('确认重做')
  })

  it('renders stable reference numbers and migrated roles', () => {
    const html = renderToStaticMarkup(
      <ReferenceStrip
        references={[
          {
            mediaId: 'media-7',
            url: '/api/v1/media/media-7',
            inputNumber: 7,
            role: 'accessory',
          },
        ]}
        uploading={false}
        disabled={false}
        onUpload={() => undefined}
        onRemove={() => undefined}
        onRoleChange={() => undefined}
        onInsertReference={() => undefined}
      />,
    )

    expect(html).toContain('图 7')
    expect(html).toContain('帽子/配饰')
    expect(html).toContain('色调')
    expect(html).toContain('multiple')
  })

  it('renders failed result tiles as retry actions', () => {
    const html = renderToStaticMarkup(
      <ImageResultGallery
        batch={{
          batchId: 'image2-batch-1',
          label: '第 1 次生成',
          prompt: '夜景人物肖像',
          originalPrompt: '夜景人物肖像',
          completedCount: 0,
          totalCount: 1,
          tasks: [
            {
              id: 'task-failed-1',
              projectId: 'project-1',
              status: 'failed',
              progress: 0,
              updatedAt: '2026-08-14T10:00:00.000Z',
              metadata: {
                image2BatchId: 'image2-batch-1',
                batchIndex: 1,
                batchSize: 1,
              },
              outputs: [],
            },
          ],
        }}
        batches={[]}
        selectedBatchId="image2-batch-1"
        onRetryFailed={() => undefined}
      />,
    )

    expect(html).toContain('class="image2-result-tile failed retryable"')
    expect(html).toContain('aria-label="重试失败图片 1"')
    expect(html).toContain('title="重试失败图片"')
    expect(html).toContain('点击重试')
    expect(html).not.toContain('disabled=""')
  })

  it('checks prompt image numbers and subject-role conflicts', () => {
    expect(
      getPromptReferenceWarnings('让图 1 穿上图 2 的衣服，色调参考图３', [
        { mediaId: 'media-1', inputNumber: 1, role: 'subject' },
        { mediaId: 'media-2', inputNumber: 2, role: 'clothing' },
      ]),
    ).toEqual([
      '图 1 当前标为主体，但提示词像是在把它当成服装、配饰或风格参考，可能混淆。',
      '图 3 不存在，请确认引用编号。',
    ])
  })

  it('exposes result and batch pagination sizes in the workbench', () => {
    const latestPrompt = '夜景人物肖像，柔光，电影感，黑金色调'
    const latestBatchTasks = Array.from({ length: 11 }, (_, index) => ({
      id: `task-${index + 1}`,
      projectId: 'project-1',
      status: 'completed',
      progress: 100,
      prompt: latestPrompt,
      estimatedCredits: 6,
      updatedAt: `2026-08-14T10:${String(index).padStart(2, '0')}:00.000Z`,
      metadata: {
        image2BatchId: 'image2-latest-main',
        batchIndex: index + 1,
        batchSize: 11,
      },
      outputs: [
        {
          id: `output-${index + 1}`,
          mediaType: 'image',
          url: `/media/task-${index + 1}.png`,
        },
      ],
    }))
    const historicalBatchTasks = Array.from({ length: 5 }, (_, index) => ({
      id: `historical-task-${index + 1}`,
      projectId: 'project-1',
      status: index === 0 ? 'failed' : 'completed',
      progress: index === 0 ? 0 : 100,
      prompt: `历史镜头 ${index + 1}`,
      estimatedCredits: 6,
      updatedAt: `2026-08-${String(13 - index).padStart(2, '0')}T10:00:00.000Z`,
      metadata: {
        image2BatchId: `image2-history${index + 1}`,
        batchIndex: 1,
        batchSize: 1,
      },
      outputs: [
        {
          id: `historical-output-${index + 1}`,
          mediaType: 'image',
          url: `/media/historical-task-${index + 1}.png`,
        },
      ],
    }))
    const html = renderToStaticMarkup(
      <ImageStudioPage
        project={{ id: 'project-1', name: 'Demo Project' }}
        billing={{ billingScope: 'project', credits: 120 }}
        tasks={[...latestBatchTasks, ...historicalBatchTasks]}
        image2ProviderStatus="configured"
      />,
    )

    expect(html).toContain('每页 10 张')
    expect(html).toContain('aria-label="生成结果分页"')
    expect(html).toContain('aria-label="批次记录"')
    expect(html).toContain('aria-label="批次记录分页"')
    expect(html.match(/class="image2-batch-history-item/g)).toHaveLength(5)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('失败 1')
    expect(html).toContain('第 1 次生成')
    expect(html).not.toContain('第 2 次生成')
  })
})
