import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from './ImagePreviewModal'

const originalNavigator = globalThis.navigator

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  })
})

describe('copyTextToClipboard', () => {
  it('treats a successful clipboard write as copied even when readback is unavailable', async () => {
    const writeText = vi.fn(async () => undefined)
    const readText = vi.fn(async () => '')

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          writeText,
          readText,
        },
      },
      configurable: true,
    })

    await expect(copyTextToClipboard('final prompt')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('final prompt')
  })
})
