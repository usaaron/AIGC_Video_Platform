import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GenerationPage } from './GenerationPage'

const task = {
  id: 'task-1',
  projectId: 'project-1',
  tenantId: 'tenant-1',
  kind: 'text',
  provider: 'text',
  label: '历史文本任务',
  status: 'completed',
  updatedAt: '2026-10-15T02:00:00.000Z',
  estimatedCredits: 0,
  resultUrl: null,
  metadata: {},
}
function render(jobs, onInspectTextCompletion = () => {}) {
  return renderToStaticMarkup(
    <GenerationPage
      projectId="project-1"
      tenantId="tenant-1"
      jobs={jobs}
      concurrency={1}
      member
      onInspectTextCompletion={onInspectTextCompletion}
    />,
  )
}

describe('generation queue text source inspection', () => {
  it('provides a text filter and source inspection for a host text result without a media URL', () => {
    const html = render([task])
    expect(html).toContain('>文本</button>')
    expect(html).toContain('查看来源')
    expect(html).not.toContain('冻结交付合同')
    expect(html).not.toContain('查看交付核验')
  })

  it.each(['queued', 'paused', 'running', 'completed', 'failed', 'cancelled'])(
    'allows read-only status inspection of a %s text task',
    (status) => {
      expect(render([{ ...task, status }])).toContain('查看来源')
    },
  )

  it.each([
    { kind: 'image' },
    { kind: 'video' },
    { kind: 'audio' },
    { provider: 'external-text' },
    { projectId: 'sm-standalone-project' },
    { metadata: { queueHiddenAt: '2026-10-15T02:00:01.000Z' } },
  ])('does not expose a host source query for unsupported or archived rows %j', (change) => {
    expect(render([{ ...task, ...change }])).not.toContain('查看来源')
  })

  it('does not advertise an unavailable query handler', () => {
    expect(render([task], null)).not.toContain('查看来源')
  })

  it('does not present raw task metadata as a verified receipt on a queue card', () => {
    const html = render([
      {
        ...task,
        metadata: {
          textCompletionReceipt: { marker: 'forged-receipt' },
          textResult: 'raw-private-result',
          leaseToken: 'private-lease',
        },
      },
    ])
    expect(html).toContain('查看来源')
    for (const value of ['forged-receipt', 'raw-private-result', 'private-lease', '来源记录已核验'])
      expect(html).not.toContain(value)
  })
})
