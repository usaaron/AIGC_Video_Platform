import type { Asset, Principal, TrustedPortrait } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import type {
  AssetLibraryProvider,
  PortraitGroupType,
  PortraitPreview,
  ProviderPortrait,
} from '../../core/generation/volcArkAssetLibraryProvider.js'
import { createPublicMediaToken, verifyPublicMediaToken } from '../../core/media/publicMediaToken.js'
import { AppError } from '../../core/errors.js'
import type { AppStore, StoredMedia } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { MediaRepository } from '../media/repository.js'
import type { ProjectRepository } from '../projects/repository.js'

const SOURCE_URL_TTL_MS = 24 * 60 * 60 * 1_000
const PREVIEW_REQUEST_TIMEOUT_MS = 30_000

type StoredSource = {
  storageKey: string
  contentType: string
}

type CharacterAsset = Asset & {
  attributes: Extract<Asset['attributes'], { type: 'character' }>
}

export class TrustedAssetService {
  constructor(
    private readonly store: AppStore,
    private readonly provider: AssetLibraryProvider | null,
    private readonly storage: ObjectStorage,
    private readonly authSecret: string,
    private readonly publicApiBaseUrl: string,
    private readonly projectName: string,
    private readonly consoleUrl = '',
    private readonly projectRepository: Pick<ProjectRepository, 'updateAsset'> | null = null,
    private readonly mediaRepository:
      | Pick<MediaRepository, 'findSourceById' | 'findSourceByReferenceIds'>
      | null = null,
  ) {}

  configuration() {
    return {
      configured: Boolean(this.provider),
      virtualRegistrationReady: Boolean(this.provider && this.publicApiBaseUrl),
      projectName: this.projectName,
      authorizationUrl: this.consoleUrl || null,
    }
  }

  async listPortraits(groupType: PortraitGroupType, principal: Principal): Promise<ProviderPortrait[]> {
    const visibleIds = this.visiblePortraitIds(principal, groupType)
    if (!visibleIds.size) return []
    const portraits = await this.callProvider(() => this.requireProvider().listPortraits(groupType))
    return portraits
      .filter((portrait) => visibleIds.has(portrait.assetId))
      .map((portrait) => ({ ...portrait, previewUrl: trustedPortraitPreviewUrl(portrait) }))
  }

