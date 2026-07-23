import { describe, expect, it } from 'vitest'
import { projectRatioMode } from './projectRatio'

describe('projectRatioMode', () => {
  it.each([
    ['9:16', 'portrait'],
    ['16:9', 'landscape'],
    ['1:1', 'square'],
  ])('maps %s projects to the %s preview layout', (aspectRatio, expected) => {
    expect(projectRatioMode(aspectRatio)).toBe(expected)
  })

  it('uses a safe landscape fallback for legacy projects', () => {
    expect(projectRatioMode('invalid')).toBe('landscape')
  })
})
