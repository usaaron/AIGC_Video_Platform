import { useEffect } from 'react'
import { api } from '../../services/apiClient'

const ACTIVE_TASK_STATUSES = new Set(['queued', 'paused', 'running'])
const ACTIVE_TASK_POLL_MS = 2_500
const IDLE_TASK_POLL_MS = 12_000
const BACKGROUND_TASK_POLL_MS = 30_000

export function useWorkspacePolling({
  projectId,
  workspaceCacheRef,
  replaceTasks,
  setWorkspace,
  setBilling,
  setProjects,
  setRecentTasks,
  setRecentTasksLoaded,
}) {
  useEffect(() => {
    if (!projectId) return undefined
    let cancelled = false
    let requestInFlight = false
    let timer = null

    const schedule = (delay) => {
      if (cancelled) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void loadWorkspace(), delay)
    }
    const loadWorkspace = async () => {
      if (requestInFlight || cancelled) return
      requestInFlight = true
      let nextDelay = IDLE_TASK_POLL_MS
      try {
        const [nextTasks, nextWorkspace] = await Promise.all([api.tasks(projectId), api.project(projectId)])
        if (cancelled) return
        workspaceCacheRef.current.set(projectId, nextWorkspace)
        replaceTasks(projectId, nextTasks)
        setWorkspace(nextWorkspace)
        const hasActiveTasks = nextTasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status))
        nextDelay = hasActiveTasks ? ACTIVE_TASK_POLL_MS : IDLE_TASK_POLL_MS
        if (!hasActiveTasks) {
          void Promise.allSettled([api.billing(), api.projects(), api.recentTasks()]).then(
            ([billingResult, projectsResult, recentTasksResult]) => {
              if (cancelled) return
              if (billingResult.status === 'fulfilled') setBilling(billingResult.value)
              if (projectsResult.status === 'fulfilled') setProjects(projectsResult.value)
              if (recentTasksResult.status === 'fulfilled') {
                setRecentTasks(recentTasksResult.value)
                setRecentTasksLoaded(true)
              }
            },
          )
        }
      } catch {
        nextDelay = IDLE_TASK_POLL_MS
      } finally {
        requestInFlight = false
        schedule(document.hidden ? BACKGROUND_TASK_POLL_MS : nextDelay)
      }
    }
    const handleVisibilityChange = () => {
      window.clearTimeout(timer)
      if (document.hidden) schedule(BACKGROUND_TASK_POLL_MS)
      else void loadWorkspace()
    }

    void loadWorkspace()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    projectId,
    replaceTasks,
    setBilling,
    setProjects,
    setRecentTasks,
    setRecentTasksLoaded,
    setWorkspace,
    workspaceCacheRef,
  ])
}
