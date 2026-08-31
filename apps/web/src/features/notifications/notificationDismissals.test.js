import { describe, expect, it } from 'vitest'
import {
  clearNotificationDismissals,
  pruneNotificationDismissals,
  readNotificationDismissals,
  writeNotificationDismissals,
} from './notificationDismissals'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('notification dismissals', () => {
  it('persists cleared notification ids without restoring old task messages', () => {
    const storage = memoryStorage()
    writeNotificationDismissals(new Set(['task-1', 'task-2']), storage)
    expect([...readNotificationDismissals(storage)]).toEqual(['task-1', 'task-2'])
  })

  it('keeps only ids that still exist in recent task history', () => {
    expect([
      ...pruneNotificationDismissals(new Set(['task-1', 'task-2']), new Set(['task-2', 'task-3'])),
    ]).toEqual(['task-2'])
  })

  it('recovers from corrupt storage and supports clearing', () => {
    const storage = memoryStorage({ 'seqora:notification-dismissals': '{' })
    expect(readNotificationDismissals(storage).size).toBe(0)
    writeNotificationDismissals(new Set(['task-1']), storage)
    clearNotificationDismissals(storage)
    expect(readNotificationDismissals(storage).size).toBe(0)
  })
})
