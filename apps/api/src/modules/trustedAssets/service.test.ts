import type { AssetLibraryProvider } from '../../core/generation/volcArkAssetLibraryProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { AppStore, defaultAssetAttributes } from '../../infra/store.js'
import { describe, expect, it, vi } from 'vitest'
import { TrustedAssetService } from './service.js'

describe('TrustedAssetService', () => {
  it('only lists and previews portraits owned by the requesting user', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    await store.mutate((state) => {
      const ownProject = state.projects.find((project) => project.id === 'project-midnight-film')!
      state.projects.push({
        ...ownProject,
        id: 'project-other-user',
        tenantId: 'tenant-other',
        ownerId: 'user-other',
        name: 'Other project',
      })
      for (const [id, projectId, tenantId, portraitId] of [
        ['character-own', ownProject.id, ownProject.tenantId, 'portrait-own'],
        ['character-other', 'project-other-user', 'tenant-other', 'portrait-other'],
      ] as const) {
        state.assets.push({
          id,
          projectId,
          tenantId,
          kind: 'character',
          sourceMode: 'generate',
          name: id,
          description: '',
          prompt: '',
          promptMode: 'standard',
          customPromptMode: 'append',
          customPrompt: '',
          negativePrompt: '',
          references: [],
          attributes: {
            ...defaultAssetAttributes('character'),
            trustedPortrait: {
              assetId: portraitId,
              groupId: `group-${portraitId}`,
              groupType: 'AIGC',
              name: portraitId,
              status: 'active',
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
      }
    })
    const previewed: string[] = []
    const portraits = ['portrait-own', 'portrait-other'].map((assetId) => ({
      assetId,
      groupId: `group-${assetId}`,
      groupType: 'AIGC' as const,
      name: assetId,
      assetType: 'Image' as const,
      status: 'active' as const,
      previewUrl: null,
      errorCode: null,
      errorMessage: null,
    }))
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'unused',
      createVirtualAsset: async () => portraits[0]!,
      getPortrait: async (assetId) => portraits.find((portrait) => portrait.assetId === assetId)!,
      getPortraitPreview: async (assetId) => {
        previewed.push(assetId)
        return { content: Buffer.from(assetId), contentType: 'image/png' }
      },
      listPortraits: async () => portraits,
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
    const principal = {
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member' as const],
    }

    await expect(service.listPortraits('AIGC', principal)).resolves.toMatchObject([
      { assetId: 'portrait-own' },
    ])
    await expect(service.preview('portrait-own', principal)).resolves.toMatchObject({
      content: Buffer.from('portrait-own'),
    })
    await expect(service.preview('portrait-other', principal)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TRUSTED_PORTRAIT_NOT_FOUND',
    })
    expect(previewed).toEqual(['portrait-own'])
  })

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
        userId: 'user-member',
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
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
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
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
    })

    expect(createCalls).toBe(0)
    expect(updated.attributes).toMatchObject({
      trustedPortrait: { assetId: 'asset-aigc-existing', status: 'active' },
    })
  })

  it('recovers from the whitelist when the direct upstream lookup remains eventually consistent', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    await store.mutate((state) => {
      state.assets.push({
        id: 'character-eventual',
        projectId: 'project-midnight-film',
        tenantId: 'tenant-seqora-demo',
        kind: 'character',
        sourceMode: 'generate',
        name: '等待验证人物',
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
            assetId: 'asset-eventual',
            groupId: 'group-eventual',
            groupType: 'AIGC',
            name: '等待验证人物',
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

    let requestedGroupType = ''
    let listedActive = false
    const listPortraits = vi.fn(async () =>
      listedActive
        ? [
            {
              assetId: 'asset-eventual',
              groupId: 'group-eventual',
              groupType: 'AIGC' as const,
              name: '等待验证人物',
              assetType: 'Image' as const,
              status: 'active' as const,
              previewUrl: null,
              errorCode: null,
              errorMessage: null,
            },
          ]
        : [],
    )
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'unused-group',
      createVirtualAsset: async () => {
        throw new Error('must not create')
      },
      getPortrait: async (_assetId, groupType) => {
        requestedGroupType = groupType || ''
        throw new Error('当前人物尚未能建立可靠资源验证')
      },
      listPortraits,
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

    const updated = await service.refresh('project-midnight-film', 'character-eventual', {
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
    })

    expect(requestedGroupType).toBe('AIGC')
    expect(updated.attributes).toMatchObject({
      trustedPortrait: { assetId: 'asset-eventual', status: 'processing' },
    })

    listedActive = true
    const recovered = await service.refresh('project-midnight-film', 'character-eventual', {
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
    })

    expect(listPortraits).toHaveBeenCalledTimes(2)
    expect(recovered.attributes).toMatchObject({
      trustedPortrait: { assetId: 'asset-eventual', status: 'active' },
    })
  })

  it('refreshes every processing portrait in a project from one upstream list', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const base = store.read((state) => state.assets[0]!)
    await store.mutate((state) => {
      for (const [id, assetId] of [
        ['character-batch-1', 'asset-batch-1'],
        ['character-batch-2', 'asset-batch-2'],
      ] as const) {
        state.assets.push({
          ...structuredClone(base),
          id,
          kind: 'character',
          name: id,
          attributes: {
            ...defaultAssetAttributes('character'),
            trustedPortrait: {
              assetId,
              groupId: `group-${assetId}`,
              groupType: 'AIGC',
              name: id,
              status: 'processing',
              previewUrl: null,
              errorCode: null,
              errorMessage: null,
              checkedAt: now,
            },
          },
          createdAt: now,
          updatedAt: now,
        })
      }
    })
    const listPortraits = vi.fn(async () =>
      ['asset-batch-1', 'asset-batch-2'].map((assetId) => ({
        assetId,
        groupId: `group-${assetId}`,
        groupType: 'AIGC' as const,
        name: assetId,
        assetType: 'Image' as const,
        status: 'active' as const,
        previewUrl: null,
        errorCode: null,
        errorMessage: null,
      })),
    )
    const getPortrait = vi.fn()
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'unused-group',
      createVirtualAsset: async () => {
        throw new Error('must not create')
      },
      getPortrait,
      listPortraits,
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

    const updated = await service.refreshProcessing('project-midnight-film', {
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
    })

    expect(listPortraits).toHaveBeenCalledOnce()
    expect(getPortrait).not.toHaveBeenCalled()
    expect(updated).toHaveLength(2)
    expect(updated.every((asset) => asset.attributes.trustedPortrait?.status === 'active')).toBe(true)
  })

  it('refreshes from the repository when the API process cache is stale', async () => {
    const store = new AppStore(null)
    await store.initialize()
    const now = new Date().toISOString()
    const persisted = {
      id: 'character-cross-process',
      projectId: 'project-midnight-film',
      tenantId: 'tenant-seqora-demo',
      kind: 'character' as const,
      sourceMode: 'generate' as const,
      name: '林夏',
      description: '',
      prompt: '',
      promptMode: 'standard' as const,
      customPromptMode: 'append' as const,
      customPrompt: '',
      negativePrompt: '',
      references: [],
      attributes: {
        ...defaultAssetAttributes('character'),
        faceStatus: 'approved' as const,
        trustedPortrait: {
          assetId: 'maas-cross-process',
          groupId: 'group-cross-process',
          groupType: 'AIGC' as const,
          name: '林夏-面部基准',
          status: 'processing' as const,
          previewUrl: null,
          errorCode: null,
          errorMessage: null,
          checkedAt: now,
        },
      },
      imageUrl: null,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
    }
    let stored = structuredClone(persisted)
    const provider: AssetLibraryProvider = {
      createVirtualGroup: async () => 'unused-group',
      createVirtualAsset: async () => {
        throw new Error('must not create')
      },
      getPortrait: async () => ({
        assetId: 'maas-cross-process',
        groupId: 'group-cross-process',
        groupType: 'AIGC',
        name: '林夏-面部基准',
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
      new MemoryStorage(),
      'test-secret-with-at-least-32-characters',
      'https://api.example.com',
      'default',
      '',
      {
        findOwnedAsset: async () => structuredClone(stored),
        listOwnedAssets: async () => [structuredClone(stored)],
        updateAsset: async (_projectId, _assetId, input) => {
          stored = {
            ...stored,
            attributes: input.attributes ?? stored.attributes,
            updatedAt: new Date().toISOString(),
          }
          return structuredClone(stored)
        },
      },
    )

    const updated = await service.refresh('project-midnight-film', 'character-cross-process', {
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
    })

    expect(
      store.read((state) => state.assets.find((asset) => asset.id === 'character-cross-process')),
    ).toBeUndefined()
    expect(updated.attributes).toMatchObject({
      trustedPortrait: { assetId: 'maas-cross-process', status: 'active' },
    })
  })

  it.each(['processing', 'failed'] as const)(
    'recovers an active historical portrait when a duplicate submission becomes %s',
    async (duplicateStatus) => {
      const store = new AppStore(null)
      await store.initialize()
      const now = new Date().toISOString()
      await store.mutate((state) => {
        state.assets.push({
          id: 'character-duplicate',
          projectId: 'project-midnight-film',
          tenantId: 'tenant-seqora-demo',
          kind: 'character',
          sourceMode: 'generate',
          name: '女摄影师',
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
              assetId: 'asset-duplicate-processing',
              groupId: 'group-duplicate',
              groupType: 'AIGC',
              name: '女摄影师-面部基准',
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
        state.tasks.unshift({
          id: 'trusted-portrait-old-task',
          clientRequestId: 'trusted-portrait-old-client',
          projectId: 'project-midnight-film',
          tenantId: 'tenant-seqora-demo',
          userId: 'user-member',
          kind: 'text',
          label: '女摄影师可信人像',
          prompt: '',
          negativePrompt: '',
          provider: 'asset-library',
          model: null,
          metadata: {
            assetId: 'character-duplicate',
            generationStage: 'trusted-portrait',
            textResult: {
              attributes: { trustedPortrait: { assetId: 'asset-original-active' } },
            },
          },
          status: 'completed',
          progress: 100,
          estimatedCredits: 1,
          createdAt: now,
          updatedAt: now,
          resultUrl: null,
          outputs: [],
          error: null,
        })
      })

      const requestedIds: string[] = []
      const provider: AssetLibraryProvider = {
        createVirtualGroup: async () => 'unused-group',
        createVirtualAsset: async () => {
          throw new Error('must not create')
        },
        getPortrait: async (assetId) => {
          requestedIds.push(assetId)
          return {
            assetId,
            groupId: assetId === 'asset-original-active' ? 'group-original' : 'group-duplicate',
            groupType: 'AIGC',
            name: '女摄影师-面部基准',
            assetType: 'Image',
            status: assetId === 'asset-original-active' ? 'active' : duplicateStatus,
            previewUrl: null,
            errorCode: null,
            errorMessage: null,
          }
        },
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

      const updated = await service.refresh('project-midnight-film', 'character-duplicate', {
        userId: 'user-member',
        tenantId: 'tenant-seqora-demo',
        roles: ['member'],
      })

      expect(requestedIds).toEqual(['asset-duplicate-processing', 'asset-original-active'])
      expect(updated.attributes).toMatchObject({
        trustedPortrait: { assetId: 'asset-original-active', status: 'active' },
      })
    },
  )

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
        userId: 'user-member',
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
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
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
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
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
      userId: 'user-member',
      tenantId: 'tenant-seqora-demo',
      roles: ['member'],
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
