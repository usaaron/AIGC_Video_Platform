import { vi } from 'vitest'
import type { VideoGenerationProvider } from '../core/generation/videoProvider.js'

export function testVideoProvider(): VideoGenerationProvider {
  return {
    submit: vi.fn(async () => ({
      providerTaskId: 'test-video-task',
      status: 'queued' as const,
      progress: 0,
    })),
    getStatus: vi.fn(async () => ({ status: 'running' as const, progress: 0, error: null })),
    getContent: vi.fn(),
  }
}
