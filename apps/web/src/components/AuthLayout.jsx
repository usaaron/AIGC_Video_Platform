import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'
import '../pages/LoginPage.css'

export function AuthLayout({ children, cinematic = false }) {
  const [paused, setPaused] = useState(false)

  return (
    <main className={`login-page${cinematic ? ' is-cinematic' : ''}${paused ? ' is-paused' : ''}`}>
      {cinematic && (
        <div className="auth-cinematic-background" aria-hidden="true">
          <img
            className="auth-photo auth-photo-alpine"
            src="/studio/alpine.jpg"
            alt=""
            fetchPriority="high"
          />
          <img className="auth-photo auth-photo-forest" src="/studio/forest.jpg" alt="" />
        </div>
      )}
      <header className="auth-topbar">
        <a className="auth-brand" href="/" aria-label="序幕TV 首页">
          <BrandMark />
          <span>序幕TV</span>
        </a>
        <ThemeToggle className="auth-theme-toggle" />
      </header>
      <section className="login-panel">{children}</section>
      <footer className="auth-footer">
        <span className="auth-signature">序幕TV</span>
        {cinematic && (
          <button
            className="auth-motion-toggle"
            type="button"
            aria-label={paused ? '播放背景动画' : '暂停背景动画'}
            title={paused ? '播放背景动画' : '暂停背景动画'}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        )}
      </footer>
    </main>
  )
}
