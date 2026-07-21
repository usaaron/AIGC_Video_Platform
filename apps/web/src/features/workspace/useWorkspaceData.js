import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/apiClient'

export function useWorkspaceData({ adminOnly, refreshSession, setToast }) {
  const [projects, setProjects] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(true)

  const project = workspace?.project

  useEffect(() => {
    if (adminOnly) return
    Promise.all([api.projects(), api.billing()])
      .then(async ([projectList, billingSummary]) => {
        setProjects(projectList)
        setBilling(billingSummary)
        if (projectList[0]) setWorkspace(await api.project(projectList[0].id))
      })
      .catch((error) => setToast(error.message))
      .finally(() => setLoading(false))
  }, [adminOnly, setToast])

  const refreshWorkspace = useCallback(
    async (projectId = project?.id) => {
      if (!projectId) return
      const next = await api.project(projectId)
      setWorkspace(next)
      setProjects(await api.projects())
    },
    [project?.id],
  )

  const refreshBilling = useCallback(async () => {
    const next = await api.billing()
    setBilling(next)
    await refreshSession()
  }, [refreshSession])

  return {
    projects,
    workspace,
    project,
    billing,
    setBilling,
    loading,
    refreshWorkspace,
    refreshBilling,
  }
}
