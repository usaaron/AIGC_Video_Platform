import { useCallback, useEffect, useRef, useState } from 'react'
import { hasNewCompletedAssetTasks } from '../generation/completedTaskSync'
import { api } from '../../services/apiClient'

export function useProjectTasks(projectId, { onCompletedAssetTasks } = {}) {
  const [tasks, setTasks] = useState([])
  const [taskPollError, setTaskPollError] = useState('')
  const [taskSyncMode, setTaskSyncMode] = useState('轮询同步')
  const syncedAssetTaskKeys = useRef(new Set())
  const taskPushActive = useRef(false)

  const refreshTasks = useCallback(async () => {
    if (!projectId) return
    const nextTasks = await api.tasks(projectId)
    setTasks(nextTasks)
    setTaskPollError('')
  }, [projectId])

  useEffect(() => {
    if (!projectId) return undefined
    let disposed = false
    taskPushActive.current = false
    setTaskSyncMode('轮询同步')

    const syncTasks = async (nextTasks, source = 'poll') => {
      if (disposed) return
      setTasks(nextTasks)
      setTaskPollError('')
      if (source === 'push') {
        taskPushActive.current = true
        setTaskSyncMode('实时推送')
      } else if (!taskPushActive.current) {
        setTaskSyncMode('轮询同步')
      }
      if (hasNewCompletedAssetTasks(nextTasks, syncedAssetTaskKeys.current)) {
        await onCompletedAssetTasks?.(projectId)
      }
    }

    const loadTasks = async (source = 'poll') => {
      try {
        const nextTasks = await api.tasks(projectId)
        await syncTasks(nextTasks, source)
      } catch (error) {
        if (!disposed) setTaskPollError(error.message || '生成状态同步失败')
      }
    }

    void loadTasks()
    const unsubscribe = api.subscribeTasks?.(
      projectId,
      (nextTasks) => {
        void syncTasks(nextTasks, 'push')
      },
      (error) => {
        if (!disposed) {
          taskPushActive.current = false
          setTaskSyncMode('轮询同步')
          setTaskPollError(error.message || '任务推送暂时不可用，已回退到轮询')
        }
      },
    )
    const timer = window.setInterval(() => void loadTasks('poll'), 1_500)
    return () => {
      disposed = true
      window.clearInterval(timer)
      unsubscribe?.()
    }
  }, [onCompletedAssetTasks, projectId])

  return {
    tasks,
    setTasks,
    taskPollError,
    taskSyncMode,
    refreshTasks,
  }
}
