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
    return JSON.parse(window.localStorage.getItem(TASK_STATUS_CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

export function useTaskNotifications({ projects, recentTasks, recentTasksLoaded }) {
  const [notifications, setNotifications] = useState([])
  const [notificationPopups, setNotificationPopups] = useState([])
  const taskStatusesRef = useRef(readTaskStatusCache())
  const historyReadyRef = useRef(false)
  const dismissedIdsRef = useRef(readNotificationDismissals())

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
    const timer = window.setInterval(() => {
      const now = Date.now()
      setNotificationPopups((current) => current.filter((item) => item.expiresAt > now))
    }, 500)
    return () => window.clearInterval(timer)
  }, [notificationPopups.length])

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