  async preview(assetId: string, principal: Principal): Promise<PortraitPreview> {
    if (!this.visiblePortraitIds(principal).has(assetId)) {
      throw new AppError(404, 'TRUSTED_PORTRAIT_NOT_FOUND', '人像资源不存在或无权访问')
    }
    const provider = this.requireProvider()
    return this.callProvider(async () => {
      if (provider.getPortraitPreview) return provider.getPortraitPreview(assetId)
      const portrait = await provider.getPortrait(assetId)
      if (!portrait.previewUrl) throw new Error('素材库当前没有可用的预览图片')
      const response = await fetch(portrait.previewUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(PREVIEW_REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`预览图片下载失败（HTTP ${response.status}）`)
      const contentType = response.headers.get('content-type')?.split(';', 1)[0] || 'image/jpeg'
      if (!contentType.startsWith('image/')) throw new Error('素材库返回的预览内容不是图片')
      return {
        content: Buffer.from(await response.arrayBuffer()),
        contentType,
      }
    })
  }

  async registerVirtual(projectId: string, assetId: string, principal: Principal): Promise<Asset> {
    const provider = this.requireProvider()
    if (!this.publicApiBaseUrl) {
      throw new AppError(
        503,
        'PUBLIC_API_URL_REQUIRED',
        '自动入库需要配置公网 API 地址；本地 localhost 无法供弦序素材库下载素材',
      )
    }
    const asset = this.requireCharacterAsset(projectId, assetId, principal)
    if (asset.attributes.subjectType !== 'human') {
      throw new AppError(400, 'HUMAN_CHARACTER_REQUIRED', '只有人物素材需要创建人像资源')
    }
    if (asset.attributes.faceStatus !== 'approved') {
      throw new AppError(409, 'FACE_APPROVAL_REQUIRED', '请先确认人物面部基准，再创建弦序素材资源')
    }
    if (asset.attributes.trustedPortrait?.status === 'active') return asset

    const current = asset.attributes.trustedPortrait
    if (current?.groupType === 'AIGC' && current.status === 'processing') {
      const portrait = await this.callProvider(() => provider.getPortrait(current.assetId))
      return this.savePortrait(asset, portrait, 'ai-virtual', principal)
    }

    const source = await this.findSource(asset)
    if (!source) {
      throw new AppError(409, 'FACE_SOURCE_REQUIRED', '请先生成或导入并确认人物面部，再创建弦序素材资源')
    }
    const token = createPublicMediaToken(source, this.authSecret, Date.now() + SOURCE_URL_TTL_MS)
    const sourceUrl = `${this.publicApiBaseUrl}/api/v1/trusted-assets/source/${token}`
    const retryingFailedPortrait = current?.groupType === 'AIGC' && current.status === 'failed'
    const retrySuffix = retryingFailedPortrait ? `-${randomUUID().slice(0, 8)}` : ''
    const groupId =
      current?.groupType === 'AIGC' && !retryingFailedPortrait
        ? current.groupId
        : await this.callProvider(() =>
            provider.createVirtualGroup(`${asset.name}${retrySuffix}`, asset.description || 'AIGC 人物形象'),
          )
    const portraitName = `${asset.name}-面部基准${retrySuffix}`
    const portrait = await this.callProvider(() =>
      provider.createVirtualAsset(groupId, portraitName, sourceUrl),
    )
    return this.savePortrait(asset, portrait, 'ai-virtual', principal)
  }

  async bind(
    projectId: string,
    localAssetId: string,
    providerAssetId: string,
    principal: Principal,
  ): Promise<Asset> {
    const asset = this.requireCharacterAsset(projectId, localAssetId, principal)
    const portrait = await this.callProvider(() => this.requireProvider().getPortrait(providerAssetId))
    if (portrait.assetType !== 'Image') {
      throw new AppError(400, 'PORTRAIT_IMAGE_REQUIRED', '人物面部基准必须绑定图片类型的 Asset ID')
    }
    return this.savePortrait(
      asset,
      portrait,
      portrait.groupType === 'LivenessFace' ? 'authorized-real' : 'ai-virtual',
      principal,
    )
  }

  async refresh(projectId: string, assetId: string, principal: Principal): Promise<Asset> {
    const asset = this.requireCharacterAsset(projectId, assetId, principal)
    const current = asset.attributes.trustedPortrait
    if (!current) throw new AppError(409, 'TRUSTED_PORTRAIT_REQUIRED', '当前人物尚未绑定弦序素材资源')
    const portrait = await this.callProvider(() => this.requireProvider().getPortrait(current.assetId))
    return this.savePortrait(
      asset,
      portrait,
      portrait.groupType === 'LivenessFace' ? 'authorized-real' : 'ai-virtual',
      principal,
    )
  }

  async readPublicSource(token: string): Promise<{ content: Buffer; contentType: string }> {
    const payload = verifyPublicMediaToken(token, this.authSecret)
    if (!payload) throw new AppError(404, 'SOURCE_LINK_INVALID', '素材下载地址不存在或已过期')
    return {
      content: await this.storage.get(payload.storageKey),
      contentType: payload.contentType,
    }
  }

  private requireProvider(): AssetLibraryProvider {
    if (!this.provider) {
      throw new AppError(
        503,
        'ASSET_LIBRARY_NOT_CONFIGURED',
        '弦序素材库尚未配置 Access Key/Secret Key，单个 sk- API Token 不能代替',
      )
    }
    return this.provider
  }

  private visiblePortraitIds(principal: Principal, groupType?: PortraitGroupType): Set<string> {
    return this.store.read((state) => {
      const projectIds = new Set(
        state.projects
          .filter(
            (project) => project.tenantId === principal.tenantId && project.ownerId === principal.userId,
          )
          .map((project) => project.id),
      )
      return new Set(
        state.assets
          .filter(
            (asset) =>
              asset.tenantId === principal.tenantId &&
              projectIds.has(asset.projectId) &&
              asset.attributes.type === 'character' &&
              Boolean(asset.attributes.trustedPortrait?.assetId) &&
              (!groupType || asset.attributes.trustedPortrait?.groupType === groupType),
          )
          .map((asset) =>
            asset.attributes.type === 'character' ? asset.attributes.trustedPortrait!.assetId : '',
          )
          .filter(Boolean),
      )
    })
  }

  private async callProvider<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof AppError) throw error
      const detail = error instanceof Error ? error.message : '未知错误'
      throw new AppError(502, 'ASSET_LIBRARY_REQUEST_FAILED', `弦序素材库请求失败：${detail}`)
    }
  }

  private requireCharacterAsset(projectId: string, assetId: string, principal: Principal): CharacterAsset {
    const asset = this.store.read((state) => {
      const ownsProject = state.projects.some(
        (project) =>
          project.id === projectId &&
          project.tenantId === principal.tenantId &&
          project.ownerId === principal.userId,
      )
      if (!ownsProject) return null
      return (
        state.assets.find(
          (item) =>
            item.id === assetId &&
            item.projectId === projectId &&
            item.tenantId === principal.tenantId &&
            item.kind === 'character',
        ) ?? null
      )
    })
    if (!asset || asset.attributes.type !== 'character') {
      throw new AppError(404, 'CHARACTER_ASSET_NOT_FOUND', '人物资产不存在或无权操作')
    }
    return asset as CharacterAsset
  }

  private async findSource(asset: CharacterAsset): Promise<StoredSource | null> {
    const currentFace = asset.attributes.faceReference
    if (currentFace) {
      const currentFacePath = referencePath(currentFace.url)
      const mediaId = /^\/api\/v1\/media\/([^/]+)$/.exec(currentFacePath)?.[1] ?? currentFace.id
      const mediaSource = await this.findMediaSourceById(mediaId, asset)
      if (mediaSource) return mediaSource

      const generated = /^\/api\/v1\/generation\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(currentFacePath)
      if (!generated) return null
      return this.findGeneratedTaskSource(asset, generated[1]!, generated[2]!)
    }

    const generated = this.findLegacyGeneratedFaceSource(asset)
    if (generated) return generated

    return await this.findMediaSourceByReferenceIds(asset.references.map((item) => item.id), asset)
  }

  private async findMediaSourceById(mediaId: string, asset: CharacterAsset): Promise<StoredSource | null> {
    if (this.mediaRepository) {
      return await this.mediaRepository.findSourceById(mediaId, asset.projectId, asset.tenantId, 'image')
    }
    return this.store.read((state) => {
      const media = state.media.find(
        (item) =>
          item.id === mediaId &&
          item.projectId === asset.projectId &&
          item.tenantId === asset.tenantId &&
          item.kind === 'image',
      )
      return media ? sourceFromMedia(media) : null
    })
  }

  private async findMediaSourceByReferenceIds(
    referenceIds: readonly string[],
    asset: CharacterAsset,
  ): Promise<StoredSource | null> {
    if (!referenceIds.length) return null
    if (this.mediaRepository) {
      return await this.mediaRepository.findSourceByReferenceIds(
        referenceIds,
        asset.projectId,
        asset.tenantId,
        'image',
      )
    }
    return this.store.read((state) => {
      const media = state.media.find(
        (item) =>
          referenceIds.includes(item.id) &&
          item.projectId === asset.projectId &&
          item.tenantId === asset.tenantId &&
          item.kind === 'image',
      )
      return media ? sourceFromMedia(media) : null
    })
  }

  private findGeneratedTaskSource(asset: CharacterAsset, taskId: string, view: string): StoredSource | null {
    return this.store.read((state) => {
      const sourceTask = state.tasks.find(
        (task) =>
          task.id === taskId &&
          task.projectId === asset.projectId &&
          task.tenantId === asset.tenantId &&
          task.status === 'completed',
      )
      const descriptors = Array.isArray(sourceTask?.metadata.generatedOutputs)
        ? sourceTask.metadata.generatedOutputs
        : []
      const descriptor = descriptors.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          (item as { view?: unknown }).view === view &&
          typeof (item as { storageKey?: unknown }).storageKey === 'string' &&
          typeof (item as { contentType?: unknown }).contentType === 'string',
      ) as StoredSource | undefined
      return descriptor ?? null
    })
  }

  private findLegacyGeneratedFaceSource(asset: CharacterAsset): StoredSource | null {
    return this.store.read((state) => {
      const faceTask = state.tasks.find(
        (task) =>
          task.projectId === asset.projectId &&
          task.tenantId === asset.tenantId &&
          task.metadata.assetId === asset.id &&
          task.metadata.generationStage === 'face' &&
          task.status === 'completed',
      )
      const descriptors = Array.isArray(faceTask?.metadata.generatedOutputs)
        ? faceTask.metadata.generatedOutputs
        : []
      const generated = descriptors.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as { storageKey?: unknown }).storageKey === 'string' &&
          typeof (item as { contentType?: unknown }).contentType === 'string',
      ) as StoredSource | undefined
      return generated ?? null
    })
  }

  private savePortrait(
    asset: CharacterAsset,
    portrait: ProviderPortrait,
    portraitSource: 'ai-virtual' | 'authorized-real',
    principal: Principal,
  ): Promise<Asset> {
    const trustedPortrait = toTrustedPortrait(portrait)
    if (this.projectRepository) {
      return this.projectRepository
        .updateAsset(
          asset.projectId,
          asset.id,
          { attributes: { ...asset.attributes, portraitSource, trustedPortrait } },
          principal,
        )
        .then((updated) => {
          if (!updated) {
            throw new AppError(404, 'CHARACTER_ASSET_NOT_FOUND', '浜虹墿璧勪骇涓嶅瓨鍦ㄦ垨宸茶鍒犻櫎')
          }
          return updated
        })
    }
    return this.store.mutate((state) => {
      const stored = state.assets.find(
        (item) =>
          item.id === asset.id && item.projectId === asset.projectId && item.tenantId === asset.tenantId,
      )
      if (!stored || stored.attributes.type !== 'character') {
        throw new AppError(404, 'CHARACTER_ASSET_NOT_FOUND', '人物资产不存在或已被删除')
      }
      stored.attributes = { ...stored.attributes, portraitSource, trustedPortrait }
      stored.updatedAt = new Date().toISOString()
      return stored
    })
  }
}

function sourceFromMedia(media: StoredMedia): StoredSource {
  return { storageKey: media.storageKey, contentType: media.contentType }
}

function referencePath(url: string): string {
  try {
    return new URL(url, 'http://local').pathname
  } catch {
    return url
  }
}

function toTrustedPortrait(portrait: ProviderPortrait): TrustedPortrait {
  return {
    assetId: portrait.assetId,
    groupId: portrait.groupId,
    groupType: portrait.groupType,
    status: portrait.status,
    name: portrait.name,
    previewUrl: trustedPortraitPreviewUrl(portrait),
    errorCode: portrait.errorCode,
    errorMessage: portrait.errorMessage,
    checkedAt: new Date().toISOString(),
  }
}

function trustedPortraitPreviewUrl(portrait: ProviderPortrait): string | null {
  if (portrait.assetId) {
    return `/api/v1/trusted-assets/portraits/${encodeURIComponent(portrait.assetId)}/preview`
  }
  return portrait.previewUrl
}
