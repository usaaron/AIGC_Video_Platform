import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hookState, mountHook, resetHookHarness } from '../../testSupport/hookHarness'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal()),
  ...(await import('../../testSupport/hookHarness')).mockReactHooks,
}))

import { useTaskNotifications } from './useTaskNotifications'

const projects = [{ id: 'project-one', name: '项目' }]
const task = (id, status = 'running') => ({
  id,
  projectId: 'project-one',
  kind: 'text',
  status,
  label: '生成任务',
  updatedAt: new Date().toISOString(),
})

function mountWithTasks(ids = ['one']) {
  return mountHook(useTaskNotifications, {
    projects,
    recentTasks: ids.map((id) => task(id)),
    recentTasksLoaded: true,
  })
}

beforeEach(() => {
  resetHookHarness()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T08:00:00Z'))
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  })
})

afterEach(() => {
  resetHookHarness()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('notification work scheduling', () => {
  it('reads persisted history only once across unrelated application renders', () => {
    const app = mountWithTasks()
    for (let index = 0; index < 30; index += 1) app.render()
    expect(window.localStorage.getItem).toHaveBeenCalledTimes(2)
  })

  it('does no state work until a popup actually expires', () => {
    const app = mountWithTasks()
    app.render({ recentTasks: [task('one', 'completed')] })
    expect(app.value.notificationPopups).toHaveLength(1)
    const updates = hookState.stateUpdates
    vi.advanceTimersByTime(14_999)
    expect(hookState.stateUpdates).toBe(updates)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1)
    app.render()
    expect(hookState.stateUpdates - updates).toBe(1)
    expect(app.value.notificationPopups).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reschedules expiry when a full popup queue replaces its oldest item', () => {
    const app = mountWithTasks(['one', 'two', 'three', 'four', 'five'])
    app.render({ recentTasks: ['one', 'two', 'three', 'four'].map((id) => task(id, 'completed')) })
    vi.advanceTimersByTime(5_000)
    app.render({
      recentTasks: ['one', 'two', 'three', 'four', 'five'].map((id) => task(id, 'completed')),
    })
    expect(app.value.notificationPopups).toHaveLength(4)
    vi.advanceTimersByTime(10_000)
    app.render()
    expect(app.value.notificationPopups.map((item) => item.id)).toEqual(['five'])
    vi.advanceTimersByTime(5_000)
    app.render()
    expect(app.value.notificationPopups).toEqual([])
  })

  it('cleans up timers on clear and on unmount', () => {
    const app = mountWithTasks()
    app.render({ recentTasks: [task('one', 'completed')] })
    app.value.clearNotifications()
    app.render()
    expect(vi.getTimerCount()).toBe(0)
    app.render({ recentTasks: [task('two', 'completed')] })
    expect(vi.getTimerCount()).toBe(1)
    app.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['null', '[]', '"invalid"'])('ignores malformed persisted status data %s', (value) => {
    window.localStorage.getItem.mockReturnValue(value)
    const app = mountWithTasks()
    app.render({ recentTasks: [task('one', 'completed')] })
    expect(app.value.notificationPopups).toHaveLength(1)
    expect(window.localStorage.getItem).toHaveBeenCalledTimes(2)
  })
})
