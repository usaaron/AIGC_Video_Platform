import { useEffect } from 'react'
import { api } from '../../services/apiClient'
import {
  hasTaskTerminalTransition,
  mergeTaskPolling,
  taskSnapshotKey,
  taskStatusMap,
  workspaceSnapshotKey,
  workspaceVersionKey,
} from './workspaceRefreshState'

const ACTIVE_TASK_STATUSES = new Set(['queued', 'paused', 'running'])
const ACTIVE_TASK_POLL_MS = 2_500
const IDLE_TASK_POLL_MS = 12_000
const BACKGROUND_TASK_POLL_MS = 30_000
const ACTIVE_WORKSPACE_VERSION_CHECK_MS = 10_000
const IDLE_WORKSPACE_VERSION_CHECK_MS = 30_000
const AUXILIARY_REFRESH_MS = 60_000

export function useWorkspacePolling({
  projectId,
  includeTaskDetails = false,
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
    let lastWorkspaceVersionCheckAt = 0
    let lastAuxiliaryRefreshAt = 0
    let previousTaskKey = ''
    let previousWorkspaceKey = ''
    let previousTaskStatuses = new Map()
    let currentTasks = []
    let taskPollingEtag = null
    let workspaceVersionEtag = null
    let initialized = false

    const loadInitialTasks = async () => {
      if (includeTaskDetails) return api.tasks(projectId)
      try {
        const result = await api.pollTasks(projectId)
        taskPollingEtag = result.etag || null
        return result.tasks || []
      } catch (error) {
        // Older API instances may not expose the compact polling endpoint yet.
        if (error?.status !== 404) throw error
        return api.tasks(projectId)
      }
    }

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
        let nextTasks
        let nextWorkspace = null
        let taskFinished = false
        if (!initialized) {
          if (workspaceCacheRef.current.has(projectId)) {
            nextTasks = await loadInitialTasks()
          } else {
            const initialData = await Promise.all([loadInitialTasks(), api.project(projectId)])
            nextTasks = initialData[0]
            nextWorkspace = initialData[1]
          }
          initialized = true
        } else {
          let pollResult
          try {
            pollResult = await api.pollTasks(projectId, taskPollingEtag)
          } catch (error) {
            // Keep rolling deployments compatible while the API is upgraded first.
            if (error?.status !== 404) throw error
            taskPollingEtag = null
            nextTasks = await api.tasks(projectId)
          }
          if (pollResult) {
            taskPollingEtag = pollResult.etag || taskPollingEtag
            if (pollResult.notModified) {
              nextTasks = currentTasks
            } else {
              const summaries = pollResult.tasks || []
              taskFinished = hasTaskTerminalTransition(previousTaskStatuses, summaries)
              const previousById = new Map(currentTasks.map((task) => [task.id, task]))
              const needsFullRefresh = summaries.some(
                (summary) =>
                  !previousById.has(summary.id) ||
                  (taskFinished && ['completed', 'failed', 'cancelled'].includes(summary.status)),
              )
              nextTasks =
                includeTaskDetails && needsFullRefresh
                  ? await api.tasks(projectId)
                  : mergeTaskPolling(currentTasks, summaries)
            }
          }
        }
        if (cancelled) return
        const now = Date.now()
        const hasActiveTasks = nextTasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status))
        taskFinished ||= hasTaskTerminalTransition(previousTaskStatuses, nextTasks)
        let workspaceChanged = false
        if (workspaceCacheRef.current.has(projectId) && !taskFinished) {
          const workspaceVersionCheckMs = hasActiveTasks
            ? ACTIVE_WORKSPACE_VERSION_CHECK_MS
            : IDLE_WORKSPACE_VERSION_CHECK_MS
          if (now - lastWorkspaceVersionCheckAt >= workspaceVersionCheckMs) {
            lastWorkspaceVersionCheckAt = now
            try {
              const versionResult = await api.pollWorkspaceVersion(projectId, workspaceVersionEtag)
              workspaceVersionEtag = versionResult.etag || workspaceVersionEtag
              workspaceChanged =
                !versionResult.notModified &&
                versionResult.value?.version !== workspaceVersionKey(workspaceCacheRef.current.get(projectId))
            } catch (error) {
              // Keep older API deployments usable while the version probe rolls out.
              if (error?.status !== 404) throw error
              workspaceChanged = true
            }
          }
        }
        const refreshWorkspace = !workspaceCacheRef.current.has(projectId) || taskFinished || workspaceChanged
        nextWorkspace ||= refreshWorkspace ? await api.project(projectId) : null
        const nextTaskKey = taskSnapshotKey(nextTasks)
        if (nextTaskKey !== previousTaskKey) {
          replaceTasks(projectId, nextTasks)
          previousTaskKey = nextTaskKey
        }
        currentTasks = nextTasks
        if (nextWorkspace) {
          workspaceCacheRef.current.set(projectId, nextWorkspace)
          const nextWorkspaceKey = workspaceSnapshotKey(nextWorkspace)
          if (nextWorkspaceKey !== previousWorkspaceKey) {
            setWorkspace(nextWorkspace)
            previousWorkspaceKey = nextWorkspaceKey
          }
        }
        previousTaskStatuses = taskStatusMap(nextTasks)
        nextDelay = hasActiveTasks ? ACTIVE_TASK_POLL_MS : IDLE_TASK_POLL_MS
        if (!hasActiveTasks && (now - lastAuxiliaryRefreshAt >= AUXILIARY_REFRESH_MS || taskFinished)) {
          lastAuxiliaryRefreshAt = now
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
    includeTaskDetails,
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
