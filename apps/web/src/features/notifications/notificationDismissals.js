const NOTIFICATION_DISMISSALS_KEY = 'seqora:notification-dismissals'

export function readNotificationDismissals(storage = window.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(NOTIFICATION_DISMISSALS_KEY) || '[]')
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeNotificationDismissals(ids, storage = window.localStorage) {
  storage.setItem(NOTIFICATION_DISMISSALS_KEY, JSON.stringify([...ids].slice(-100)))
}

export function clearNotificationDismissals(storage = window.localStorage) {
  storage.removeItem(NOTIFICATION_DISMISSALS_KEY)
}

export function pruneNotificationDismissals(ids, availableIds) {
  return new Set([...ids].filter((id) => availableIds.has(id)))
}
