import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider, useAuth } from './components/AuthProvider.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { EmailVerificationPage } from './pages/EmailVerificationPage.jsx'
import { PasswordResetPage } from './pages/PasswordResetPage.jsx'

const App = lazy(() => import('./App.jsx'))

function Root() {
  const { session, loading } = useAuth()
  const path = window.location.pathname
  if (path === '/verify-email') return <EmailVerificationPage />
  if (path === '/reset-password') return <PasswordResetPage />
  if (loading)
    return (
      <div className="app-loading">
        <span className="bootstrap-mark">序</span>
        <p>正在准备工作台…</p>
      </div>
    )
  return session ? (
    <Suspense
      fallback={
        <div className="app-loading">
          <span className="bootstrap-mark">序</span>
          <p>正在进入工作台…</p>
        </div>
      }
    >
      <App />
    </Suspense>
  ) : (
    <LoginPage />
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>,
)
