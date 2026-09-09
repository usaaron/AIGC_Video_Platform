export const THEME_STORAGE_KEY = 'seqora.theme'

let currentTheme = 'dark'
const listeners = new Set()

export function readTheme(storage) {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark'
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = currentTheme
  for (const listener of listeners) listener()
  return currentTheme
}

export function initializeTheme() {
  try {
    return applyTheme(readTheme(window.localStorage))
  } catch {
    return applyTheme('dark')
  }
}

export function getTheme() {
  return currentTheme
}

export function getServerTheme() {
  return 'dark'
}

export function setTheme(theme) {
  const nextTheme = applyTheme(theme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
  } catch {
    // Private browsing may deny storage; the current session can still switch.
  }
  return nextTheme
}

function syncStoredTheme(event) {
  if (event.key === THEME_STORAGE_KEY || event.key === null) {
    applyTheme(event.newValue === 'light' ? 'light' : 'dark')
  }
}

export function subscribeTheme(listener) {
  if (!listeners.size && typeof window !== 'undefined') {
    window.addEventListener('storage', syncStoredTheme)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && typeof window !== 'undefined') {
      window.removeEventListener('storage', syncStoredTheme)
    }
  }
}
