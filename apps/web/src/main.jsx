import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider, useAuth } from './components/AuthProvider.jsx'
import { LoginPage } from './pages/LoginPage.jsx'

function Root() {
  const { session, loading } = useAuth()
  if (loading)
    return (
      <div className="app-loading">
        <span className="brand-mark">序</span>
        <p>正在准备工作台…</p>
      </div>
    )
  return session ? <App /> : <LoginPage />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>,
)
