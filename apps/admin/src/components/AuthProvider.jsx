import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../services/apiClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (credentials) => {
    const nextSession = await api.login(credentials)
    setSession(nextSession)
    return nextSession
  }

  const logout = async () => {
    await api.logout()
    setSession(null)
  }

  return <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
