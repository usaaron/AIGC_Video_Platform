import { describe, expect, it } from 'vitest'
import { getWorkflowGuide } from './workflowGuide'

const project = { script: '场次：S01，主角发现一封信。', previewUrl: '/previous.mp4' }
const assets = [{ kind: 'scene', status: 'confirmed' }]
const shots = [{ id: 'shot-1', selectedVideoTaskId: 'video-2' }]
const video = (id, status, createdAt) => ({
  id,
  kind: 'video',
  provider: 'seedance',
  status,
  createdAt,
  metadata: { shotId: 'shot-1' },
})

describe('workspace guidance', () => {
  it('takes completed Agent output to film even when manual asset confirmations are pending', () => {
    const guide = getWorkflowGuide({
      project,
      assets: [{ kind: 'scene', status: 'draft' }],
      shots,
      tasks: [
        video('video-2', 'completed', '2026-09-08'),
        {
          kind: 'video',
          provider: 'local-compose',
          status: 'completed',
          metadata: { generationStage: 'film-preview', sourceVideoTaskIds: ['video-2'] },
        },
      ],
    })
    expect(guide.ready.film).toBe(true)
    expect(guide.ready.assets).toBe(false)
    expect(guide.step).toBe('film')
    expect(guide.title).toBe('你的作品已就绪')
  })
  it('does not consider an old project preview to be a current finished film', () => {
    const guide = getWorkflowGuide({
      project,
      assets,
      shots,
      tasks: [video('video-2', 'completed', '2026-09-08')],
    })
    expect(guide.ready.film).toBe(false)
    expect(guide.step).toBe('film')
  })
  it('ignores a recovered failure for the same target', () => {
    const guide = getWorkflowGuide({
      project,
      assets,
      shots,
      tasks: [video('video-2', 'completed', '2026-09-08'), video('video-1', 'failed', '2026-09-07')],
    })
    expect(guide.step).toBe('film')
    expect(guide.tone).toBe('complete')
  })
  it('requires the preview sources to match the selected shot versions', () => {
    const tasks = [
      video('video-2', 'completed', '2026-09-08'),
      video('video-1', 'completed', '2026-09-07'),
      {
        kind: 'video',
        provider: 'local-compose',
        status: 'completed',
        metadata: { generationStage: 'film-preview', sourceVideoTaskIds: ['video-1'] },
      },
    ]
    expect(getWorkflowGuide({ project, assets, shots, tasks }).ready.film).toBe(false)
    tasks[2].metadata.sourceVideoTaskIds = ['video-2']
    expect(getWorkflowGuide({ project, assets, shots, tasks }).ready.film).toBe(true)
  })
})
