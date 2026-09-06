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
import { isTenantManager } from '../../core/auth/roles.js'
import type { AppStore, StoredMedia } from '../../infra/store.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { MediaRepository } from '../media/repository.js'
import type { GenerationTaskRepository } from '../generation/repository.js'
import type { ProjectRepository } from '../projects/repository.js'
import type { TrustedValidationSessionRepository } from './validationSessionRepository.js'

const SOURCE_URL_TTL_MS = 24 * 60 * 60 * 1_000
const PREVIEW_REQUEST_TIMEOUT_MS = 30_000
const VALIDATION_UPLOAD_LEASE_MS = 10 * 60 * 1_000

type StoredSource = {
  storageKey: string
  contentType: string
}

type CharacterAsset = Asset & {
  attributes: Extract<Asset['attributes'], { type: 'character' }>
}

type PublicValidationSession = {
  id: string
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'expired'
  h5Link: string
  qrCode: string | null
  groupId: string | null
  providerAssetId: string | null
  error: string | null
  expiresAt: string
  updatedAt: string
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
    private readonly projectRepository: Pick<
      ProjectRepository,
      'findOwnedAsset' | 'listOwnedAssets' | 'updateAsset'
    > | null = null,
    private readonly mediaRepository: Pick<
      MediaRepository,
      'findSourceById' | 'findSourceByReferenceIds'
    > | null = null,
    private readonly validationSessionRepository: TrustedValidationSessionRepository | null = null,
    private readonly generationTaskRepository: Pick<GenerationTaskRepository, 'findById'> | null = null,
  ) {}

  configuration() {
    return {
      configured: Boolean(this.provider),
      virtualRegistrationReady: Boolean(this.provider && this.publicApiBaseUrl),
      realValidationReady: Boolean(
        this.provider?.createVisualValidateSession &&
        this.provider.getVisualValidateResult &&
        this.provider.createAuthorizedAsset &&
        this.publicApiBaseUrl,
      ),
      projectName: this.projectName,
      authorizationUrl: this.consoleUrl || null,
    }
  }

  async createValidationSession(
    projectId: string,
    assetId: string,
    principal: Principal,
  ): Promise<PublicValidationSession> {
    const repository = this.requireValidationSessionRepository()
    const provider = this.requireValidationProvider()
    const asset = await this.requireCharacterAsset(projectId, assetId, principal)
    if (asset.attributes.subjectType !== 'human') {
      throw new AppError(400, 'HUMAN_CHARACTER_REQUIRED', '只有人物素材可以进行真人认证')
    }
    if (asset.attributes.faceStatus !== 'approved') {
      throw new AppError(409, 'FACE_APPROVAL_REQUIRED', '请先确认人物面部基准，再进行真人认证')
    }
    if (!this.publicApiBaseUrl) {
      throw new AppError(503, 'PUBLIC_API_URL_REQUIRED', '真人素材入库需要配置公网 API 地址')
    }
    await this.requireConfirmedFaceSource(asset, principal)

    const session = await this.callProvider(() => provider.createVisualValidateSession!())
    const now = Date.now()
    const stored = await repository.create({
      id: randomUUID(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      projectId,
      assetId: asset.id,
      providerToken: session.providerToken,
      h5Link: session.h5Link,
      qrCode: session.qrCode,
      status: 'pending',
      groupId: null,
      providerAssetId: null,
      error: null,
      expiresAt: new Date(now + 5 * 60 * 1_000).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    })
    return publicValidationSession(stored)
  }

  async refreshValidationSession(
    sessionId: string,
    principal: Principal,
  ): Promise<{ session: PublicValidationSession; asset: Asset | null }> {
    const repository = this.requireValidationSessionRepository()
    const session = await repository.findOwned(sessionId, principal)
    if (!session) throw new AppError(404, 'VALIDATION_SESSION_NOT_FOUND', '真人认证会话不存在或已失效')
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'expired') {
      return { session: publicValidationSession(session), asset: null }
    }
    if (
      session.status === 'uploading' &&
      Date.now() - Date.parse(session.updatedAt) < VALIDATION_UPLOAD_LEASE_MS
    ) {
      return { session: publicValidationSession(session), asset: null }
    }
    if (session.status === 'uploading') {
      const reset = await repository.update(session.id, principal, { status: 'pending' })
      if (!reset) throw new AppError(404, 'VALIDATION_SESSION_NOT_FOUND', '真人认证会话不存在或已失效')
      return this.refreshValidationSession(sessionId, principal)
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      const expired = await repository.update(session.id, principal, { status: 'expired' })
      return { session: publicValidationSession(expired ?? { ...session, status: 'expired' }), asset: null }
    }

    const provider = this.requireValidationProvider()
    const result = await this.callProvider(() => provider.getVisualValidateResult!(session.providerToken))
    if (!result.groupId) return { session: publicValidationSession(session), asset: null }

    const markedUploading = await repository.claimForUpload(session.id, principal, result.groupId)
    if (!markedUploading) {
      const latest = await repository.findOwned(session.id, principal)
      if (!latest) throw new AppError(404, 'VALIDATION_SESSION_NOT_FOUND', '真人认证会话不存在或已失效')
      return { session: publicValidationSession(latest), asset: null }
    }

    try {
      const asset = await this.requireCharacterAsset(session.projectId, session.assetId, principal)
      const source = await this.findSource(asset, principal)
      if (!source) throw new AppError(409, 'FACE_SOURCE_REQUIRED', '认证成功，但当前人物没有可上传的面部基准')
      const sourceToken = createPublicMediaToken(source, this.authSecret, Date.now() + SOURCE_URL_TTL_MS)
      const sourceUrl = `${this.publicApiBaseUrl}/api/v1/trusted-assets/source/${sourceToken}`
      const portrait = await this.callProvider(() =>
        provider.createAuthorizedAsset!(result.groupId!, `${asset.name}-真人面部基准`, sourceUrl),
      )
      const savedAsset = await this.savePortrait(asset, portrait, 'authorized-real', principal)
      const completed = await repository.update(session.id, principal, {
        status: 'completed',
        providerAssetId: portrait.assetId,
        error: null,
      })
      return {
        session: publicValidationSession(completed ?? { ...markedUploading, status: 'completed' }),
        asset: savedAsset,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '真人素材入库失败'
      const failed = await repository.update(session.id, principal, { status: 'failed', error: message })
      return {
        session: publicValidationSession(failed ?? { ...markedUploading, status: 'failed', error: message }),
        asset: null,
      }
    }
  }

  async latestValidationSession(
    projectId: string,
    assetId: string,
    principal: Principal,
  ): Promise<PublicValidationSession | null> {
    const repository = this.requireValidationSessionRepository()
    await this.requireCharacterAsset(projectId, assetId, principal)
    const session = await repository.findLatestOwned(projectId, assetId, principal)
    return session ? publicValidationSession(session) : null
  }

  async listPortraits(groupType: PortraitGroupType, principal: Principal): Promise<ProviderPortrait[]> {
    // Always reach the provider when the user explicitly clicks sync. Returning early when the
    // local project has no binding made a valid upstream whitelist look empty forever.
    const portraits = await this.callProvider(() => this.requireProvider().listPortraits(groupType))
    const visibleIds = await this.visiblePortraitIds(principal, groupType)
    return portraits
      .filter(
        (portrait) =>
          isTenantManager(principal) || groupType === 'LivenessFace' || visibleIds.has(portrait.assetId),
      )
      .map((portrait) => ({ ...portrait, previewUrl: trustedPortraitPreviewUrl(portrait) }))
  }

  async preview(assetId: string, principal: Principal): Promise<PortraitPreview> {
    const visible = isTenantManager(principal) || (await this.visiblePortraitIds(principal)).has(assetId)
    let upstreamPortrait: ProviderPortrait | null = null
    if (!visible) {
      try {
        upstreamPortrait = await this.callProvider(() => this.requireProvider().getPortrait(assetId))
      } catch {
        throw new AppError(404, 'TRUSTED_PORTRAIT_NOT_FOUND', '人像资源不存在或无权访问')
      }
      if (upstreamPortrait.groupType !== 'LivenessFace') {
        throw new AppError(404, 'TRUSTED_PORTRAIT_NOT_FOUND', '人像资源不存在或无权访问')
      }
    }
    const provider = this.requireProvider()
    return this.callProvider(async () => {
      if (provider.getPortraitPreview) return provider.getPortraitPreview(assetId)
      const portrait = upstreamPortrait ?? (await provider.getPortrait(assetId))
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

  async registerVirtual(
    projectId: string,
    assetId: string,
    principal: Principal,
    expectedFaceReferenceId?: string,
  ): Promise<Asset> {
    const provider = this.requireProvider()
    if (!this.publicApiBaseUrl) {
      throw new AppError(
        503,
        'PUBLIC_API_URL_REQUIRED',
        '自动入库需要配置公网 API 地址；本地 localhost 无法供 Dora 素材库下载素材',
      )
    }
    const asset = await this.requireCharacterAsset(projectId, assetId, principal)
    if (asset.attributes.subjectType !== 'human') {
      throw new AppError(400, 'HUMAN_CHARACTER_REQUIRED', '只有人物素材需要创建人像资源')
    }
    this.requireApprovedFace(asset, expectedFaceReferenceId)
    if (
      asset.attributes.trustedPortrait?.status === 'active' &&
      portraitMatchesFace(asset, asset.attributes.trustedPortrait)
    ) {
      return asset
    }

    const current = asset.attributes.trustedPortrait
    if (
      current?.groupType === 'AIGC' &&
      current.status === 'processing' &&
      portraitMatchesFace(asset, current)
    ) {
      const portrait = await this.readProcessingPortrait(provider, current)
      const recovered = await this.recoverHistoricalPortrait(asset, current, portrait)
      if (!recovered) return asset
      return this.savePortrait(asset, recovered, 'ai-virtual', principal)
    }
    if (current?.groupType === 'AIGC' && current.status === 'failed' && portraitMatchesFace(asset, current)) {
      const recovered = await this.recoverHistoricalPortrait(asset, current)
      if (recovered) return this.savePortrait(asset, recovered, 'ai-virtual', principal)
    }

    // Resolve the exact persisted face only when a new provider resource must be created. This
    // lets legacy processing records finish syncing without allowing them to create from a guess.
    const source = await this.requireConfirmedFaceSource(asset, principal, expectedFaceReferenceId)
    const token = createPublicMediaToken(source, this.authSecret, Date.now() + SOURCE_URL_TTL_MS)
    const sourceUrl = `${this.publicApiBaseUrl}/api/v1/trusted-assets/source/${token}`
    const replacingPortrait =
      current?.groupType === 'AIGC' && (current.status === 'failed' || !portraitMatchesFace(asset, current))
    const retrySuffix = replacingPortrait ? `-${randomUUID().slice(0, 8)}` : ''
    const groupId =
      current?.groupType === 'AIGC' && !replacingPortrait
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
    const asset = await this.requireCharacterAsset(projectId, localAssetId, principal)
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
    const asset = await this.requireCharacterAsset(projectId, assetId, principal)
    const current = asset.attributes.trustedPortrait
    if (!current) throw new AppError(409, 'TRUSTED_PORTRAIT_REQUIRED', '当前人物尚未绑定 Dora 素材资源')
    this.requireApprovedFace(asset)
    if (current.groupType === 'AIGC' && !portraitMatchesFace(asset, current)) {
      throw new AppError(409, 'FACE_RESOURCE_STALE', '当前 Dora 人像资源对应旧面部，请确认新面部后重新创建')
    }
    const portrait =
      current.status === 'processing'
        ? await this.readProcessingPortrait(this.requireProvider(), current)
        : await this.callProvider(() =>
            this.requireProvider().getPortrait(current.assetId, current.groupType),
          )
    const recovered =
      current.groupType === 'AIGC' && portraitMatchesFace(asset, current)
        ? await this.recoverHistoricalPortrait(asset, current, portrait)
        : portrait
    if (!recovered) return asset
    return this.savePortrait(
      asset,
      recovered,
      recovered.groupType === 'LivenessFace' ? 'authorized-real' : 'ai-virtual',
      principal,
    )
  }

  async refreshProcessing(projectId: string, principal: Principal): Promise<Asset[]> {
    const assets = this.projectRepository
      ? await this.projectRepository.listOwnedAssets(principal)
      : this.store.read((state) => {
          const ownsProject = state.projects.some(
            (project) =>
              project.id === projectId &&
              project.tenantId === principal.tenantId &&
              project.ownerId === principal.userId,
          )
          if (!ownsProject) return []
          return state.assets.filter(
            (asset) => asset.projectId === projectId && asset.tenantId === principal.tenantId,
          )
        })
    const processing = assets.filter(
      (asset): asset is CharacterAsset =>
        asset.projectId === projectId &&
        asset.attributes.type === 'character' &&
        asset.attributes.trustedPortrait?.groupType === 'AIGC' &&
        asset.attributes.trustedPortrait.status === 'processing',
    )
    if (!processing.length) return []

    // A scheduled refresh must not revive a portrait created from an unconfirmed or replaced face.
    const eligible = processing.filter(
      (asset) =>
        asset.attributes.faceStatus === 'approved' &&
        portraitMatchesFace(asset, asset.attributes.trustedPortrait!),
    )
    if (!eligible.length) return []

    const listed = await this.callProvider(() => this.requireProvider().listPortraits('AIGC'))
    const listedById = new Map(listed.map((portrait) => [portrait.assetId, portrait]))
    return await Promise.all(
      eligible.map(async (asset) => {
        const current = asset.attributes.trustedPortrait!
        let portrait = listedById.get(current.assetId) ?? null
        if (!portrait) portrait = await this.readPortraitIfAvailable(current)
        const recovered = await this.recoverHistoricalPortrait(asset, current, portrait)
        if (!recovered || recovered.status === 'processing') return asset
        return this.savePortrait(asset, recovered, 'ai-virtual', principal)
      }),
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
        '可信人像库尚未配置，请联系管理员配置当前素材库 Provider',
      )
    }
    return this.provider
  }

  private requireValidationSessionRepository(): TrustedValidationSessionRepository {
    if (!this.validationSessionRepository) {
      throw new AppError(503, 'VALIDATION_SESSION_NOT_CONFIGURED', '真人认证会话存储尚未配置')
    }
    return this.validationSessionRepository
  }

  private requireValidationProvider(): AssetLibraryProvider {
    const provider = this.requireProvider()
    if (
      !provider.createVisualValidateSession ||
      !provider.getVisualValidateResult ||
      !provider.createAuthorizedAsset
    ) {
      throw new AppError(503, 'REAL_VALIDATION_NOT_SUPPORTED', '当前素材库 Provider 不支持真人认证')
    }
    return provider
  }

  /**
   * Synchronous generation-task preflight. Registration must never reach billing or the queue
   * unless the face confirmation and its persisted source are both still valid.
   */
  async assertVirtualRegistrationReady(
    projectId: string,
    assetId: string,
    principal: Principal,
    expectedFaceReferenceId?: string,
  ): Promise<void> {
    this.requireProvider()
    if (!this.publicApiBaseUrl) {
      throw new AppError(
        503,
        'PUBLIC_API_URL_REQUIRED',
        '自动入库需要配置公网 API 地址；本地 localhost 无法供 Dora 素材库下载素材',
      )
    }
    const asset = await this.requireCharacterAsset(projectId, assetId, principal)
    if (asset.attributes.subjectType !== 'human') {
      throw new AppError(400, 'HUMAN_CHARACTER_REQUIRED', '只有人物素材需要创建人像资源')
    }
    await this.requireConfirmedFaceSource(asset, principal, expectedFaceReferenceId)
  }

  private async requireConfirmedFaceSource(
    asset: CharacterAsset,
    principal: Principal,
    expectedFaceReferenceId?: string,
  ): Promise<StoredSource> {
    this.requireApprovedFace(asset, expectedFaceReferenceId)
    if (!asset.attributes.faceReference) {
      throw new AppError(409, 'FACE_SOURCE_REQUIRED', '面部已标记确认，但没有已保存的面部基准，请重新确认')
    }
    const source = await this.findSource(asset, principal)
    if (!source) {
      throw new AppError(409, 'FACE_SOURCE_REQUIRED', '面部基准图片已失效，请重新生成或导入并确认')
    }
    return source
  }

  private requireApprovedFace(asset: CharacterAsset, expectedFaceReferenceId?: string): void {
    if (asset.attributes.faceStatus !== 'approved') {
      throw new AppError(409, 'FACE_APPROVAL_REQUIRED', '请先生成或导入人物面部，并点击“设为面部基准”')
    }
    if (expectedFaceReferenceId && asset.attributes.faceReference?.id !== expectedFaceReferenceId) {
      throw new AppError(409, 'FACE_CONFIRMATION_CHANGED', '人物面部已更换，请重新创建当前面部对应的素材资源')
    }
  }

  private async visiblePortraitIds(
    principal: Principal,
    groupType?: PortraitGroupType,
  ): Promise<Set<string>> {
    const assets = this.projectRepository
      ? await this.projectRepository.listOwnedAssets(principal)
      : this.store.read((state) => {
          const projectIds = new Set(
            state.projects
              .filter(
                (project) => project.tenantId === principal.tenantId && project.ownerId === principal.userId,
              )
              .map((project) => project.id),
          )
          return state.assets.filter(
            (asset) => asset.tenantId === principal.tenantId && projectIds.has(asset.projectId),
          )
        })
    return new Set(
      assets
        .filter(
          (asset) =>
            asset.attributes.type === 'character' &&
            Boolean(asset.attributes.trustedPortrait?.assetId) &&
            (!groupType || asset.attributes.trustedPortrait?.groupType === groupType),
        )
        .map((asset) =>
          asset.attributes.type === 'character' ? asset.attributes.trustedPortrait!.assetId : '',
        )
        .filter(Boolean),
    )
  }

  private async callProvider<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw this.providerError(error)
    }
  }

  private async readProcessingPortrait(
    provider: AssetLibraryProvider,
    current: TrustedPortrait,
  ): Promise<ProviderPortrait | null> {
    let directPortrait: ProviderPortrait | null = null
    try {
      directPortrait = await provider.getPortrait(current.assetId, current.groupType)
      if (directPortrait.status === 'active') return directPortrait
    } catch (error) {
      if (!isPendingPortraitLookupError(error)) throw this.providerError(error)
    }

    try {
      const listed = await provider.listPortraits(current.groupType)
      return listed.find((candidate) => candidate.assetId === current.assetId) ?? directPortrait
    } catch (error) {
      if (directPortrait) return directPortrait
      if (isPendingPortraitLookupError(error)) return null
      throw this.providerError(error)
    }
  }

  private async readPortraitIfAvailable(current: TrustedPortrait): Promise<ProviderPortrait | null> {
    try {
      return await this.requireProvider().getPortrait(current.assetId, current.groupType)
    } catch (error) {
      if (isPendingPortraitLookupError(error)) return null
      throw this.providerError(error)
    }
  }

  private async recoverHistoricalPortrait(
    asset: CharacterAsset,
    current: TrustedPortrait,
    currentPortrait: ProviderPortrait | null = null,
  ): Promise<ProviderPortrait | null> {
    if (currentPortrait?.status === 'active') return currentPortrait

    const candidateIds = this.store.read((state) =>
      state.tasks
        .filter(
          (task) =>
            task.projectId === asset.projectId &&
            task.tenantId === asset.tenantId &&
            task.metadata.assetId === asset.id &&
            task.metadata.generationStage === 'trusted-portrait',
        )
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map((task) => historicalPortraitId(task.metadata.textResult))
        .filter((assetId): assetId is string => Boolean(assetId) && assetId !== current.assetId),
    )

    for (const candidateId of new Set(candidateIds)) {
      try {
        const candidate = await this.requireProvider().getPortrait(candidateId, 'AIGC')
        if (candidate.status === 'active') return candidate
      } catch (error) {
        if (!isPendingPortraitLookupError(error)) throw this.providerError(error)
      }
    }
    return currentPortrait
  }

  private providerError(error: unknown): AppError {
    if (error instanceof AppError) return error
    const detail = error instanceof Error ? error.message : '未知错误'
    return new AppError(502, 'ASSET_LIBRARY_REQUEST_FAILED', `Dora 素材库请求失败：${detail}`)
  }

  private async requireCharacterAsset(
    projectId: string,
    assetId: string,
    principal: Principal,
  ): Promise<CharacterAsset> {
    const asset = this.projectRepository
      ? await this.projectRepository.findOwnedAsset(projectId, assetId, principal)
      : this.store.read((state) => {
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

  private async findSource(asset: CharacterAsset, principal: Principal): Promise<StoredSource | null> {
    const currentFace = asset.attributes.faceReference
    if (!currentFace) return null
    const currentFacePath = referencePath(currentFace.url)
    const mediaMatch = /^\/api\/v1\/media\/([^/]+)$/.exec(currentFacePath)
    if (mediaMatch) {
      // The URL and ID are both persisted confirmation data; do not silently substitute another
      // reference from the character or project.
      if (currentFace.id !== mediaMatch[1]) return null
      return this.findMediaSourceById(mediaMatch[1], asset)
    }

    const generated = /^\/api\/v1\/generation\/tasks\/([^/]+)\/outputs\/(single)$/.exec(currentFacePath)
    if (!generated) return null
    if (currentFace.id !== `${generated[1]}-single`) return null
    return this.findGeneratedTaskSource(asset, generated[1]!, generated[2]!, principal)
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

  private async findGeneratedTaskSource(
    asset: CharacterAsset,
    taskId: string,
    view: string,
    principal: Principal,
  ): Promise<StoredSource | null> {
    const sourceTask =
      this.generationTaskRepository && principal
        ? await this.generationTaskRepository.findById(taskId, principal)
        : this.store.read((state) => state.tasks.find((task) => task.id === taskId) ?? null)
    if (
      !sourceTask ||
      sourceTask.projectId !== asset.projectId ||
      sourceTask.tenantId !== asset.tenantId ||
      sourceTask.kind !== 'image' ||
      sourceTask.metadata.assetId !== asset.id ||
      sourceTask.metadata.generationStage !== 'face' ||
      sourceTask.status !== 'completed'
    ) {
      return null
    }
    const descriptors = Array.isArray(sourceTask.metadata.generatedOutputs)
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
  }

  private savePortrait(
    asset: CharacterAsset,
    portrait: ProviderPortrait,
    portraitSource: 'ai-virtual' | 'authorized-real',
    principal: Principal,
  ): Promise<Asset> {
    const trustedPortrait = toTrustedPortrait(portrait, asset.attributes.faceReference?.id ?? null)
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

function toTrustedPortrait(portrait: ProviderPortrait, faceReferenceId: string | null): TrustedPortrait {
  return {
    assetId: portrait.assetId,
    groupId: portrait.groupId,
    groupType: portrait.groupType,
    faceReferenceId,
    status: portrait.status,
    name: portrait.name,
    previewUrl: trustedPortraitPreviewUrl(portrait),
    errorCode: portrait.errorCode,
    errorMessage: portrait.errorMessage,
    checkedAt: new Date().toISOString(),
  }
}

function portraitMatchesFace(asset: CharacterAsset, portrait: TrustedPortrait): boolean {
  // Legacy resources have no source binding. Keep them readable and let the next successful
  // registration attach the binding; all newly created resources must match exactly.
  return !portrait.faceReferenceId || portrait.faceReferenceId === asset.attributes.faceReference?.id
}

function publicValidationSession(session: {
  id: string
  status: PublicValidationSession['status']
  h5Link: string
  qrCode: string | null
  groupId: string | null
  providerAssetId: string | null
  error: string | null
  expiresAt: string
  updatedAt: string
}): PublicValidationSession {
  return {
    id: session.id,
    status: session.status,
    h5Link: session.h5Link,
    qrCode: session.qrCode,
    groupId: session.groupId,
    providerAssetId: session.providerAssetId,
    error: session.error,
    expiresAt: session.expiresAt,
    updatedAt: session.updatedAt,
  }
}

function trustedPortraitPreviewUrl(portrait: ProviderPortrait): string | null {
  if (portrait.assetId) {
    return `/api/v1/trusted-assets/portraits/${encodeURIComponent(portrait.assetId)}/preview`
  }
  return portrait.previewUrl
}

function isPendingPortraitLookupError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /尚未能建立可靠资源验证|尚未就绪|暂未就绪|处理中|processing|not ready|not found|does not exist|resource[^\n]*missing|请求超时|网络暂时不可达/i.test(
    error.message,
  )
}

function historicalPortraitId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const attributes = (value as { attributes?: unknown }).attributes
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null
  const portrait = (attributes as { trustedPortrait?: unknown }).trustedPortrait
  if (!portrait || typeof portrait !== 'object' || Array.isArray(portrait)) return null
  const assetId = (portrait as { assetId?: unknown }).assetId
  return typeof assetId === 'string' && assetId.length > 0 ? assetId : null
}
