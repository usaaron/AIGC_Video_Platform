import { z } from 'zod'
import type {
  AssetLibraryProvider,
  PortraitGroupType,
  PortraitPreview,
  ProviderPortrait,
  VisualValidationResult,
  VisualValidationSession,
} from './volcArkAssetLibraryProvider.js'

const providerErrorSchema = z
  .object({
    Code: z.string().optional(),
    Message: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough()

const responseSchema = z
  .object({
    ResponseMetadata: z
      .object({
        RequestId: z.string().optional(),
        Error: providerErrorSchema.optional(),
      })
      .passthrough()
      .optional(),
    Result: z.unknown().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough()

const assetSchema = z
  .object({
    Id: z.string().min(1),
    GroupId: z.string().min(1),
    GroupType: z.enum(['AIGC', 'LivenessFace']).optional(),
    Name: z.string().optional().default(''),
    AssetType: z.enum(['Image', 'Video', 'Audio']),
    Status: z.enum(['Active', 'Processing', 'Pending', 'Failed']),
    URL: z.string().optional().default(''),
    Error: providerErrorSchema.optional(),
    error: providerErrorSchema.optional(),
    ErrorCode: z.string().optional(),
    ErrorMessage: z.string().optional(),
  })
  .passthrough()

const assetGroupSchema = z
  .object({
    Id: z.string().min(1),
    Name: z.string().optional().default(''),
    GroupType: z.enum(['AIGC', 'LivenessFace']).optional(),
  })
  .passthrough()

const idResultSchema = z.object({ Id: z.string().min(1) }).passthrough()
const visualValidationSessionSchema = z
  .object({
    BytedToken: z.string().min(1),
    H5Link: z.string().min(1),
    QrCode: z.string().nullish(),
  })
  .passthrough()
const visualValidationResultSchema = z.object({ GroupId: z.string().min(1).nullish() }).passthrough()
const assetGroupListSchema = z
  .object({
    Items: z.array(assetGroupSchema).default([]),
    TotalCount: z.number().int().nonnegative().optional(),
  })
  .passthrough()
const assetListSchema = z
  .object({
    Items: z.array(assetSchema).default([]),
    TotalCount: z.number().int().nonnegative().optional(),
  })
  .passthrough()

type Fetcher = typeof fetch

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 524])
const PROVIDER_RETRY_DELAY_MS = 350

export type DoraRouterAssetLibraryOptions = {
  baseUrl: string
  apiKey: string
  projectName: string
  requestTimeoutMs: number
  fetcher?: Fetcher
}

/** DoraRouter's material API uses the same Bearer token as its Seedance endpoint. */
export class DoraRouterAssetLibraryProvider implements AssetLibraryProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher

  constructor(private readonly options: DoraRouterAssetLibraryOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
  }

  async createVirtualGroup(name: string, description: string): Promise<string> {
    const result = idResultSchema.parse(
      await this.call('CreateAssetGroup', {
        Name: name.slice(0, 120),
        Description: description.slice(0, 500),
      }),
    )
    return result.Id
  }

  async createVirtualAsset(groupId: string, name: string, sourceUrl: string): Promise<ProviderPortrait> {
    return this.createAsset(groupId, name, sourceUrl, 'AIGC')
  }

  async createAuthorizedAsset(groupId: string, name: string, sourceUrl: string): Promise<ProviderPortrait> {
    return this.createAsset(groupId, name, sourceUrl, 'LivenessFace')
  }

  async createVisualValidateSession(): Promise<VisualValidationSession> {
    const result = visualValidationSessionSchema.parse(await this.call('CreateVisualValidateSession', {}))
    return {
      providerToken: result.BytedToken,
      h5Link: result.H5Link,
      qrCode: result.QrCode ?? null,
    }
  }

  async getVisualValidateResult(providerToken: string): Promise<VisualValidationResult> {
    const result = visualValidationResultSchema.parse(
      await this.call('GetVisualValidateResult', { BytedToken: providerToken }),
    )
    return { groupId: result.GroupId ?? null }
  }

  async getPortrait(assetId: string, expectedGroupType?: PortraitGroupType): Promise<ProviderPortrait> {
    const asset = assetSchema.parse(await this.call('GetAsset', { Id: assetId }))
    if (expectedGroupType) return mapPortrait(asset, expectedGroupType)
    const group = assetGroupSchema.parse(await this.call('GetAssetGroup', { Id: asset.GroupId }))
    const groupType = group.GroupType ?? asset.GroupType ?? (await this.findGroupType(asset.GroupId))
    if (!groupType) throw new Error('DoraRouter素材详情没有返回可识别的素材组类型')
    return mapPortrait(asset, groupType)
  }

  async getPortraitPreview(assetId: string): Promise<PortraitPreview> {
    const portrait = await this.getPortrait(assetId)
    if (!portrait.previewUrl) throw new Error('素材库当前没有可用的预览图片')

    let previewUrl: URL
    try {
      previewUrl = new URL(portrait.previewUrl)
    } catch {
      throw new Error('素材库返回的预览地址无效')
    }
    if (!['http:', 'https:'].includes(previewUrl.protocol)) {
      throw new Error('素材库返回了不支持的预览地址')
    }

    let response: Response
    try {
      response = await this.fetcher(previewUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      })
    } catch (error) {
      throw new Error(`素材库预览图下载失败：${readableFetchFailure(error)}`)
    }
    if (!response.ok) throw new Error(`预览图片下载失败（HTTP ${response.status}）`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] || 'image/jpeg'
    if (!contentType.startsWith('image/')) throw new Error('素材库返回的预览内容不是图片')
    const content = Buffer.from(await response.arrayBuffer())
    if (!content.length) throw new Error('素材库返回了空的预览图片')
    return { content, contentType }
  }

  async listAuthorizedPortraits(): Promise<ProviderPortrait[]> {
    return this.listPortraits('LivenessFace')
  }

  async listPortraits(groupType: PortraitGroupType): Promise<ProviderPortrait[]> {
    const groups = await this.listGroups(groupType)
    const groupIds = groups.Items.map((group) => group.Id)
    if (!groupIds.length) return []

    const result = assetListSchema.parse(
      await this.call('ListAssets', {
        Filter: {
          GroupType: groupType,
          GroupIds: groupIds,
          Statuses: ['Active'],
        },
        PageNumber: 1,
        PageSize: 100,
      }),
    )
    return result.Items.map((asset) => mapPortrait(asset, groupType))
  }

  private async listGroups(groupType: PortraitGroupType): Promise<z.infer<typeof assetGroupListSchema>> {
    return assetGroupListSchema.parse(
      await this.call('ListAssetGroups', {
        Filter: { GroupType: groupType },
        PageNumber: 1,
        PageSize: 100,
        SortBy: 'CreateTime',
        SortOrder: 'Desc',
        ProjectName: this.options.projectName,
      }),
    )
  }

  private async findGroupType(groupId: string): Promise<PortraitGroupType | null> {
    for (const groupType of ['AIGC', 'LivenessFace'] as const) {
      const groups = await this.listGroups(groupType)
      if (groups.Items.some((group) => group.Id === groupId)) return groupType
    }
    return null
  }

  private async call(action: string, body: Record<string, unknown>): Promise<unknown> {
    const query = `Action=${encodeURIComponent(action)}&Version=2024-01-01`
    const response = await this.fetchWithRetry(action, `${this.baseUrl}/v1/material?${query}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const raw = await response.text().catch(() => '')
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error(`DoraRouter素材库返回了无法解析的响应 (${response.status})`)
    }
    const envelope = responseSchema.parse(data)
    const metadataError = envelope.ResponseMetadata?.Error
    const resultError = readResultError(envelope.Result)
    if (!response.ok || metadataError || resultError || envelope.code) {
      const detail =
        metadataError?.Message ||
        metadataError?.Code ||
        resultError?.Message ||
        resultError?.Code ||
        envelope.message ||
        envelope.code ||
        `HTTP ${response.status}`
      throw new Error(`DoraRouter素材库请求失败：${detail}`)
    }
    return envelope.Result ?? {}
  }

  private async createAsset(
    groupId: string,
    name: string,
    sourceUrl: string,
    groupType: PortraitGroupType,
  ): Promise<ProviderPortrait> {
    const result = idResultSchema.parse(
      await this.call('CreateAsset', {
        GroupId: groupId,
        URL: sourceUrl,
        AssetType: 'Image',
        Name: name.slice(0, 255),
      }),
    )
    return {
      assetId: result.Id,
      groupId,
      groupType,
      name,
      assetType: 'Image',
      status: 'processing',
      previewUrl: null,
      errorCode: null,
      errorMessage: null,
    }
  }

  private async fetchWithRetry(action: string, url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        })
        if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === 1) return response
        await delay(PROVIDER_RETRY_DELAY_MS)
      } catch (error) {
        lastError = error
        if (attempt === 1 || !isTransientFetchFailure(error)) {
          throw new Error(`DoraRouter素材库网络暂时不可达（${action}）：${readableFetchFailure(error)}`)
        }
        await delay(PROVIDER_RETRY_DELAY_MS)
      }
    }
    throw new Error(`DoraRouter素材库网络暂时不可达（${action}）：${readableFetchFailure(lastError)}`)
  }
}

function mapPortrait(
  asset: z.infer<typeof assetSchema>,
  groupType: ProviderPortrait['groupType'],
): ProviderPortrait {
  return {
    assetId: asset.Id,
    groupId: asset.GroupId,
    groupType,
    name: asset.Name,
    assetType: asset.AssetType,
    status: asset.Status === 'Active' ? 'active' : asset.Status === 'Failed' ? 'failed' : 'processing',
    previewUrl: asset.URL || null,
    errorCode:
      asset.Error?.Code ??
      asset.Error?.code ??
      asset.error?.Code ??
      asset.error?.code ??
      asset.ErrorCode ??
      null,
    errorMessage:
      asset.Error?.Message ??
      asset.Error?.message ??
      asset.error?.Message ??
      asset.error?.message ??
      asset.ErrorMessage ??
      null,
  }
}

function readResultError(value: unknown): { Code?: string; Message?: string } | null {
  if (!value || typeof value !== 'object') return null
  const error = (value as { Error?: unknown }).Error
  if (!error || typeof error !== 'object') return null
  const record = error as { Code?: unknown; Message?: unknown }
  return {
    ...(typeof record.Code === 'string' ? { Code: record.Code } : {}),
    ...(typeof record.Message === 'string' ? { Message: record.Message } : {}),
  }
}

function isTransientFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /fetch failed|network|timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(
    `${error.name} ${error.message}`,
  )
}

function readableFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return '未知网络错误'
  if (/timeout|timed out|AbortError|TimeoutError/i.test(`${error.name} ${error.message}`)) {
    return '请求超时，请稍后刷新状态'
  }
  if (/fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(error.message)) {
    return 'API 服务暂时无法连接 DoraRouter 素材库，请稍后刷新状态'
  }
  return error.message || '未知网络错误'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
