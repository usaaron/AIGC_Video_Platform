import type { AssetLibraryProvider } from '../../core/generation/volcArkAssetLibraryProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { describe, expect, it } from 'vitest'
import { TrustedAssetService } from './service.js'

describe('TrustedAssetService', () => {
  it('publishes an approved face through a signed URL and creates an AIGC resource', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const storage = new MemoryStorage()
    await storage.put('tenant/project/generated/face.png', Buffer.from('face-image'), 'image/png')
    await store.mutate((state) => {
      const now = new Date().toISOString()
      state.assets.push({
        id: 'character-1',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'character',
        sourceMode: 'generate',
        name: '角色甲',
        description: 'AI 虚拟人物',
        prompt: '',
        promptMode: 'standard',
        customPromptMode: 'append',
        customPrompt: '',
        negativePrompt: '',
        references: [],
        attributes: {
          ...defaultAssetAttributes('character'),
          faceStatus: 'approved',
        },
        imageUrl: '/api/v1/generation/tasks/face-task/outputs/single',
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
      state.tasks.unshift({
        id: 'face-task',
        clientRequestId: 'face-client',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        userId: 'user-creator',
        kind: 'image',
        label: '角色甲面部',
        prompt: '',
        negativePrompt: '',
        provider: 'img2',
        model: null,
        metadata: {
          assetId: 'character-1',
          generationStage: 'face',
          generatedOutputs: [
            {
              view: 'single',
              storageKey: 'tenant/project/generated/face.png',
              contentType: 'image/png',
              size: 10,
            },
          ],
        },
        status: 'completed',
        progress: 100,
        estimatedCredits: 4,
        createdAt: now,
        updatedAt: now,
        resultUrl: '/api/v1/generation/tasks/face-task/outputs/single',
        outputs: [],
        error: null,
      })
    })

    let submittedSourceUrl = ''
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'group-aigc-1',
      createVirtualAsset: async (groupId, name, sourceUrl) => {
        submittedSourceUrl = sourceUrl
        return {
          assetId: 'asset-aigc-1',
          groupId,
          groupType: 'AIGC',
          name,
          assetType: 'Image',
          status: 'processing',
          previewUrl: null,
          errorCode: null,
          errorMessage: null,
        }
      },
      getPortrait: async () => {
        throw new Error('not used')
      },
      listPortraits: async () => [],
      listAuthorizedPortraits: async () => [],
    }
    const service = new TrustedAssetService(
      store,
      provider,
      storage,
      'test-secret-with-at-least-32-characters',
      'https://api.example.com',
      'default',
    )

    const updated = await service.registerVirtual('project-midnight-film', 'character-1', {
      userId: 'user-creator',
      tenantId: 'tenant-seqora-demo',
      roles: ['creator'],
    })

    expect(updated.attributes).toMatchObject({
      portraitSource: 'ai-virtual',
      trustedPortrait: {
        assetId: 'asset-aigc-1',
        status: 'processing',
        previewUrl: '/api/v1/trusted-assets/portraits/asset-aigc-1/preview',
      },
    })
    expect(submittedSourceUrl).toMatch(/^https:\/\/api\.example\.com\/api\/v1\/trusted-assets\/source\//)
    const token = submittedSourceUrl.split('/').pop()!
    await expect(service.readPublicSource(token)).resolves.toMatchObject({
      content: Buffer.from('face-image'),
      contentType: 'image/png',
    })
  })

  it('refreshes an existing processing AIGC portrait instead of creating a duplicate', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const storage = new MemoryStorage()
    let createCalls = 0
    await store.mutate((state) => {
      const now = new Date().toISOString()
      state.assets.push({
        id: 'character-existing',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'character',
        sourceMode: 'generate',
        name: '已有虚拟人',
        description: '',
        prompt: '',
        promptMode: 'standard',
        customPromptMode: 'append',
        customPrompt: '',
        negativePrompt: '',
        references: [],
        attributes: {
          ...defaultAssetAttributes('character'),
          faceStatus: 'approved',
          trustedPortrait: {
            assetId: 'asset-aigc-existing',
            groupId: 'group-aigc-existing',
            groupType: 'AIGC',
            name: '已有虚拟人',
            status: 'processing',
            previewUrl: null,
            errorCode: null,
            errorMessage: null,
            checkedAt: now,
          },
        },
        imageUrl: null,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
    })
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'unused-group',
      createVirtualAsset: async () => {
        createCalls += 1
        throw new Error('must not create')
      },
      getPortrait: async () => ({
        assetId: 'asset-aigc-existing',
        groupId: 'group-aigc-existing',
        groupType: 'AIGC',
        name: '已有虚拟人',
        assetType: 'Image',
        status: 'active',
        previewUrl: null,
        errorCode: null,
        errorMessage: null,
      }),
      listPortraits: async () => [],
      listAuthorizedPortraits: async () => [],
    }
    const service = new TrustedAssetService(
      store,
      provider,
      storage,
      'test-secret-with-at-least-32-characters',
      'https://api.example.com',
      'default',
    )

    const updated = await service.registerVirtual('project-midnight-film', 'character-existing', {
      userId: 'user-creator',
      tenantId: 'tenant-seqora-demo',
      roles: ['creator'],
    })

    expect(createCalls).toBe(0)
    expect(updated.attributes).toMatchObject({
      trustedPortrait: { assetId: 'asset-aigc-existing', status: 'active' },
    })
  })

  it('uploads the current approved local face instead of an older generated face', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const storage = new MemoryStorage()
    await storage.put('tenant/project/uploaded/current-face.png', Buffer.from('current-face'))
    await storage.put('tenant/project/generated/old-face.png', Buffer.from('old-face'))
    await store.mutate((state) => {
      const now = new Date().toISOString()
      state.media.push({
        id: 'current-face-media',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'image',
        name: 'current-face.png',
        contentType: 'image/png',
        size: 12,
        storageKey: 'tenant/project/uploaded/current-face.png',
        createdAt: now,
      })
      state.assets.push({
        id: 'character-local-face',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'character',
        sourceMode: 'import',
        name: 'Current face',
        description: '',
        prompt: '',
        promptMode: 'standard',
        customPromptMode: 'append',
        customPrompt: '',
        negativePrompt: '',
        references: [
          {
            id: 'current-face-media',
            url: '/api/v1/media/current-face-media',
            name: 'current-face.png',
          },
        ],
        attributes: {
          ...defaultAssetAttributes('character'),
          faceStatus: 'approved',
          faceReference: {
            id: 'current-face-media',
            url: '/api/v1/media/current-face-media',
            name: 'current-face.png',
          },
        },
        imageUrl: '/api/v1/media/current-face-media',
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
      })
      state.tasks.unshift({
        id: 'old-face-task',
        clientRequestId: 'old-face-client',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        userId: 'user-creator',
        kind: 'image',
        label: 'Old face',
        prompt: '',
        negativePrompt: '',
        provider: 'img2',
        model: null,
        metadata: {
          assetId: 'character-local-face',
          generationStage: 'face',
          generatedOutputs: [
            {
              view: 'single',
              storageKey: 'tenant/project/generated/old-face.png',
              contentType: 'image/png',
              size: 8,
            },
          ],
        },
        status: 'completed',
        progress: 100,
        estimatedCredits: 4,
        createdAt: now,
        updatedAt: now,
        resultUrl: '/api/v1/generation/tasks/old-face-task/outputs/single',
        outputs: [],
        error: null,
      })
    })

    let submittedSourceUrl = ''
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'group-current-face',
      createVirtualAsset: async (groupId, name, sourceUrl) => {
        submittedSourceUrl = sourceUrl
        return {
          assetId: 'asset-current-face',
          groupId,
          groupType: 'AIGC',
          name,
          assetType: 'Image',
          status: 'processing',
          previewUrl: null,
          errorCode: null,
          errorMessage: null,
        }
      },
      getPortrait: async () => {
        throw new Error('not used')
      },
      listPortraits: async () => [],
      listAuthorizedPortraits: async () => [],
    }
    const service = new TrustedAssetService(
      store,
      provider,
      storage,
      'test-secret-with-at-least-32-characters',
      'https://api.example.com',
      'default',
    )

    await service.registerVirtual('project-midnight-film', 'character-local-face', {
      userId: 'user-creator',
      tenantId: 'tenant-seqora-demo',
      roles: ['creator'],
    })

    const token = submittedSourceUrl.split('/').pop()!
    await expect(service.readPublicSource(token)).resolves.toMatchObject({
      content: Buffer.from('current-face'),
    })
  })

  it('persists the upstream rejection so the client can retry registration', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    await store.mutate((state) => {
      state.assets.push({
        id: 'character-rejected',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'character',
        sourceMode: 'generate',
        name: 'Rejected face',
        description: '',
        prompt: '',
        promptMode: 'standard',
        customPromptMode: 'append',
        customPrompt: '',
        negativePrompt: '',
        references: [],
        attributes: {
          ...defaultAssetAttributes('character'),
          faceStatus: 'approved',
          trustedPortrait: {
            assetId: 'asset-rejected',
            groupId: 'group-rejected',
            groupType: 'AIGC',
            name: 'Rejected face',
            status: 'processing',
            previewUrl: null,
            errorCode: null,
            errorMessage: null,
            checkedAt: now,
          },
        },
        imageUrl: null,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
    })
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'unused-group',
      createVirtualAsset: async () => {
        throw new Error('not used')
      },
      getPortrait: async () => ({
        assetId: 'asset-rejected',
        groupId: 'group-rejected',
        groupType: 'AIGC',
        name: 'Rejected face',
        assetType: 'Image',
        status: 'failed',
        previewUrl: null,
        errorCode: 'FACE_NOT_CLEAR',
        errorMessage: 'Face is not clear enough',
      }),
      listPortraits: async () => [],
      listAuthorizedPortraits: async () => [],
    }
    const service = new TrustedAssetService(
      store,
      provider,
      new MemoryStorage(),
      'test-secret-with-at-least-32-characters',
      'https://api.example.com',
      'default',
    )

    const updated = await service.refresh('project-midnight-film', 'character-rejected', {
      userId: 'user-creator',
      tenantId: 'tenant-seqora-demo',
      roles: ['creator'],
    })

    expect(updated.attributes).toMatchObject({
      trustedPortrait: {
        assetId: 'asset-rejected',
        status: 'failed',
        errorCode: 'FACE_NOT_CLEAR',
        errorMessage: 'Face is not clear enough',
      },
    })
  })

  it('uses a fresh group and unique name when retrying a failed AIGC registration', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const storage = new MemoryStorage()
    await storage.put('tenant/project/retry-face.png', Buffer.from('retry-face'), 'image/png')
    const now = new Date().toISOString()
    await store.mutate((state) => {
      state.media.push({
        id: 'retry-face-media',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'image',
        name: 'retry-face.png',
        contentType: 'image/png',
        size: 10,
        storageKey: 'tenant/project/retry-face.png',
        createdAt: now,
      })
      state.assets.push({
        id: 'character-retry',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'character',
        sourceMode: 'generate',
        name: '可重试人物',
        description: '',
        prompt: '',
        promptMode: 'standard',
        customPromptMode: 'append',
        customPrompt: '',
        negativePrompt: '',
        references: [],
        attributes: {
          ...defaultAssetAttributes('character'),
          faceStatus: 'approved',
          faceReference: {
            id: 'retry-face-media',
            url: '/api/v1/media/retry-face-media',
            name: 'retry-face.png',
          },
          trustedPortrait: {
            assetId: 'asset-failed-before',
            groupId: 'group-failed-before',
            groupType: 'AIGC',
            name: '可重试人物-面部基准',
            status: 'failed',
            previewUrl: null,
            errorCode: 'DUPLICATE_NAME',
            errorMessage: '资源名称重复',
            checkedAt: now,
          },
        },
        imageUrl: '/api/v1/media/retry-face-media',
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
    })

    let createdGroupName = ''
    let createdAssetGroupId = ''
    let createdAssetName = ''
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async (name) => {
        createdGroupName = name
        return 'group-retry-new'
      },
      createVirtualAsset: async (groupId, name) => {
        createdAssetGroupId = groupId
        createdAssetName = name
        return {
          assetId: 'asset-retry-new',
          groupId,
          groupType: 'AIGC',
          name,
          assetType: 'Image',
          status: 'processing',
          previewUrl: null,
          errorCode: null,
          errorMessage: null,
        }
      },
      getPortrait: async () => {
        throw new Error('not used')
      },
      listPortraits: async () => [],
      listAuthorizedPortraits: async () => [],
    }
    const service = new TrustedAssetService(
      store,
      provider,
      storage,
      'test-secret-with-at-least-32-characters',
      'https://api.example.com',
      'default',
    )

    const updated = await service.registerVirtual('project-midnight-film', 'character-retry', {
      userId: 'user-creator',
      tenantId: 'tenant-seqora-demo',
      roles: ['creator'],
    })

    expect(createdGroupName).toMatch(/^可重试人物-/u)
    expect(createdAssetGroupId).toBe('group-retry-new')
    expect(createdAssetName).toMatch(/^可重试人物-面部基准-/u)
    expect(updated.attributes).toMatchObject({
      trustedPortrait: {
        assetId: 'asset-retry-new',
        groupId: 'group-retry-new',
        status: 'processing',
      },
    })
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
