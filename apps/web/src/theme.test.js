import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTheme, initializeTheme, readTheme, setTheme, subscribeTheme, THEME_STORAGE_KEY } from './theme'

afterEach(() => vi.unstubAllGlobals())

describe('workspace theme', () => {
  it('defaults to dark when storage is absent, corrupt or blocked', () => {
    expect(readTheme()).toBe('dark')
    expect(readTheme({ getItem: () => 'unknown' })).toBe('dark')
    expect(
      readTheme({
        getItem: () => {
          throw new Error('storage blocked')
        },
      }),
    ).toBe('dark')
  })

  it('restores light mode before mounting and persists subsequent switches', () => {
    const dataset = {}
    const storage = { getItem: () => 'light', setItem: vi.fn() }
    vi.stubGlobal('document', { documentElement: { dataset } })
    vi.stubGlobal('window', { localStorage: storage })
    expect(initializeTheme()).toBe('light')
    expect(dataset.theme).toBe('light')
    setTheme('dark')
    expect(dataset.theme).toBe('dark')
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark')
  })

  it('switches in memory even when persistence fails', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('storage blocked')
      },
    })
    expect(initializeTheme()).toBe('dark')
    expect(setTheme('light')).toBe('light')
    expect(getTheme()).toBe('light')
  })

  it('updates subscribers for theme changes in another tab and cleans up', () => {
    let storageListener
    const removeEventListener = vi.fn()
    vi.stubGlobal('window', {
      addEventListener: (_, listener) => {
        storageListener = listener
      },
      removeEventListener,
    })
    const listener = vi.fn()
    const unsubscribe = subscribeTheme(listener)
    storageListener({ key: THEME_STORAGE_KEY, newValue: 'light' })
    expect(getTheme()).toBe('light')
    expect(listener).toHaveBeenCalledOnce()
    storageListener({ key: 'other-setting', newValue: 'dark' })
    expect(getTheme()).toBe('light')
    storageListener({ key: THEME_STORAGE_KEY, newValue: null })
    expect(getTheme()).toBe('dark')
    unsubscribe()
    expect(removeEventListener).toHaveBeenCalledWith('storage', storageListener)
  })
})
