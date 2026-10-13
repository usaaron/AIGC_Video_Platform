import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JobRow, TaskControls } from './ui'

describe('generation job result actions', () => {
  it('opens completed video results in the in-app preview', () => {
    const html = renderToStaticMarkup(
      <JobRow
        job={{
          id: 'video-1',
          kind: 'video',
          type: '视频',
          label: '镜头 01',
          cost: 18,
          status: 'completed',
          progress: 100,
          resultUrl: '/api/v1/generation/tasks/video-1/content',
          metadata: {},
        }}
        onPreviewResult={vi.fn()}
      />,
    )

    expect(html).toContain('预览视频')
    expect(html).not.toContain('target="_blank"')
    expect(html).not.toContain('<a')
  })

  it('shows a pause control for queued image work', () => {
    const html = renderToStaticMarkup(
      <TaskControls
        job={{ id: 'image-queued', kind: 'image', status: 'queued', metadata: {} }}
        onPause={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="暂停任务"')
    expect(html).not.toContain('继续任务')
  })

  it('shows a resume control for paused video work', () => {
    const html = renderToStaticMarkup(
      <TaskControls
        job={{ id: 'video-paused', kind: 'video', status: 'paused', metadata: {} }}
        onResume={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="继续任务"')
    expect(html).not.toContain('暂停任务')
  })

  it('offers a confirmed stop action for running third-party work', () => {
    const html = renderToStaticMarkup(
      <TaskControls
        job={{
          id: 'video-running',
          kind: 'video',
          status: 'running',
          metadata: { providerName: 'dora-router' },
        }}
        onPause={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="停止生成（积分不返还）"')
    expect(html).not.toContain('disabled=""')
  })

  it('shows rigid physics state and the blocking reason in the queue', () => {
    const html = renderToStaticMarkup(
      <JobRow
        job={{
          id: 'video-physics',
          kind: 'video',
          type: '视频',
          label: '镜头 01',
          cost: 18,
          status: 'queued',
          progress: 0,
          metadata: {
            rigidPhysicsAudit: {
              status: 'needs-evidence',
              violations: [{ code: 'FRAME_EVIDENCE_MISSING', detail: '底脚和连接点未覆盖' }],
            },
          },
        }}
      />,
    )

    expect(html).toContain('物理验收：缺少逐帧证据')
    expect(html).toContain('阻塞原因：底脚和连接点未覆盖')
  })

  it('offers read-only delivery verification for a frozen contract', () => {
    const html = renderToStaticMarkup(
      <JobRow
        job={{
          id: 'video-delivery',
          kind: 'video',
          type: '视频',
          label: '镜头 01',
          cost: 18,
          status: 'completed',
          metadata: { deliveryContract: { contractHash: 'a'.repeat(64) } },
        }}
        onInspectDelivery={() => undefined}
      />,
    )

    expect(html).toContain('查看交付核验')
  })
})
