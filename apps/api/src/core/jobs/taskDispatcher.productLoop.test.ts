import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it } from 'vitest'
import type { AudioGenerationProvider } from '../generation/audioProvider.js'
import type { FilmExporter, FilmExportResult } from '../generation/filmExporter.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { StoredMedia } from '../../infra/store.js'
import { AppStore } from '../../infra/store.js'
import { GeneratedAssetWriter } from './generatedAssetWriter.js'
import { GenerationTaskRunner } from './taskDispatcher.js'

class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { content: Buffer; contentType: string }>()

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { content, contentType })
  }

  async get(key: string): Promise<Buffer> {
    const stored = this.objects.get(key)
    if (!stored) throw new Error(`Missing object: ${key}`)
    return stored.content
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

describe('GenerationTaskRunner product loop integrations', () => {
  it('materializes remote audio outputs and writes them back to the linked audio asset', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const storage = new MemoryObjectStorage()
    const provider: AudioGenerationProvider = {
      async submit() {
        return {
          providerTaskId: 'audio-provider-task',
          status: 'completed',
          progress: 100,
          outputs: [
            {
              id: 'remote-audio',
              url: 'https://assets.example/rain.mp3',
              mediaType: 'audio',
              view: 'single',
            },
          ],
        }
      },
      async getStatus() {
        return { status: 'completed', progress: 100, outputs: [], error: null }
      },
    }
    const task = taskFor({
      id: 'audio-task',
      kind: 'audio',
      provider: 'audio',
      label: 'Rain bed',
      metadata: { assetId: 'asset-rain', attributes: { type: 'audio', audioType: 'ambience' } },
    })
    await store.mutate((state) => state.tasks.unshift(task))

    const writer = new GeneratedAssetWriter(storage, async () => audioResponse())
    const runner = new GenerationTaskRunner(store, null, null, 0, writer, null, provider)

    await runner.tick()

    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    const media = await store.read((state) => state.media.find((item) => item.kind === 'audio'))
    const asset = await store.read((state) => state.assets.find((item) => item.id === 'asset-rain'))
    expect(stored?.status).toBe('completed')
    expect(stored?.outputs[0]).toMatchObject({ mediaType: 'audio', url: `/api/v1/media/${media?.id}` })
    expect(asset?.references[0]).toMatchObject({ url: `/api/v1/media/${media?.id}` })
    expect(storage.objects.size).toBe(1)
  })

  it('completes film-export tasks with platform media outputs', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const media: StoredMedia = {
      id: 'film-media',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      kind: 'video',
      name: 'film.mp4',
      contentType: 'video/mp4',
      size: 12,
      storageKey: 'tenant-seqora-demo/project-midnight-film/exports/film.mp4',
      createdAt: new Date().toISOString(),
    }
    const exporter: FilmExporter = {
      async export(): Promise<FilmExportResult> {
        return {
          outputs: [{ id: media.id, url: `/api/v1/media/${media.id}`, mediaType: 'video', view: 'single' }],
          media: [media],
        }
      },
    }
    const task = taskFor({
      id: 'film-export-task',
      kind: 'video',
      provider: 'film-export',
      label: 'Film export',
    })
    await store.mutate((state) => state.tasks.unshift(task))

    const runner = new GenerationTaskRunner(store, null, null, 0, null, null, null, exporter)
    await runner.tick()

    const stored = await store.read((state) => state.tasks.find((item) => item.id === task.id))
    expect(stored).toMatchObject({
      status: 'completed',
      resultUrl: '/api/v1/media/film-media',
      outputs: [{ id: 'film-media', url: '/api/v1/media/film-media', mediaType: 'video', view: 'single' }],
    })
  })

  it('regenerates one turnaround view without dropping the other source views', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const existingOutputs: GenerationTask['outputs'] = [
      { id: 'front-old', url: '/api/v1/media/front-old', mediaType: 'image', view: 'front' },
      { id: 'side-old', url: '/api/v1/media/side-old', mediaType: 'image', view: 'side' },
      { id: 'back-old', url: '/api/v1/media/back-old', mediaType: 'image', view: 'back' },
    ]
    const task = taskFor({
      id: 'side-regeneration-task',
      kind: 'image',
      provider: 'local',
      label: 'Side regeneration',
      metadata: {
        assetId: 'asset-lin',
        generationStage: 'turnaround',
        turnaround: true,
        outputViews: ['side'],
      },
      status: 'running',
      progress: 96,
    })
    await store.mutate((state) => {
      const asset = state.assets.find((item) => item.id === 'asset-lin')
      if (asset?.attributes.type === 'character') {
        asset.attributes.turnaround = true
        asset.attributes.turnaroundReferences = existingOutputs
      }
      state.tasks.unshift(task)
    })

    const runner = new GenerationTaskRunner(store, null, null, 0)
    await runner.tick()

    const asset = await store.read((state) => state.assets.find((item) => item.id === 'asset-lin'))
    expect(asset?.attributes.type).toBe('character')
    if (asset?.attributes.type !== 'character') return
    expect(asset.attributes.turnaroundReferences.map((output) => output.view)).toEqual([
      'front',
      'side',
      'back',
    ])
    expect(asset.attributes.turnaroundReferences[0]?.id).toBe('front-old')
    expect(asset.attributes.turnaroundReferences[1]?.id).toBe('side-regeneration-task-side')
    expect(asset.attributes.turnaroundReferences[2]?.id).toBe('back-old')
  })
})

function taskFor(overrides: Partial<GenerationTask>): GenerationTask {
  const now = new Date().toISOString()
  return {
    id: 'task',
    clientRequestId: `client-${overrides.id ?? 'task'}`,
    projectId: 'project-midnight-film',
    tenantId: 'tenant-seqora-demo',
    userId: 'user-creator',
    kind: 'image',
    label: 'Task',
    prompt: 'Generate media',
    negativePrompt: '',
    provider: 'local',
    model: null,
    metadata: {},
    status: 'queued',
    progress: 0,
    estimatedCredits: 1,
    createdAt: now,
    updatedAt: now,
    resultUrl: null,
    outputs: [],
    error: null,
    ...overrides,
  }
}

function audioResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'audio/mpeg' },
  })
}
