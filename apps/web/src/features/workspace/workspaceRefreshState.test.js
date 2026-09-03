import { describe, expect, it } from 'vitest'
import {
  hasTaskTerminalTransition,
  mergeTaskPolling,
  taskSnapshotKey,
  taskStatusMap,
  workspaceSnapshotKey,
  workspaceVersionKey,
} from './workspaceRefreshState'

describe('workspace refresh state', () => {
  it('keeps equivalent task payloads stable', () => {
    const tasks = [{ id: 'task-1', kind: 'text', status: 'running', progress: 20, updatedAt: 'a' }]
    expect(taskSnapshotKey(tasks)).toBe(taskSnapshotKey([...tasks]))
    expect(taskSnapshotKey(tasks)).not.toBe(taskSnapshotKey([{ ...tasks[0], progress: 21 }]))
  })

  it('detects a task leaving the active queue', () => {
    const previous = taskStatusMap([{ id: 'task-1', status: 'running' }])
    expect(hasTaskTerminalTransition(previous, [{ id: 'task-1', status: 'completed' }])).toBe(true)
    expect(hasTaskTerminalTransition(previous, [{ id: 'task-1', status: 'running' }])).toBe(false)
  })

  it('merges compact polling updates without dropping full task details', () => {
    const previous = [
      {
        id: 'task-1',
        prompt: '完整提示词',
        metadata: { shotId: 'shot-1', textResult: { script: '完整结果' } },
        outputs: [{ url: '/video.mp4' }],
        status: 'running',
        progress: 20,
      },
    ]
    const merged = mergeTaskPolling(previous, [
      { id: 'task-1', status: 'running', progress: 42, metadata: { textPreview: '预览' } },
    ])

    expect(merged[0]).toMatchObject({
      prompt: '完整提示词',
      status: 'running',
      progress: 42,
      metadata: { shotId: 'shot-1', textPreview: '预览', textResult: { script: '完整结果' } },
      outputs: [{ url: '/video.mp4' }],
    })
  })

  it('changes when workspace content changes', () => {
    const workspace = {
      project: { id: 'project-1', updatedAt: 'a', script: '旧内容' },
      scriptEpisodes: [],
      assets: [],
      shots: [],
    }
    expect(workspaceSnapshotKey(workspace)).not.toBe(
      workspaceSnapshotKey({ ...workspace, project: { ...workspace.project, script: '新内容' } }),
    )
  })

  it('matches the server workspace version projection without hashing full content', () => {
    const workspace = {
      project: { version: 3, updatedAt: '2026-08-03T12:00:00.000Z' },
      scriptEpisodes: [{ updatedAt: '2026-08-03T12:01:00.000Z' }],
      assets: [{ updatedAt: '2026-08-03T12:02:00.000Z' }],
      shots: [{ updatedAt: '2026-08-03T12:03:00.000Z' }],
    }

    expect(workspaceVersionKey(workspace)).toBe(
      '3:2026-08-03T12:00:00.000Z:1:2026-08-03T12:01:00.000Z:1:2026-08-03T12:02:00.000Z:1:2026-08-03T12:03:00.000Z',
    )
  })

  it('keeps long content out of the refresh key while detecting middle changes', () => {
    const script = '前置内容'.repeat(20_000)
    const workspace = {
      project: { id: 'project-1', updatedAt: 'a', script },
      scriptEpisodes: [],
      assets: [],
      shots: [],
    }
    const changedScript = `${script.slice(0, 30_000)}中间修改${script.slice(30_004)}`

    expect(workspaceSnapshotKey(workspace).length).toBeLessThan(1_000)
    expect(workspaceSnapshotKey(workspace)).not.toBe(
      workspaceSnapshotKey({ ...workspace, project: { ...workspace.project, script: changedScript } }),
    )
  })
})
