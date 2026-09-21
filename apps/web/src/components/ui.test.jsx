import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JobRow } from './ui'

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
})

describe('video job progress and automatic result checks', () => {
  const video = {
    id: 'video-1',
    kind: 'video',
    type: '视频',
    label: '镜头 01',
    cost: 18,
    status: 'running',
    provider: 'seedance',
    progress: 50,
    createdAt: '2026-09-21T04:00:00Z',
    metadata: { providerSubmittedAt: '2026-09-21T04:00:00Z' },
  }
  const render = (overrides = {}, compact = false) =>
    renderToStaticMarkup(<JobRow job={{ ...video, ...overrides }} compact={compact} />)

  afterEach(() => vi.restoreAllMocks())

  it.each([false, true])('shows elapsed time without invented percentages (compact=%s)', (compact) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-21T04:07:12Z'))
    const html = render({ metadata: { ...video.metadata, providerProgressIsEstimated: true } }, compact)

    expect(html).toContain('生成中')
    expect(html).toContain('已等待 7 分 12 秒')
    expect(html).toContain('完成后自动出现在分镜，无需停留此页')
    expect(html).not.toContain('50%')
    expect(html).not.toContain('job-progress')
    expect(html).not.toContain('自动取消旧任务并重试')
  })

  it('keeps measured video, image, and local composition progress unchanged', () => {
    for (const overrides of [
      {},
      { kind: 'image', metadata: { providerProgressIsEstimated: true } },
      { provider: 'local-compose', metadata: { providerProgressIsEstimated: true } },
    ]) {
      const html = render(overrides)
      expect(html).toContain('50%')
      expect(html).toContain('job-progress')
      expect(html).not.toContain('完成后自动出现在分镜')
    }
  })

  it.each(['poll_error', 'processing_timeout'])('shows tagged failed %s tasks as checking', (reason) => {
    const html = render({
      status: 'failed',
      error: 'Prior transport error',
      metadata: {
        providerReconciliationStatus: 'pending',
        providerReconciliationReason: reason,
        creditsRefundedAt: '2026-09-21T04:31:00Z',
      },
    })
    expect(html).toContain('核对中')
    expect(html).toContain('正在核对结果，系统会自动接回已完成视频')
    expect(html).toContain('已退款')
    expect(html).not.toContain('job-icon failed')
    expect(html).not.toContain('Prior transport error')
  })

  it('requires the actual poll error and retry marker before promising a background check', () => {
    const metadata = {
      providerFailureSource: 'status_poll',
      providerPollErrors: 1,
      providerPollRetryNotBefore: '2026-09-21T04:08:00Z',
    }
    expect(render({ metadata })).toContain('核对中')
    expect(render({ metadata })).not.toContain('50%')
    for (const patch of [
      { providerFailureSource: 'upstream' },
      { providerPollErrors: 0 },
      { providerPollRetryNotBefore: undefined },
      { providerPollRetryNotBefore: 'invalid' },
    ]) {
      expect(render({ metadata: { ...metadata, ...patch } })).not.toContain('系统会自动接回')
    }
  })

  it.each(['expired', 'upstream_failed', 'completed', undefined])(
    'does not claim automatic recovery once reconciliation is %s',
    (status) => {
      const html = render({
        status: 'failed',
        error: '生成失败',
        metadata: { providerReconciliationStatus: status, providerReconciliationReason: 'poll_error' },
      })
      expect(html).not.toContain('核对中')
      expect(html).not.toContain('系统会自动接回')
    },
  )

  it('never infers reconciliation from the error message or applies it to cancelled tasks', () => {
    expect(render({ status: 'failed', error: 'Video processing timed out' })).not.toContain('核对中')
    expect(
      render({
        status: 'cancelled',
        metadata: { providerReconciliationStatus: 'pending', providerReconciliationReason: 'poll_error' },
      }),
    ).not.toContain('系统会自动接回')
  })

  it('summarizes confirmed copyright rejection in Chinese and collapses original details', () => {
    const html = render({
      status: 'failed',
      error: 'Upstream rejected this request because of copyright restrictions.',
      metadata: { providerFailureSource: 'upstream', providerFailureCode: 'UPSTREAM_COPYRIGHT_REJECTED' },
    })
    expect(html).toContain('上游判定生成内容可能涉及版权限制，本次视频未生成。')
    expect(html).toContain('<details class="job-error-details">')
    expect(html).toContain('查看错误详情')
    expect(html).toContain('Upstream rejected this request because of copyright restrictions.')
    expect(html).not.toContain('<details open')
  })

  it('does not misclassify other errors or non-video tasks as copyright rejection', () => {
    expect(render({ status: 'failed', error: 'Copyright mentioned in an unrelated error' })).not.toContain(
      '上游判定生成内容可能涉及版权限制',
    )
    expect(
      render({
        kind: 'image',
        status: 'failed',
        metadata: { providerFailureSource: 'upstream', providerFailureCode: 'UPSTREAM_COPYRIGHT_REJECTED' },
      }),
    ).not.toContain('上游判定生成内容可能涉及版权限制')
  })
})
