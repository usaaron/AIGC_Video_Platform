import { describe, expect, it, vi } from 'vitest'
import { AideosAudioProvider } from './aideosAudioProvider.js'

describe('AideosAudioProvider', () => {
  it('submits audio generation requests with audio metadata', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: 'audio-task-1',
        status: 'queued',
        progress: 3,
      }),
    )
    const provider = new AideosAudioProvider({
      baseUrl: 'https://aideos.example/',
      apiKey: 'secret',
      defaultModel: 'audio-model',
      requestTimeoutMs: 30_000,
      fetcher,
    })

    await expect(
      provider.submit({
        taskId: 'local-task',
        assetId: 'asset-rain',
        model: null,
        prompt: 'Rain ambience',
        negativePrompt: '',
        duration: 12,
        audioType: 'ambience',
        loop: true,
        attributes: {
          type: 'audio',
          audioType: 'ambience',
          gender: 'unspecified',
          ageGroup: 'young',
          emotion: 'neutral',
          tone: 'warm',
          speed: 'normal',
          language: 'none',
          duration: 12,
          loop: true,
        },
      }),
    ).resolves.toMatchObject({ providerTaskId: 'audio-task-1', status: 'queued', progress: 3 })

    expect(fetcher).toHaveBeenCalledWith(
      'https://aideos.example/v1/audio/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    )
    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(payload).toMatchObject({
      model: 'audio-model',
      prompt: 'Rain ambience',
      duration: 12,
      audio_type: 'ambience',
      loop: true,
      metadata: { task_id: 'local-task', asset_id: 'asset-rain' },
    })
  })

  it('maps immediate audio URLs into completed outputs', async () => {
    const provider = new AideosAudioProvider({
      baseUrl: 'https://aideos.example',
      apiKey: 'secret',
      defaultModel: 'audio-model',
      requestTimeoutMs: 30_000,
      fetcher: async () =>
        jsonResponse({
          id: 'audio-task-2',
          status: 'completed',
          outputs: [{ audio_url: 'https://assets.example/audio.mp3' }],
        }),
    })

    await expect(
      provider.submit({
        taskId: 'local-task',
        assetId: 'asset-rain',
        model: 'custom-audio',
        prompt: 'Train pass by',
        negativePrompt: '',
        duration: 8,
        audioType: 'sfx',
        loop: false,
        attributes: null,
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      progress: 100,
      outputs: [
        {
          url: 'https://assets.example/audio.mp3',
          mediaType: 'audio',
          view: 'single',
        },
      ],
    })
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
