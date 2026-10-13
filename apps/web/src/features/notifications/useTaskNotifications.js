import { useEffect, useRef, useState } from 'react'
import {
  clearNotificationDismissals,
  pruneNotificationDismissals,
  readNotificationDismissals,
  writeNotificationDismissals,
} from './notificationDismissals'
import { reconcileTaskNotifications } from './taskNotifications'

const TASK_STATUS_CACHE_KEY = 'seqora:task-status-cache'

function readTaskStatusCache() {
  try {
    const value = JSON.parse(window.localStorage.getItem(TASK_STATUS_CACHE_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function useTaskNotifications({ projects, recentTasks, recentTasksLoaded }) {
  const [notifications, setNotifications] = useState([])
  const [notificationPopups, setNotificationPopups] = useState([])
  const taskStatusesRef = useRef(null)
  const historyReadyRef = useRef(false)
  const dismissedIdsRef = useRef(null)
  // Ref arguments run on every render; read persisted history only on mount.
  if (taskStatusesRef.current === null) taskStatusesRef.current = readTaskStatusCache()
  if (dismissedIdsRef.current === null) dismissedIdsRef.current = readNotificationDismissals()

  useEffect(() => {
    if (!recentTasksLoaded) return
    if (!recentTasks.length) {
      taskStatusesRef.current = {}
      dismissedIdsRef.current = new Set()
      window.localStorage.setItem(TASK_STATUS_CACHE_KEY, '{}')
      clearNotificationDismissals()
      setNotifications([])
      historyReadyRef.current = true
      return
    }

    const recentIds = new Set(recentTasks.map((task) => task.id))
    const dismissedIds = pruneNotificationDismissals(dismissedIdsRef.current, recentIds)
    dismissedIdsRef.current = dismissedIds
    writeNotificationDismissals(dismissedIds)
    const result = reconcileTaskNotifications({
      recentTasks,
      projects,
      previousStatuses: taskStatusesRef.current,
      currentNotifications: notifications,
      dismissedIds,
      historyReady: historyReadyRef.current,
    })

    taskStatusesRef.current = result.nextStatuses
    window.localStorage.setItem(TASK_STATUS_CACHE_KEY, JSON.stringify(result.nextStatuses))
    setNotifications(result.notifications)
    if (result.popups.length) {
      setNotificationPopups((current) => [...result.popups, ...current].slice(0, 4))
    }
    historyReadyRef.current = true
  }, [projects, recentTasks, recentTasksLoaded])

  useEffect(() => {
    if (!notificationPopups.length) return undefined
    const nextExpiration = Math.min(...notificationPopups.map((item) => item.expiresAt))
    const timer = window.setTimeout(
      () => {
        const now = Date.now()
        setNotificationPopups((current) => current.filter((item) => item.expiresAt > now))
      },
      Math.max(0, nextExpiration - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [notificationPopups])

  const markNotificationRead = (notificationId) => {
    setNotifications((current) =>
      current.map((item) => (item.id === notificationId ? { ...item, read: true } : item)),
    )
  }

  const clearNotifications = () => {
    const dismissedIds = new Set(dismissedIdsRef.current)
    notifications.forEach((notification) => dismissedIds.add(notification.id))
    dismissedIdsRef.current = dismissedIds
    writeNotificationDismissals(dismissedIds)
    setNotifications([])
    setNotificationPopups([])
  }

  const dismissNotificationPopup = (notificationId) => {
    setNotificationPopups((current) => current.filter((item) => item.id !== notificationId))
  }

  return {
    notifications,
    notificationPopups,
    markNotificationRead,
    clearNotifications,
    dismissNotificationPopup,
  }
}
