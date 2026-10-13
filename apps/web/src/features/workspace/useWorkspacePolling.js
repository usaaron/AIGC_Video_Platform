import { useEffect } from 'react'
import { api } from '../../services/apiClient'
import {
  hasTaskTerminalTransition,
  mergeTaskPolling,
  taskSnapshotKey,
  taskPollingNeedsDetailRefresh,
  taskStatusMap,
  workspaceSnapshotKey,
  workspaceVersionKey,
} from './workspaceRefreshState'
import {
  isActiveWorkspaceProject,
  normalizeTaskPolling,
  normalizeTasks,
  normalizeWorkspace,
} from './workspaceLoadingPolicy'

const ACTIVE_TASK_STATUSES = new Set(['queued', 'paused', 'running'])
const ACTIVE_TASK_POLL_MS = 2_500
const IDLE_TASK_POLL_MS = 12_000
const BACKGROUND_TASK_POLL_MS = 30_000
const ACTIVE_WORKSPACE_VERSION_CHECK_MS = 10_000
const IDLE_WORKSPACE_VERSION_CHECK_MS = 30_000
const AUXILIARY_REFRESH_MS = 60_000

export function useWorkspacePolling({
  projectId,
  includeRecentActivity = false,
  includeTaskDetails = false,
  workspaceCacheRef,
  activeProjectIdRef,
  replaceTasks,
  setWorkspace,
  setBilling,
  setProjects,
  setRecentTasks,
  setRecentTasksLoaded,
  onWorkspaceError,
  onWorkspaceReady,
}) {
  useEffect(() => {
    if (!projectId && !includeRecentActivity) return undefined
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

    const isCurrentProject = () =>
      !projectId || isActiveWorkspaceProject(activeProjectIdRef?.current, projectId)

    const refreshRecentActivity = async ({ includeProjects = true } = {}) => {
      const [billingResult, recentTasksResult, projectsResult] = await Promise.allSettled([
        api.billing(),
        api.recentTasks(),
        ...(includeProjects ? [api.projects()] : []),
      ])
      if (cancelled || !isCurrentProject()) return
      if (billingResult.status === 'fulfilled') setBilling(billingResult.value)
      if (projectsResult?.status === 'fulfilled') setProjects(projectsResult.value)
      if (recentTasksResult.status === 'fulfilled') {
        setRecentTasks(normalizeTasks(recentTasksResult.value))
        setRecentTasksLoaded(true)
      }
    }

    const loadInitialTasks = async () => {
      if (includeTaskDetails) return normalizeTasks(await api.tasks(projectId))
      try {
        const result = await api.pollTasks(projectId)
        taskPollingEtag = result?.etag || null
        return normalizeTaskPolling(result?.tasks)
      } catch (error) {
        // Older API instances may not expose the compact polling endpoint yet.
        if (error?.status !== 404) throw error
        return normalizeTasks(await api.tasks(projectId))
      }
    }

    const schedule = (delay) => {
      if (cancelled) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void loadWorkspace(), delay)
    }
    const loadWorkspace = async () => {
      if (requestInFlight || cancelled || !isCurrentProject()) return
      requestInFlight = true
      let nextDelay = IDLE_TASK_POLL_MS
      try {
        if (!projectId) {
          // Standalone tools keep account notifications without loading the
          // previously selected host project's workspace or generation tasks.
          nextDelay = AUXILIARY_REFRESH_MS
          await refreshRecentActivity({ includeProjects: false })
          return
        }
        let nextTasks
        let nextWorkspace = null
        let taskFinished = false
        if (!initialized) {
          if (workspaceCacheRef.current.has(projectId)) {
            nextTasks = await loadInitialTasks()
          } else {
            // A stuck task poll must not prevent the project itself from opening.
            const [tasksResult, workspaceResult] = await Promise.allSettled([
              loadInitialTasks(),
              api.project(projectId),
            ])
            if (cancelled || !isCurrentProject()) return
            if (workspaceResult.status === 'rejected') {
              onWorkspaceError?.(projectId, workspaceResult.reason)
              throw workspaceResult.reason
            }
            nextTasks = tasksResult.status === 'fulfilled' ? normalizeTasks(tasksResult.value) : []
            nextWorkspace = normalizeOrThrow(workspaceResult.value)
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
            nextTasks = normalizeTasks(await api.tasks(projectId))
          }
          if (pollResult) {
            taskPollingEtag = pollResult.etag || taskPollingEtag
            if (pollResult.notModified) {
              nextTasks = currentTasks
            } else {
              const summaries = normalizeTaskPolling(pollResult.tasks)
              taskFinished = hasTaskTerminalTransition(previousTaskStatuses, summaries)
              const needsFullRefresh = taskPollingNeedsDetailRefresh(
                currentTasks,
                summaries,
                includeTaskDetails,
                taskFinished,
              )
              nextTasks =
                includeTaskDetails && needsFullRefresh
                  ? normalizeTasks(await api.tasks(projectId))
                  : mergeTaskPolling(currentTasks, summaries)
            }
          }
        }
        if (cancelled || !isCurrentProject()) return
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
              if (cancelled || !isCurrentProject()) return
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
        // The initial parallel request already loaded the workspace. Do not issue
        // a second detail request before caching that successful response.
        const refreshWorkspace =
          !nextWorkspace && (!workspaceCacheRef.current.has(projectId) || taskFinished || workspaceChanged)
        if (refreshWorkspace) {
          try {
            nextWorkspace = normalizeOrThrow(await api.project(projectId))
          } catch (error) {
            if (!cancelled && isCurrentProject()) onWorkspaceError?.(projectId, error)
            throw error
          }
          if (cancelled || !isCurrentProject()) return
        }
        if (cancelled || !isCurrentProject()) return
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
          onWorkspaceReady?.(projectId)
        }
        previousTaskStatuses = taskStatusMap(nextTasks)
        nextDelay = hasActiveTasks ? ACTIVE_TASK_POLL_MS : IDLE_TASK_POLL_MS
        if (!hasActiveTasks && (now - lastAuxiliaryRefreshAt >= AUXILIARY_REFRESH_MS || taskFinished)) {
          lastAuxiliaryRefreshAt = now
          void refreshRecentActivity()
        }
      } catch {
        nextDelay = IDLE_TASK_POLL_MS
      } finally {
        requestInFlight = false
        schedule(document.hidden ? Math.max(BACKGROUND_TASK_POLL_MS, nextDelay) : nextDelay)
      }
    }
    const handleVisibilityChange = () => {
      window.clearTimeout(timer)
      if (document.hidden) schedule(projectId ? BACKGROUND_TASK_POLL_MS : AUXILIARY_REFRESH_MS)
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
    includeRecentActivity,
    includeTaskDetails,
    projectId,
    replaceTasks,
    setBilling,
    setProjects,
    setRecentTasks,
    setRecentTasksLoaded,
    setWorkspace,
    workspaceCacheRef,
    onWorkspaceError,
    onWorkspaceReady,
  ])
}

function normalizeOrThrow(workspace) {
  const normalized = normalizeWorkspace(workspace)
  if (!normalized) throw new Error('项目数据格式异常，请重新打开项目。')
  return normalized
}
