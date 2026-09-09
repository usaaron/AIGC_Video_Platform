import { Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { getServerTheme, getTheme, setTheme, subscribeTheme } from '../theme'

export function ThemeToggle({ className = '' }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme)
  const label = theme === 'dark' ? '切换浅色模式' : '切换深色模式'
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      title={label}
      aria-label={label}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
