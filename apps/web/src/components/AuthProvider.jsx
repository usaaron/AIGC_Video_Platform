import { createContext, useContext, useEffect, useState } from 'react'
import { api, AUTH_EXPIRED_EVENT } from '../services/apiClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const expireSession = () => setSession(null)
    window.addEventListener(AUTH_EXPIRED_EVENT, expireSession)
    api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession)
  }, [])

  const login = async (credentials) => {
    const nextSession = await api.login(credentials)
    setSession(nextSession)
    return nextSession
  }

  const register = async (input) => {
    const nextSession = await api.register(input)
    setSession(nextSession)
    return nextSession
  }

  const logout = async () => {
    await api.logout()
    setSession(null)
  }

  const refresh = async () => {
    const nextSession = await api.session()
    setSession(nextSession)
    return nextSession
  }

  return (
    <AuthContext.Provider value={{ session, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
