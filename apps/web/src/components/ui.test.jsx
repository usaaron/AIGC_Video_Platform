import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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
