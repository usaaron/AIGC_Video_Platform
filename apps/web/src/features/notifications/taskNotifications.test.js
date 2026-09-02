import { describe, expect, it } from 'vitest'
import { createTaskNotification, reconcileTaskNotifications, retryTaskInput } from './taskNotifications'

const completedTask = {
  id: 'task-1',
  projectId: 'project-1',
  kind: 'text',
  label: '生成本集',
  status: 'completed',
  updatedAt: '2026-09-03T00:00:00.000Z',
  metadata: { textResult: 'done', operation: 'generate' },
}

describe('task notifications', () => {
  it('marks an active task completion as unread and creates a popup', () => {
    const result = reconcileTaskNotifications({
      recentTasks: [completedTask],
      projects: [{ id: 'project-1', name: '演示项目' }],
      previousStatuses: { 'task-1': 'running' },
      currentNotifications: [],
      dismissedIds: new Set(),
      historyReady: true,
      now: Date.parse('2026-09-03T00:00:05.000Z'),
    })

    expect(result.nextStatuses).toEqual({ 'task-1': 'completed' })
    expect(result.notifications[0]).toMatchObject({ read: false, projectName: '演示项目', target: 'script' })
    expect(result.popups).toHaveLength(1)
  })

  it('loads historical completions as read without showing a popup', () => {
    const result = reconcileTaskNotifications({
      recentTasks: [completedTask],
      projects: [],
      previousStatuses: {},
      currentNotifications: [],
      dismissedIds: new Set(),
      historyReady: false,
      now: Date.parse('2026-09-03T00:00:05.000Z'),
    })

    expect(result.notifications[0]).toMatchObject({ read: true, projectName: '项目' })
    expect(result.popups).toEqual([])
  })

  it('routes trusted portrait failures back to assets', () => {
    expect(
      createTaskNotification(
        {
          ...completedTask,
          status: 'failed',
          error: '上游失败',
          metadata: { generationStage: 'trusted-portrait' },
        },
        [],
        false,
      ),
    ).toMatchObject({ status: 'failed', title: '人像资源创建失败', target: 'assets', message: '上游失败' })
  })

  it('removes stale provider state before retrying a task', () => {
    const input = retryTaskInput({
      ...completedTask,
      prompt: '提示词',
      provider: 'text',
      estimatedCredits: 6,
      maxAttempts: 2,
      metadata: { providerTaskId: 'old', textResult: 'old result', operation: 'generate' },
    })

    expect(input.clientRequestId).toBeTruthy()
    expect(input.metadata).toEqual({ operation: 'generate' })
  })
})
