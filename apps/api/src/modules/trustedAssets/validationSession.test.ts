import type { Asset } from '@seqora/contracts'
import type {
  AssetLibraryProvider,
  ProviderPortrait,
} from '../../core/generation/volcArkAssetLibraryProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { describe, expect, it } from 'vitest'
import { TrustedAssetService } from './service.js'
import { TrustedValidationSessionRepository } from './validationSessionRepository.js'

describe('TrustedAssetService Dora validation sessions', () => {
  it('does not expose the provider token and writes the authorized portrait after validation', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const storage = new MemoryStorage()
    await storage.put('face/source.png', Buffer.from('face'), 'image/png')
    const now = new Date().toISOString()
    const asset = {
      id: 'character-validation',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      kind: 'character',
      sourceMode: 'generate',
      name: '演员甲',
      description: '真人角色',
      prompt: '',
      promptMode: 'standard',
      customPromptMode: 'append',
      customPrompt: '',
      negativePrompt: '',
      references: [],
      attributes: {
        ...defaultAssetAttributes('character'),
        faceStatus: 'approved',
        faceReference: { id: 'media-face', url: '/api/v1/media/media-face' },
      },
      imageUrl: null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    } as unknown as Asset
    await store.mutate((state) => {
      state.assets.push(asset)
      state.media.push({
        id: 'media-face',
        projectId: asset.projectId,
        tenantId: asset.tenantId,
        kind: 'image',
        name: 'face.png',
        contentType: 'image/png',
        size: 4,
        storageKey: 'face/source.png',
        createdAt: now,
      })
    })

    const authorizedPortrait: ProviderPortrait = {
      assetId: 'dora-live-asset',
      groupId: 'dora-live-group',
      groupType: 'LivenessFace',
      name: '演员甲-真人面部基准',
      assetType: 'Image',
      status: 'processing',
      previewUrl: null,
      errorCode: null,
      errorMessage: null,
    }
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'unused',
      createVirtualAsset: async () => authorizedPortrait,
      createVisualValidateSession: async () => ({
        providerToken: 'dora-private-token',
        h5Link: 'https://www.dorarouter.com/material/h5/test',
        qrCode: 'data:image/png;base64,test',
      }),
      getVisualValidateResult: async () => ({ groupId: 'dora-live-group' }),
      createAuthorizedAsset: async () => authorizedPortrait,
      getPortrait: async () => authorizedPortrait,
      listPortraits: async () => [],
      listAuthorizedPortraits: async () => [],
    }
    const principal = {
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member' as const],
    }
    const service = new TrustedAssetService(
      store,
      provider,
      storage,
      'test-secret-with-at-least-32-characters',
      'https://api.example.com',
      'default',
      '',
      null,
      null,
      new TrustedValidationSessionRepository(store),
    )

    const session = await service.createValidationSession(asset.projectId, asset.id, principal)
    expect(session).toMatchObject({
      status: 'pending',
      h5Link: 'https://www.dorarouter.com/material/h5/test',
      qrCode: 'data:image/png;base64,test',
    })
    expect(session).not.toHaveProperty('providerToken')

    const result = await service.refreshValidationSession(session.id, principal)
    expect(result.session).toMatchObject({
      status: 'completed',
      groupId: 'dora-live-group',
      providerAssetId: 'dora-live-asset',
    })
    expect(result.asset?.attributes).toMatchObject({
      portraitSource: 'authorized-real',
      trustedPortrait: { groupType: 'LivenessFace', assetId: 'dora-live-asset' },
    })
    expect(store.read((state) => state.trustedValidationSessions?.[0]?.providerToken)).toBe(
      'dora-private-token',
    )
  })
})

class MemoryStorage implements ObjectStorage {
  private readonly values = new Map<string, Buffer>()

  async put(key: string, content: Buffer): Promise<void> {
    this.values.set(key, content)
  }

  async get(key: string): Promise<Buffer> {
    const value = this.values.get(key)
    if (!value) throw new Error('missing object')
    return value
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}
