import { useCallback, useState } from 'react'
import { api } from '../../services/apiClient'

export function useAccountScope({ refreshSession, setWorkspace, setTasks, setActiveStep, setLoadAttempt }) {
  const [organizations, setOrganizations] = useState([])
  const [sessions, setSessions] = useState([])

  const load = useCallback(async () => {
    const [organizationsResult, sessionsResult] = await Promise.allSettled([
      api.organizations(),
      api.authSessions(),
    ])
    const nextOrganizations = organizationsResult.status === 'fulfilled' ? organizationsResult.value : []
    const nextSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : []
    setOrganizations(nextOrganizations)
    setSessions(nextSessions)

    const failedSections = [
      organizationsResult.status === 'rejected' ? '数据范围' : null,
      sessionsResult.status === 'rejected' ? '登录设备' : null,
    ].filter(Boolean)
    if (failedSections.length) {
      throw new Error(`${failedSections.join('、')}暂时无法同步，请稍后刷新。`)
    }
    return { organizations: nextOrganizations, sessions: nextSessions }
  }, [])

  const switchOrganization = useCallback(
    async (organizationId) => {
      await api.switchOrganization(organizationId)
      await refreshSession()
      setWorkspace(null)
      setTasks([])
      setActiveStep('home')
      setLoadAttempt((attempt) => attempt + 1)
    },
    [refreshSession, setActiveStep, setLoadAttempt, setTasks, setWorkspace],
  )

  const revokeSession = useCallback(async (sessionId) => {
    await api.revokeAuthSession(sessionId)
    setSessions(await api.authSessions())
  }, [])

  const inviteOrganizationMember = useCallback(async (organizationId, email) => {
    return await api.createOrganizationInvitation(organizationId, {
      email,
      roles: ['organization_member'],
    })
  }, [])

  return {
    organizations,
    sessions,
    load,
    switchOrganization,
    revokeSession,
    inviteOrganizationMember,
  }
}
